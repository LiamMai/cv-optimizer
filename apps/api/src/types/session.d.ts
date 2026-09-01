import 'express-session';
import type { SessionCredentials } from '../services/aiProvider';

declare module 'express-session' {
  interface SessionData {
    credentials?: SessionCredentials;
    user?: {
      email: string;
      name: string;
      picture?: string;
    };
  }
}
