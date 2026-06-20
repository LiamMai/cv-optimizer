import express, { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { cvStore } from './cv';
import { jobStore } from './optimize';
import { exportToPDF, exportToDOCX } from '../services/exporter';
import { createError } from '../middleware/errorHandler';
import { CVSections } from './cv';

const router: Router = express.Router();

// ---------------------------------------------------------------------------
// Validation schema (shared by both endpoints)
// ---------------------------------------------------------------------------
const ExportSchema = z.object({
  // Provide either a cvId (for raw/original CV) or a jobId (for optimized CV)
  cvId: z.string().uuid().optional(),
  jobId: z.string().uuid().optional(),
  // Optional per-section content overrides (e.g. sections with rejected changes).
  // Keys are section types (summary, experience, …); only applied with a jobId.
  sections: z.record(z.string()).optional(),
}).refine((d) => d.cvId || d.jobId, {
  message: 'Provide either cvId (original CV) or jobId (optimized CV result).',
});

interface ResolvedSections {
  sections: CVSections;
  fileName: string;
}

/**
 * Resolve the CV sections from either a cvId or jobId.
 */
function _resolveSections(body: { cvId?: string; jobId?: string; sections?: Record<string, string> }): ResolvedSections {
  if (body.jobId) {
    const job = jobStore.get(body.jobId);
    if (!job) throw createError(404, `Optimization job "${body.jobId}" not found.`);
    if (job.status !== 'completed') {
      throw createError(409, `Job is not completed yet (status: ${job.status}). Wait until status is "completed".`);
    }
    const cvRecord = cvStore.get(job.cvId);
    const baseName = cvRecord ? cvRecord.fileName.replace(/\.[^.]+$/, '') : 'cv';
    // Start from the optimized sections, then apply any per-section overrides
    // the client sent (sections where the user rejected one or more changes).
    const sections = { ...(job.result!.optimizedSections as unknown as CVSections) };
    if (body.sections) {
      for (const [key, value] of Object.entries(body.sections)) {
        (sections as Record<string, unknown>)[key] = value;
      }
    }
    return { sections, fileName: `${baseName}_optimized` };
  }

  if (body.cvId) {
    const cvRecord = cvStore.get(body.cvId);
    if (!cvRecord) throw createError(404, `CV "${body.cvId}" not found.`);
    const baseName = cvRecord.fileName.replace(/\.[^.]+$/, '');
    return { sections: cvRecord.sections, fileName: baseName };
  }

  throw createError(400, 'Neither cvId nor jobId was provided.');
}

// ---------------------------------------------------------------------------
// POST /api/v1/export/pdf
// ---------------------------------------------------------------------------
router.post('/pdf', express.json(), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = ExportSchema.safeParse(req.body);
    if (!parsed.success) throw parsed.error;

    const { sections, fileName } = _resolveSections(parsed.data);

    const { buffer, mimeType, extension } = await exportToPDF(sections);

    const downloadName = `${fileName}.${extension}`;
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${downloadName}"`);
    res.setHeader('Content-Length', buffer.length);
    res.send(buffer);
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// POST /api/v1/export/docx
// ---------------------------------------------------------------------------
router.post('/docx', express.json(), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = ExportSchema.safeParse(req.body);
    if (!parsed.success) throw parsed.error;

    const { sections, fileName } = _resolveSections(parsed.data);

    const { buffer, mimeType, extension } = await exportToDOCX(sections);

    const downloadName = `${fileName}.${extension}`;
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${downloadName}"`);
    res.setHeader('Content-Length', buffer.length);
    res.send(buffer);
  } catch (err) {
    next(err);
  }
});

export default router;
