import express, { Router, Request, Response, NextFunction } from 'express';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { handleUpload } from '../middleware/upload';
import {
  parseFile,
  extractSections,
  extractPdfLinks,
  extractPdfLinkAnchors,
  injectLinkAnchors,
  mergeContactLinks,
} from '../services/parser';
import { createError } from '../middleware/errorHandler';

const router: Router = express.Router();

// ---------------------------------------------------------------------------
// CV record types
// ---------------------------------------------------------------------------

export interface CVSections {
  contact: Record<string, string>;
  summary: string;
  experience: string;
  education: string;
  skills: string;
  certifications: string;
  projects: string;
  languages: string;
  awards: string;
  publications: string;
  volunteer: string;
  other: string;
  raw: string;
}

export interface CVRecord {
  id: string;
  fileName: string;
  filePath: string;
  mimetype: string;
  fileSize: number;
  originalText: string;
  sections: CVSections;
  createdAt: string;
  updatedAt: string;
}

// In-memory store for CV records.
// In production replace with Prisma:
//   import { PrismaClient } from '@prisma/client';
//   const prisma = new PrismaClient();
export const cvStore = new Map<string, CVRecord>();

// ---------------------------------------------------------------------------
// POST /api/v1/cv/upload
// ---------------------------------------------------------------------------
router.post('/upload', handleUpload, async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!req.file) {
      throw createError(400, 'No file uploaded. Send the file under the "file" field.');
    }

    const { path: filePath, mimetype, originalname, size } = req.file;

    // Parse raw text from the file
    let rawText: string;
    try {
      rawText = await parseFile(filePath, mimetype);
    } catch (err) {
      // Clean up the uploaded file if parsing fails
      fs.unlink(filePath, () => {});
      throw createError(422, `Failed to extract text from file: ${(err as Error).message}`);
    }

    if (!rawText || rawText.trim().length < 50) {
      fs.unlink(filePath, () => {});
      throw createError(422, 'The uploaded file appears to be empty or contains too little text.');
    }

    // Recover clickable link annotations that pdf-parse strips, embedding in-body links
    // (e.g. "Google Play", "AppStore") as markdown so they survive into the sections.
    let annotationUrls: string[] = [];
    if (mimetype === 'application/pdf') {
      annotationUrls = await extractPdfLinks(filePath);
      const anchors = await extractPdfLinkAnchors(filePath);
      if (anchors.length) rawText = injectLinkAnchors(rawText, anchors);
    }

    // Extract structured sections
    const sections = extractSections(rawText);

    // Merge clickable link annotations into the contact buckets (Portfolio, LinkedIn, store links).
    if (annotationUrls.length) {
      mergeContactLinks(sections, annotationUrls);
    }

    // Build the CV record
    const id = uuidv4();
    const now = new Date().toISOString();
    const cvRecord: CVRecord = {
      id,
      fileName: originalname,
      filePath,
      mimetype,
      fileSize: size,
      originalText: rawText,
      sections,
      createdAt: now,
      updatedAt: now,
    };

    cvStore.set(id, cvRecord);

    // Don't expose internal filePath to clients
    const { filePath: _fp, ...safeRecord } = cvRecord;
    res.status(201).json({
      message: 'CV uploaded and parsed successfully.',
      cv: safeRecord,
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /api/v1/cv/:id
// ---------------------------------------------------------------------------
router.get('/:id', (req: Request, res: Response, next: NextFunction) => {
  try {
    const cv = cvStore.get(req.params.id);
    if (!cv) throw createError(404, `CV with id "${req.params.id}" not found.`);

    const { filePath: _fp, ...safeRecord } = cv;
    res.json({ cv: safeRecord });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// PUT /api/v1/cv/:id
// ---------------------------------------------------------------------------
const UpdateSchema = z.object({
  sections: z
    .object({
      summary: z.string().optional(),
      experience: z.string().optional(),
      education: z.string().optional(),
      skills: z.string().optional(),
      certifications: z.string().optional(),
      projects: z.string().optional(),
      languages: z.string().optional(),
      awards: z.string().optional(),
      publications: z.string().optional(),
      volunteer: z.string().optional(),
      other: z.string().optional(),
    })
    .optional(),
  fileName: z.string().max(255).optional(),
});

router.put('/:id', express.json(), (req: Request, res: Response, next: NextFunction) => {
  try {
    const cv = cvStore.get(req.params.id);
    if (!cv) throw createError(404, `CV with id "${req.params.id}" not found.`);

    const parsed = UpdateSchema.safeParse(req.body);
    if (!parsed.success) throw parsed.error; // ZodError — handled by errorHandler

    const { sections, fileName } = parsed.data;

    if (sections) {
      cv.sections = { ...cv.sections, ...sections };
    }
    if (fileName) {
      cv.fileName = fileName;
    }
    cv.updatedAt = new Date().toISOString();

    cvStore.set(req.params.id, cv);

    const { filePath: _fp, ...safeRecord } = cv;
    res.json({ message: 'CV updated.', cv: safeRecord });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/v1/cv/:id
// ---------------------------------------------------------------------------
router.delete('/:id', (req: Request, res: Response, next: NextFunction) => {
  try {
    const cv = cvStore.get(req.params.id);
    if (!cv) throw createError(404, `CV with id "${req.params.id}" not found.`);

    // Remove uploaded file from disk
    if (cv.filePath && fs.existsSync(cv.filePath)) {
      fs.unlink(cv.filePath, () => {});
    }

    cvStore.delete(req.params.id);
    res.json({ message: 'CV deleted.' });
  } catch (err) {
    next(err);
  }
});

// Export the store so other routes (optimize, export) can look up CVs
export default router;
