import 'dotenv/config';

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
    url: process.env.DATABASE_URL || '',
  },

  ai: {
    provider: (process.env.AI_PROVIDER || 'claude').toLowerCase(),
    openaiApiKey: process.env.OPENAI_API_KEY || '',
    anthropicApiKey: process.env.ANTHROPIC_API_KEY || '',
    geminiApiKey: process.env.GEMINI_API_KEY || '',
    groqApiKey: process.env.GROQ_API_KEY || '',
    openaiModel: 'gpt-4o',
    anthropicModel: 'claude-sonnet-4-6',
  },

  auth: {
    jwtSecret: process.env.JWT_SECRET || 'dev-secret-change-in-prod',
  },

  session: {
    encryptionKey: process.env.ENCRYPTION_KEY || '',
    sessionSecret: process.env.SESSION_SECRET || '',
    googleClientId: process.env.GOOGLE_CLIENT_ID || '',
    googleClientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
    googleRedirectUri: process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3001/api/v1/auth/google/callback',
    sessionTtlHours: parseInt(process.env.SESSION_TTL_HOURS || '2', 10),
  },

  upload: {
    dir: process.env.UPLOAD_DIR || 'uploads',
    maxFileSizeMb: parseInt(process.env.MAX_FILE_SIZE_MB || '10', 10),
    allowedMimeTypes: [
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'text/plain',
    ],
  },

  cors: {
    origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
  },

  rateLimit: {
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100,
  },

  // Files older than this (in ms) will be cleaned up
  uploadRetentionMs: 60 * 60 * 1000, // 1 hour

  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:3000',
};

// Validate critical config at startup
function validate(): void {
  const errors: string[] = [];

  if (!config.ai.anthropicApiKey && config.ai.provider === 'claude') {
    errors.push('ANTHROPIC_API_KEY is required when AI_PROVIDER=claude');
  }
  if (!config.ai.openaiApiKey && config.ai.provider === 'openai') {
    errors.push('OPENAI_API_KEY is required when AI_PROVIDER=openai');
  }
  if (!['claude', 'openai'].includes(config.ai.provider)) {
    errors.push(`AI_PROVIDER must be "claude" or "openai", got "${config.ai.provider}"`);
  }

  // Session security warnings
  if (!config.session.encryptionKey || config.session.encryptionKey.length !== 64) {
    console.warn(
      '[config] WARNING: ENCRYPTION_KEY is missing or not 64 hex characters. ' +
      'Generate one with: openssl rand -hex 32'
    );
  }
  if (!config.session.sessionSecret) {
    console.warn(
      '[config] WARNING: SESSION_SECRET is not set. ' +
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
