import express, { Router, Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { handleUpload } from '../middleware/upload';
import { parseFile } from '../services/parser';
import { analyzeJD, JDAnalysisResult } from '../services/jdAnalyzer';
import { createError } from '../middleware/errorHandler';
import { requireAuth } from '../middleware/requireAuth';

const router: Router = express.Router();

// ---------------------------------------------------------------------------
// JD record types
// ---------------------------------------------------------------------------

export interface JDRecord {
  id: string;
  text: string;
  analysis: JDAnalysisResult;
  createdAt: string;
}

// Simple in-memory JD store (swap for Prisma in production)
export const jdStore = new Map<string, JDRecord>();

// ---------------------------------------------------------------------------
// POST /api/v1/jd/analyze
//
// Accepts either:
//   (a) multipart/form-data with a "file" field (PDF/DOCX/TXT), or
//   (b) application/json with { "text": "..." }
// ---------------------------------------------------------------------------
router.post('/analyze', requireAuth, (req: Request, res: Response, next: NextFunction) => {
  // Try file upload first; if no file is present, fall through to JSON body
  handleUpload(req, res, async (uploadErr?: unknown) => {
    if (uploadErr) return next(uploadErr);

    try {
      let jdText = '';

      if (req.file) {
        // File was uploaded — parse it
        try {
          jdText = await parseFile(req.file.path, req.file.mimetype);
        } catch (err) {
          throw createError(422, `Could not extract text from file: ${(err as Error).message}`);
        }
      } else {
        // Expect JSON body with a "text" field
        // Body parsing for this case is handled by the json middleware in index.ts
        const body = req.body as Record<string, unknown> || {};
        if (!body.text || typeof body.text !== 'string') {
          throw createError(
            400,
            'Provide either a file upload (field "file") or a JSON body with a "text" property.'
          );
        }
        jdText = body.text;
      }

      if (jdText.trim().length < 50) {
        throw createError(400, 'Job description is too short to analyse (minimum 50 characters).');
      }

      // Analyse with AI (pass session credentials)
      const sessionSnapshot = { credentials: (req.session as any).credentials };
      let analysis: JDAnalysisResult;
      try {
        analysis = await analyzeJD(jdText, sessionSnapshot);
      } catch (err) {
        throw createError(502, `AI analysis failed: ${(err as Error).message}`);
      }

      const id = uuidv4();
      const now = new Date().toISOString();
      const jdRecord: JDRecord = {
        id,
        text: jdText,
        analysis,
        createdAt: now,
      };

      jdStore.set(id, jdRecord);

      res.status(201).json({
        message: 'Job description analysed successfully.',
        jd: jdRecord,
      });
    } catch (err) {
      next(err);
    }
  });
});

// ---------------------------------------------------------------------------
// POST /api/v1/jd/analyze/text — convenience alias for JSON body
// ---------------------------------------------------------------------------
const TextSchema = z.object({
  text: z.string().min(50, 'Job description must be at least 50 characters.'),
});

router.post('/analyze/text', requireAuth, express.json(), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = TextSchema.safeParse(req.body);
    if (!parsed.success) throw parsed.error;

    const { text } = parsed.data;

    const sessionSnapshot = { credentials: (req.session as any).credentials };
    let analysis: JDAnalysisResult;
    try {
      analysis = await analyzeJD(text, sessionSnapshot);
    } catch (err) {
      throw createError(502, `AI analysis failed: ${(err as Error).message}`);
    }

    const id = uuidv4();
    const now = new Date().toISOString();
    const jdRecord: JDRecord = { id, text, analysis, createdAt: now };
    jdStore.set(id, jdRecord);

    res.status(201).json({ message: 'Job description analysed successfully.', jd: jdRecord });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /api/v1/jd/:id
// ---------------------------------------------------------------------------
router.get('/:id', (req: Request, res: Response, next: NextFunction) => {
  try {
    const jd = jdStore.get(req.params.id);
    if (!jd) throw createError(404, `JD with id "${req.params.id}" not found.`);
    res.json({ jd });
  } catch (err) {
    next(err);
  }
});

export default router;
