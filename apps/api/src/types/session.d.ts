import 'express-session';

declare module 'express-session' {
  interface SessionData {
    credentials?: {
      provider: string;
      encryptedApiKey?: string;
      encryptedAccessToken?: string;
      encryptedRefreshToken?: string;
      tokenExpiry?: number;
    };
    user?: {
      email: string;
      name: string;
      picture?: string;
    };
  }
}
