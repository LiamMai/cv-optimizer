import dotenv from 'dotenv';
import path from 'path';

// Single root-level env file shared with apps/web (see repo root .env.example):
// backend vars are API_-prefixed, frontend vars are NEXT_PUBLIC_-prefixed —
// each app only reads its own subset, so sharing one file is safe.
// `pnpm dev` sets NODE_ENV=development and reads root .env.local (gitignored,
// untracked); `pnpm start` sets NODE_ENV=production and reads only root .env —
// .env.local is never consulted in production, even if one happens to be
// present on the host. __dirname here (src/config or, once built, dist/config)
// is the same depth below the repo root either way.
const ROOT = path.resolve(__dirname, '../../../../');
if (process.env.NODE_ENV !== 'production') {
  dotenv.config({ path: path.join(ROOT, '.env.local') });
}
dotenv.config({ path: path.join(ROOT, '.env') });

export interface AppConfig {
  env: string;
  port: number;
  database: {
    url: string;
  };
  ai: {
    provider: string;
    openaiApiKey: string;
    anthropicApiKey: string;
    geminiApiKey: string;
    groqApiKey: string;
    openaiModel: string;
    anthropicModel: string;
  };
  auth: {
    jwtSecret: string;
  };
  session: {
    encryptionKey: string;
    sessionSecret: string;
    googleClientId: string;
    googleClientSecret: string;
    googleRedirectUri: string;
    sessionTtlHours: number;
  };
  upload: {
    dir: string;
    maxFileSizeMb: number;
    allowedMimeTypes: string[];
  };
  cors: {
    origin: string;
  };
  rateLimit: {
    windowMs: number;
    max: number;
  };
  uploadRetentionMs: number;
  frontendUrl: string;
}

const config: AppConfig = {
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '3001', 10),

  database: {
    url: process.env.API_DATABASE_URL || '',
  },

  ai: {
    provider: (process.env.API_AI_PROVIDER || 'claude').toLowerCase(),
    openaiApiKey: process.env.API_OPENAI_API_KEY || '',
    anthropicApiKey: process.env.API_ANTHROPIC_API_KEY || '',
    geminiApiKey: process.env.API_GEMINI_API_KEY || '',
    groqApiKey: process.env.API_GROQ_API_KEY || '',
    openaiModel: 'gpt-4o',
    anthropicModel: 'claude-sonnet-4-6',
  },

  auth: {
    jwtSecret: process.env.API_JWT_SECRET || 'dev-secret-change-in-prod',
  },

  session: {
    encryptionKey: process.env.API_ENCRYPTION_KEY || '',
    sessionSecret: process.env.API_SESSION_SECRET || '',
    googleClientId: process.env.API_GOOGLE_CLIENT_ID || '',
    googleClientSecret: process.env.API_GOOGLE_CLIENT_SECRET || '',
    googleRedirectUri: process.env.API_GOOGLE_REDIRECT_URI || 'http://localhost:3001/api/v1/auth/google/callback',
    sessionTtlHours: parseInt(process.env.API_SESSION_TTL_HOURS || '2', 10),
  },

  upload: {
    dir: process.env.API_UPLOAD_DIR || 'uploads',
    maxFileSizeMb: parseInt(process.env.API_MAX_FILE_SIZE_MB || '10', 10),
    allowedMimeTypes: [
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'text/plain',
    ],
  },

  cors: {
    origin: process.env.API_CORS_ORIGIN || 'http://localhost:3000',
  },

  rateLimit: {
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100,
  },

  // Files older than this (in ms) will be cleaned up
  uploadRetentionMs: 60 * 60 * 1000, // 1 hour

  frontendUrl: process.env.API_FRONTEND_URL || 'http://localhost:3000',
};

// Validate critical config at startup
function validate(): void {
  const errors: string[] = [];

  if (!config.ai.anthropicApiKey && config.ai.provider === 'claude') {
    errors.push('API_ANTHROPIC_API_KEY is required when API_AI_PROVIDER=claude');
  }
  if (!config.ai.openaiApiKey && config.ai.provider === 'openai') {
    errors.push('API_OPENAI_API_KEY is required when API_AI_PROVIDER=openai');
  }
  if (!['claude', 'openai'].includes(config.ai.provider)) {
    errors.push(`API_AI_PROVIDER must be "claude" or "openai", got "${config.ai.provider}"`);
  }

  // Session security warnings
  if (!config.session.encryptionKey || config.session.encryptionKey.length !== 64) {
    console.warn(
      '[config] WARNING: API_ENCRYPTION_KEY is missing or not 64 hex characters. ' +
      'Generate one with: openssl rand -hex 32'
    );
  }
  if (!config.session.sessionSecret) {
    console.warn(
      '[config] WARNING: API_SESSION_SECRET is not set. ' +
      'Session security will be compromised in production.'
    );
  }

  if (errors.length > 0) {
    console.warn('[config] Configuration warnings:');
    errors.forEach((e) => console.warn(`  - ${e}`));
  }
}

validate();

export default config;
