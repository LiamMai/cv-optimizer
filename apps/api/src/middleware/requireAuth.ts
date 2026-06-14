import { Request, Response, NextFunction } from 'express';

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const creds = (req.session as any).credentials;
  if (!creds) {
    return res.status(401).json({ error: 'Authentication required. Please connect an AI provider.' });
  }
  next();
}
