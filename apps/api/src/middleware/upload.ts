import multer, { FileFilterCallback } from 'multer';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { Request, Response, NextFunction } from 'express';
import config from '../config';

// Re-export multer's file type for use in routes
export type MulterFile = Express.Multer.File;

// Ensure upload directory exists
export const uploadDir = path.resolve(config.upload.dir);
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req: Request, _file: Express.Multer.File, cb) => {
    cb(null, uploadDir);
  },
  filename: (_req: Request, file: Express.Multer.File, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${uuidv4()}${ext}`);
  },
});

function fileFilter(_req: Request, file: Express.Multer.File, cb: FileFilterCallback): void {
  if (config.upload.allowedMimeTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(
      new multer.MulterError(
        'LIMIT_UNEXPECTED_FILE',
        `Unsupported file type: ${file.mimetype}. Accepted: PDF, DOCX, TXT`
      )
    );
  }
}

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: config.upload.maxFileSizeMb * 1024 * 1024,
  },
});

/**
 * Single-file upload middleware bound to the fieldname "file".
 * Usage: router.post('/upload', uploadSingle, handler)
 */
const uploadSingle = upload.single('file');

/**
 * Wraps uploadSingle to return a proper JSON error on multer failures.
 */
export function handleUpload(req: Request, res: Response, next: NextFunction): void {
  uploadSingle(req, res, (err: unknown) => {
    if (!err) return next();

    if (err instanceof multer.MulterError) {
      const messages: Record<string, string> = {
        LIMIT_FILE_SIZE: `File too large. Maximum size is ${config.upload.maxFileSizeMb}MB.`,
        LIMIT_UNEXPECTED_FILE: err.message || 'Unexpected field name. Use "file".',
      };
      res.status(400).json({
        error: 'Upload error',
        message: messages[err.code] || err.message,
        code: err.code,
      });
      return;
    }

    // Unknown error
    const error = err as Error;
    res.status(500).json({
      error: 'Upload failed',
      message: error.message,
    });
  });
}
