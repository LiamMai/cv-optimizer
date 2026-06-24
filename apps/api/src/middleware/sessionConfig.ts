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
    // Prod is cross-site (web on Vercel → API on Render), so the cookie must be
    // 'none' or the browser drops it on XHR/fetch. 'none' requires secure:true
    // (set above) + `app.set('trust proxy', 1)` so express emits Secure behind
    // Render's TLS proxy. Dev stays 'lax' (http localhost can't use 'none').
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
    maxAge: TTL_HOURS * 60 * 60 * 1000,
  },
});
