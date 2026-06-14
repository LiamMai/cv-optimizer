import { Request, Response, NextFunction } from 'express';
import config from '../config';

export class AppError extends Error {
  status: number;
  statusCode: number;
  isOperational: boolean;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.statusCode = status;
    this.isOperational = true;
    // Maintain proper stack trace
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, AppError);
    }
  }
}

interface ZodIssue {
  path: (string | number)[];
  message: string;
}

interface ZodError extends Error {
  errors: ZodIssue[];
}

interface MulterError extends Error {
  code: string;
}

interface PrismaError extends Error {
  code: string;
}

/**
 * Centralised error-handling middleware.
 * Must be the LAST middleware registered (4-argument signature).
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: Error, req: Request, res: Response, next: NextFunction): void {
  // Log the full error in non-production environments
  if (config.env !== 'production') {
    console.error('[errorHandler]', err);
  } else {
    // In production only log operational errors at warn level; unexpected ones at error
    if ((err as AppError).isOperational) {
      console.warn('[errorHandler] operational:', err.message);
    } else {
      console.error('[errorHandler] unexpected:', err);
    }
  }

  // Zod validation errors
  if (err.name === 'ZodError') {
    const zodErr = err as unknown as ZodError;
    res.status(400).json({
      error: 'Validation error',
      issues: zodErr.errors.map((e) => ({
        path: e.path.join('.'),
        message: e.message,
      })),
    });
    return;
  }

  // Multer errors (should usually be caught in the upload middleware, but just in case)
  if (err.name === 'MulterError') {
    res.status(400).json({ error: 'Upload error', message: err.message });
    return;
  }

  // Prisma "record not found"
  if ((err as PrismaError).code === 'P2025') {
    res.status(404).json({ error: 'Not found', message: 'The requested record does not exist.' });
    return;
  }

  // Prisma unique constraint violation
  if ((err as PrismaError).code === 'P2002') {
    res.status(409).json({ error: 'Conflict', message: 'A record with that value already exists.' });
    return;
  }

  // HTTP-like errors with a .status or .statusCode property
  const statusCode = (err as AppError).status || (err as AppError).statusCode || 500;
  const message =
    statusCode < 500 || config.env !== 'production'
      ? err.message || 'An error occurred'
      : 'Internal server error';

  res.status(statusCode).json({
    error: statusCode >= 500 ? 'Internal server error' : 'Request error',
    message,
  });
}

/**
 * Small helper to create an operational HTTP error.
 */
export function createError(status: number, message: string): AppError {
  return new AppError(status, message);
}
