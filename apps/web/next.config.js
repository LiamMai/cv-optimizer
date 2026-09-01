const path = require('path');
const dotenv = require('dotenv');

// Single root-level env file shared with apps/api (see repo root .env.example):
// frontend vars are NEXT_PUBLIC_-prefixed, backend vars are API_-prefixed —
// each app only reads its own subset, so sharing one file is safe. This must
// run before nextConfig is built so process.env is populated when Next.js
// inlines NEXT_PUBLIC_* vars during the build/dev compile.
// `next dev` reads root .env.local (gitignored, untracked); `next start`
// (NODE_ENV=production) reads only root .env.
const ROOT = path.resolve(__dirname, '../../');
if (process.env.NODE_ENV !== 'production') {
  dotenv.config({ path: path.join(ROOT, '.env.local') });
}
dotenv.config({ path: path.join(ROOT, '.env') });

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'standalone', // required for Docker production image
};
module.exports = nextConfig;
