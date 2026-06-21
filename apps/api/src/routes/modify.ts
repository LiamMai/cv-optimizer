import express, { Router, Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { cvStore, CVRecord } from './cv';
import { jobStore, OptimizationJob } from './optimize';
import { modify } from '../services/cvModifier';
import { createError } from '../middleware/errorHandler';
import { requireAuth } from '../middleware/requireAuth';

const router: Router = express.Router();

// ---------------------------------------------------------------------------
// Validation schema
// ---------------------------------------------------------------------------
const ModifySchema = z.object({
  cvId: z.string().uuid('cvId must be a valid UUID'),
  userData: z.string().min(20, 'Please provide at least 20 characters describing what to change.'),
  config: z
    .object({
      maxPages: z.number().int().min(1).max(4).optional(),
      tone: z.enum(['professional', 'conversational', 'executive']).optional(),
    })
    .optional()
    .default({}),
});

// ---------------------------------------------------------------------------
// POST /api/v1/modify
//
// Kicks off a "modify CV from user data" job. Runs asynchronously; the job is
// stored in the SHARED jobStore so the existing GET /api/v1/optimize/:jobId
// poll, the diff editor, and export all work unchanged.
// ---------------------------------------------------------------------------
router.post('/', requireAuth, express.json(), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = ModifySchema.safeParse(req.body);
    if (!parsed.success) throw parsed.error;

    const { cvId, userData, config } = parsed.data;

    const cvRecord = cvStore.get(cvId);
    if (!cvRecord) throw createError(404, `CV with id "${cvId}" not found.`);

    const jobId = uuidv4();
    const now = new Date().toISOString();

    const job: OptimizationJob = {
      id: jobId,
      cvId,
      jdId: '', // no JD for a modify job
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
    const sessionSnapshot = { credentials: (req.session as any).credentials };

    _runModifyJob(jobId, cvRecord, userData, config, sessionSnapshot).catch((err: Error) => {
      console.error(`[modify] Job ${jobId} threw unexpectedly:`, err);
    });

    res.status(202).json({
      message: 'Modification job started. Poll GET /api/v1/optimize/:jobId for results.',
      jobId,
      status: 'pending',
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Background job runner
// ---------------------------------------------------------------------------
async function _runModifyJob(
  jobId: string,
  cvRecord: CVRecord,
  userData: string,
  config: Record<string, unknown>,
  session?: { credentials?: any }
): Promise<void> {
  const job = jobStore.get(jobId);
  if (!job) return;

  _updateJob(jobId, { status: 'running', startedAt: new Date().toISOString() });

  try {
    const result = await modify(cvRecord.sections, userData, config, session);

    _updateJob(jobId, {
      status: 'completed',
      completedAt: new Date().toISOString(),
      result,
    });
  } catch (err) {
    _updateJob(jobId, {
      status: 'failed',
      error: (err as Error).message,
      completedAt: new Date().toISOString(),
    });
    console.error(`[modify] Job ${jobId} failed:`, err);
  }
}

function _updateJob(jobId: string, updates: Partial<OptimizationJob>): void {
  const job = jobStore.get(jobId);
  if (!job) return;
  Object.assign(job, updates, { updatedAt: new Date().toISOString() });
  jobStore.set(jobId, job);
}

export default router;
