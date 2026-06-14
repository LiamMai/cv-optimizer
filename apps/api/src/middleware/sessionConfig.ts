import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';
import { Pool } from 'pg';

const PgStore = connectPgSimple(session);
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const TTL_HOURS = parseInt(process.env.SESSION_TTL_HOURS || '2');

export const sessionMiddleware = session({
  store: new PgStore({ pool, createTableIfMissing: true }),
  secret: process.env.SESSION_SECRET!,
  resave: false,
  saveUninitialized: false,
  name: 'cvo.sid', // non-default name
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    // 'strict' blocks cross-port (localhost:3000 → localhost:3001) in dev.
    // 'lax' allows top-level navigations (OAuth redirects) while still blocking
    // cross-site POST fetch. In prod with HTTPS + same domain, switch to 'strict'.
    sameSite: process.env.NODE_ENV === 'production' ? 'strict' : 'lax',
    maxAge: TTL_HOURS * 60 * 60 * 1000,
  },
});
