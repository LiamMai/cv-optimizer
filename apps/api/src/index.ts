import 'dotenv/config';

import express, { Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import path from 'path';
import fs from 'fs';

import config from './config';
import { errorHandler } from './middleware/errorHandler';
import { uploadDir } from './middleware/upload';
import { sessionMiddleware } from './middleware/sessionConfig';

// Routes
import cvRouter from './routes/cv';
import jdRouter from './routes/jd';
import optimizeRouter from './routes/optimize';
import modifyRouter from './routes/modify';
import exportRouter from './routes/export';
import authRouter from './routes/auth';

const app = express();

// Behind Render's TLS proxy: trust X-Forwarded-Proto so express sees the request
// as HTTPS and emits the Secure session cookie. Required for sameSite:'none'.
if (config.env === 'production') {
  app.set('trust proxy', 1);
}

// ---------------------------------------------------------------------------
// Security & request infrastructure
// ---------------------------------------------------------------------------
app.use(helmet());

// ---------------------------------------------------------------------------
// Session middleware (must come before routes)
// ---------------------------------------------------------------------------
app.use(sessionMiddleware);

app.use(
  cors({
    origin: config.cors.origin,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
  })
);

app.use(morgan(config.env === 'production' ? 'combined' : 'dev'));

// Global JSON body parser (multer-handled routes parse their own bodies)
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

// ---------------------------------------------------------------------------
// Rate limiting
// ---------------------------------------------------------------------------
const globalLimiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.max,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests', message: 'Please slow down and try again later.' },
});

// Stricter limiter for AI-powered endpoints (costs money per call)
const aiLimiter = rateLimit({
  windowMs: 60 * 1000,      // 1 minute window
  max: 10,                   // 10 AI calls per minute per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Rate limit exceeded', message: 'AI endpoints are limited to 10 requests per minute.' },
});

app.use(globalLimiter);

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------
app.get('/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    provider: config.ai.provider,
    env: config.env,
  });
});

// ---------------------------------------------------------------------------
// API routes
// ---------------------------------------------------------------------------
app.use('/api/v1/auth', authRouter);
app.use('/api/v1/cv', cvRouter);
app.use('/api/v1/jd', aiLimiter, jdRouter);
app.use('/api/v1/optimize', aiLimiter, optimizeRouter);
app.use('/api/v1/modify', aiLimiter, modifyRouter); // modify CV from user-provided data
app.use('/api/v1/export', exportRouter);

// 404 handler for unknown routes
app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: 'Not found', message: 'The requested endpoint does not exist.' });
});

// ---------------------------------------------------------------------------
// Global error handler (must be last)
// ---------------------------------------------------------------------------
app.use(errorHandler);

// ---------------------------------------------------------------------------
// File cleanup cron — delete uploads older than the retention period
// ---------------------------------------------------------------------------
function cleanupOldUploads(): void {
  const retentionMs = config.uploadRetentionMs;
  const now = Date.now();

  fs.readdir(uploadDir, (err, files) => {
    if (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.error('[cleanup] Failed to read upload directory:', err.message);
      }
      return;
    }

    let deleted = 0;
    let checked = 0;

    if (files.length === 0) return;

    for (const file of files) {
      const filePath = path.join(uploadDir, file);
      fs.stat(filePath, (statErr, stats) => {
        checked++;
        if (!statErr && now - stats.mtimeMs > retentionMs) {
          fs.unlink(filePath, (unlinkErr) => {
            if (!unlinkErr) {
              deleted++;
              if (config.env !== 'production') {
                console.log(`[cleanup] Removed stale upload: ${file}`);
              }
            }
          });
        }
        if (checked === files.length && deleted > 0) {
          console.log(`[cleanup] Removed ${deleted} stale upload(s).`);
        }
      });
    }
  });
}

// Run cleanup every 30 minutes
const CLEANUP_INTERVAL_MS = 30 * 60 * 1000;
const cleanupInterval = setInterval(cleanupOldUploads, CLEANUP_INTERVAL_MS);
// Run once at startup (after a short delay so the process is fully initialised)
setTimeout(cleanupOldUploads, 5000);

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------
const PORT = config.port;
const server = app.listen(PORT, () => {
  console.log(`[api] CV Optimizer API running on port ${PORT} (${config.env})`);
  console.log(`[api] AI provider: ${config.ai.provider}`);
  console.log(`[api] Health: http://localhost:${PORT}/health`);
});

// Graceful shutdown
function shutdown(signal: string): void {
  console.log(`\n[api] Received ${signal}. Shutting down gracefully…`);
  clearInterval(cleanupInterval);
  server.close(() => {
    console.log('[api] HTTP server closed.');
    process.exit(0);
  });

  // Force close after 10 seconds
  setTimeout(() => {
    console.error('[api] Forcing shutdown after timeout.');
    process.exit(1);
  }, 10_000);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

export default app; // for testing
