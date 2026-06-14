import express, { Router, Request, Response, NextFunction } from 'express';
import { getAuthUrl, exchangeCode, getUserInfo } from '../services/googleOAuth';
import { encrypt } from '../services/encryption';

const router: Router = express.Router();

const ALLOWED_PROVIDERS = ['claude', 'openai', 'gemini', 'groq'] as const;
type AllowedProvider = (typeof ALLOWED_PROVIDERS)[number];

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';

// ---------------------------------------------------------------------------
// GET /api/v1/auth/google — redirect to Google OAuth consent screen
// ---------------------------------------------------------------------------
router.get('/google', (_req: Request, res: Response) => {
  const url = getAuthUrl();
  res.redirect(url);
});

// ---------------------------------------------------------------------------
// GET /api/v1/auth/google/callback — handle OAuth code exchange
// ---------------------------------------------------------------------------
router.get('/google/callback', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const code = req.query.code as string | undefined;
    const error = req.query.error as string | undefined;

    if (error) {
      return res.redirect(`${FRONTEND_URL}/auth/error?reason=${encodeURIComponent(error)}`);
    }

    if (!code) {
      return res.redirect(`${FRONTEND_URL}/auth/error?reason=missing_code`);
    }

    // Exchange code for tokens
    const tokens = await exchangeCode(code);

    if (!tokens.access_token) {
      return res.redirect(`${FRONTEND_URL}/auth/error?reason=no_access_token`);
    }

    // Get user info
    const userInfo = await getUserInfo(tokens.access_token);

    // Encrypt tokens and store in session
    (req.session as any).credentials = {
      provider: 'gemini-oauth',
      encryptedAccessToken: encrypt(tokens.access_token),
      encryptedRefreshToken: tokens.refresh_token ? encrypt(tokens.refresh_token) : undefined,
      tokenExpiry: tokens.expiry_date ?? Date.now() + 3600000,
    };

    (req.session as any).user = {
      email: userInfo.email || '',
      name: userInfo.name || '',
      picture: userInfo.picture || undefined,
    };

    req.session.save((err) => {
      if (err) return next(err);
      res.redirect(`${FRONTEND_URL}/auth/callback`);
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// POST /api/v1/auth/api-key — submit a provider API key
// ---------------------------------------------------------------------------
router.post('/api-key', express.json(), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { provider, apiKey } = req.body as { provider?: string; apiKey?: string };

    if (!provider || !ALLOWED_PROVIDERS.includes(provider as AllowedProvider)) {
      return res.status(400).json({
        error: 'Invalid provider',
        message: `provider must be one of: ${ALLOWED_PROVIDERS.join(', ')}`,
      });
    }

    if (!apiKey || typeof apiKey !== 'string' || apiKey.trim().length < 20) {
      return res.status(400).json({
        error: 'Invalid API key',
        message: 'apiKey must be a non-empty string with at least 20 characters.',
      });
    }

    // Encrypt and store — never echo back
    (req.session as any).credentials = {
      provider,
      encryptedApiKey: encrypt(apiKey.trim()),
    };

    req.session.save((err) => {
      if (err) return next(err);
      res.json({ success: true, provider });
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/v1/auth/logout — destroy session
// ---------------------------------------------------------------------------
router.delete('/logout', (req: Request, res: Response, next: NextFunction) => {
  req.session.destroy((err) => {
    if (err) return next(err);
    res.clearCookie('cvo.sid');
    res.json({ success: true, message: 'Logged out.' });
  });
});

// ---------------------------------------------------------------------------
// GET /api/v1/auth/me — current session info (never returns keys)
// ---------------------------------------------------------------------------
router.get('/me', (req: Request, res: Response) => {
  const creds = (req.session as any).credentials as
    | { provider: string }
    | undefined;
  const user = (req.session as any).user as
    | { email: string; name: string; picture?: string }
    | undefined;

  if (!creds) {
    return res.json({ authenticated: false });
  }

  const response: Record<string, unknown> = {
    authenticated: true,
    provider: creds.provider,
  };

  if (user) {
    response.user = { email: user.email, name: user.name };
  }

  res.json(response);
});

export default router;
