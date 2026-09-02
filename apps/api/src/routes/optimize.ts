import express, { Router, Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { cvStore, CVRecord, CVSections, isEditableSectionKey } from './cv';
import { jdStore, JDRecord } from './jd';
import { optimize, OptimizeResult } from '../services/cvOptimizer';
import { score as scoreAts } from '../services/atsScorer';
import { createError } from '../middleware/errorHandler';
import { requireAuth } from '../middleware/requireAuth';
import type { SessionCredentials } from '../services/aiProvider';

const router: Router = express.Router();

// ---------------------------------------------------------------------------
// Job types
// ---------------------------------------------------------------------------

export type JobStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface OptimizationJob {
  id: string;
  cvId: string;
  jdId: string;
  config: Record<string, unknown>;
  status: JobStatus;
  result: OptimizeResult | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

// In-memory job store for async polling
export const jobStore = new Map<string, OptimizationJob>();

// ---------------------------------------------------------------------------
// Validation schema
// ---------------------------------------------------------------------------
const OptimizeSchema = z.object({
  cvId: z.string().uuid('cvId must be a valid UUID'),
  jdId: z.string().uuid('jdId must be a valid UUID'),
  config: z
    .object({
      maxPages: z.number().int().min(1).max(4).optional(),
      tone: z.enum(['professional', 'conversational', 'executive']).optional(),
      atsAggressiveness: z.enum(['low', 'medium', 'high']).optional(),
      humanizationLevel: z.enum(['low', 'medium', 'high']).optional(),
    })
    .optional()
    .default({}),
});

// ---------------------------------------------------------------------------
// POST /api/v1/optimize
//
// Kicks off an optimization job. The job runs asynchronously so the response
// is immediate (jobId + status: "pending"). Poll GET /:jobId for results.
// ---------------------------------------------------------------------------
router.post('/', requireAuth, express.json(), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = OptimizeSchema.safeParse(req.body);
    if (!parsed.success) throw parsed.error;

    const { cvId, jdId, config } = parsed.data;

    // Validate that CV and JD exist
    const cvRecord = cvStore.get(cvId);
    if (!cvRecord) throw createError(404, `CV with id "${cvId}" not found.`);

    const jdRecord = jdStore.get(jdId);
    if (!jdRecord) throw createError(404, `JD with id "${jdId}" not found.`);

    const jobId = uuidv4();
    const now = new Date().toISOString();

    const job: OptimizationJob = {
      id: jobId,
      cvId,
      jdId,
      config,
      status: 'pending',
      result: null,
      error: null,
      createdAt: now,
      updatedAt: now,
      startedAt: null,
      completedAt: null,
    };

    jobStore.set(jobId, job);

    // Snapshot session credentials now — session won't be accessible in the async runner
    const sessionSnapshot = { credentials: req.session.credentials };

    // Run the optimisation asynchronously (fire-and-forget with status updates)
    _runOptimizationJob(jobId, cvRecord, jdRecord, config, sessionSnapshot).catch((err: Error) => {
      console.error(`[optimize] Job ${jobId} threw unexpectedly:`, err);
    });

    res.status(202).json({
      message: 'Optimization job started. Poll GET /api/v1/optimize/:jobId for results.',
      jobId,
      status: 'pending',
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /api/v1/optimize/:jobId — poll job status
// ---------------------------------------------------------------------------
router.get('/:jobId', (req: Request, res: Response, next: NextFunction) => {
  try {
    const job = jobStore.get(req.params.jobId);
    if (!job) throw createError(404, `Optimization job "${req.params.jobId}" not found.`);

    // Shape the response based on status
    const response: Record<string, unknown> = {
      jobId: job.id,
      status: job.status,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
    };

    if (job.status === 'running') {
      response.startedAt = job.startedAt;
      response.message = 'Optimization in progress…';
    }

    if (job.status === 'completed') {
      response.startedAt = job.startedAt;
      response.completedAt = job.completedAt;
      response.result = job.result;
      // Style hints never flow through the AI rewrite — surface the original upload's,
      // keyed by the job's cvId, so the live preview can match the exported PDF/DOCX font.
      response.styleHints = cvStore.get(job.cvId)?.styleHints;
    }

    if (job.status === 'failed') {
      response.error = job.error;
    }

    res.json(response);
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// POST /api/v1/optimize/:jobId/score — recompute the ATS score against the
// current (possibly user-edited) CV content, without re-running the AI.
// ---------------------------------------------------------------------------
const RescoreSchema = z.object({
  sections: z.record(z.string()).optional(),
});

router.post('/:jobId/score', express.json(), (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = RescoreSchema.safeParse(req.body);
    if (!parsed.success) throw parsed.error;

    const job = jobStore.get(req.params.jobId);
    if (!job) throw createError(404, `Optimization job "${req.params.jobId}" not found.`);
    if (job.status !== 'completed' || !job.result) {
      throw createError(409, `Job is not completed yet (status: ${job.status}). Wait until status is "completed".`);
    }

    const jdRecord = jdStore.get(job.jdId);
    if (!jdRecord) throw createError(404, `JD for job "${req.params.jobId}" not found.`);

    const sections: CVSections = { ...job.result.optimizedSections };
    if (parsed.data.sections) {
      for (const [key, value] of Object.entries(parsed.data.sections)) {
        if (isEditableSectionKey(key)) sections[key] = value;
      }
    }

    const atsScore = scoreAts(sections, jdRecord.analysis);
    res.json({ atsScore });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /api/v1/optimize — list recent jobs
// ---------------------------------------------------------------------------
router.get('/', (_req: Request, res: Response) => {
  const jobs = Array.from(jobStore.values())
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 50)
    .map(({ result: _r, ...rest }) => rest); // omit heavy result payload from list

  res.json({ jobs });
});

// ---------------------------------------------------------------------------
// Background job runner
// ---------------------------------------------------------------------------
async function _runOptimizationJob(
  jobId: string,
  cvRecord: CVRecord,
  jdRecord: JDRecord,
  config: Record<string, unknown>,
  session?: { credentials?: SessionCredentials }
): Promise<void> {
  const job = jobStore.get(jobId);
  if (!job) return;

  _updateJob(jobId, { status: 'running', startedAt: new Date().toISOString() });

  try {
    const result = await optimize(cvRecord.sections, jdRecord.analysis, config, session);

    _updateJob(jobId, {
      status: 'completed',
      completedAt: new Date().toISOString(),
      result: {
        originalSections: cvRecord.sections,
        optimizedSections: result.optimizedSections,
        atsScore: result.atsScore,
        diff: result.diff,
        config: result.config,
      },
    });
  } catch (err) {
    _updateJob(jobId, {
      status: 'failed',
      error: (err as Error).message,
      completedAt: new Date().toISOString(),
    });
    console.error(`[optimize] Job ${jobId} failed:`, err);
  }
}

function _updateJob(jobId: string, updates: Partial<OptimizationJob>): void {
  const job = jobStore.get(jobId);
  if (!job) return;
  Object.assign(job, updates, { updatedAt: new Date().toISOString() });
  jobStore.set(jobId, job);
}

export default router;
