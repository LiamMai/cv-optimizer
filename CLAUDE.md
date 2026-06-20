# CLAUDE.md

Guidance for working in this repo. See `README.md` for full feature/API docs.

## What this is

CVOptimizer — pnpm monorepo. AI tailors a CV to a job description, scores ATS, lets the user edit + export. Two apps:

- `apps/api` — Express + TypeScript + Prisma (PostgreSQL). Package name `cv-optimizer-api`.
- `apps/web` — Next.js 14 (App Router) + TypeScript + Tailwind + Zustand + TipTap. Package name `@cv-optimizer/web`.
- `packages/shared` — shared TS types (`CVSection`, `JDAnalysis`, `ATSScore`, …). Source of truth for cross-app contracts.

## Commands

```bash
pnpm dev          # db:up + web + api concurrently (from root)
pnpm dev:api      # API only → :3001
pnpm dev:web      # web only → :3000
pnpm build        # build web + api
pnpm db:up        # docker postgres (docker-compose.dev.yml)

# type check
pnpm --filter @cv-optimizer/web type-check
cd apps/api && npx tsc --noEmit

# prisma (from apps/api)
npx prisma migrate dev --name <x>
npx prisma generate
npx prisma studio
```

No test suite. Verify changes with `type-check` / `tsc --noEmit` and by running the app.

## AI architecture (read before touching AI)

`apps/api/src/services/aiProvider.ts` is the single dispatch point. Providers:

- **BYO key** — `claude`, `openai`, `gemini`, `groq`. Key submitted via `POST /auth/api-key`, AES-encrypted (`encryption.ts`, `ENCRYPTION_KEY`), held only in the session. Never logged, never persisted to DB.
- **`groq-free`** — keyless "Free AI". Runs on the server's shared `GROQ_API_KEY`. User picks a model from `FREE_MODELS` (default `llama-3.3-70b-versatile`). This is the default mode. Pollinations/anonymous endpoints were tried and dropped (rate-limited, truncated JSON).
- **`gemini-oauth`** — Google sign-in. Legacy; currently routed through the server Groq key like `groq-free`.

Entry point is `createCompletionFromSession(session, messages, options)`. `createCompletion(...)` is the **deprecated** env-key fallback (`AI_PROVIDER` + `*_API_KEY`) — don't build new features on it.

When adding a free model: update `FREE_MODELS` in `aiProvider.ts` AND `PROVIDERS` in `apps/web/src/lib/providers.ts` (they must agree; the server validates the picked model against `FREE_MODELS`).

AI output is JSON; models emit dirty JSON often. Use `parseJsonResponse()` — it strips fences, narrows to the JSON body, and repairs literal control chars in strings. Don't hand-roll `JSON.parse` on AI output.

## Export

`apps/api/src/services/exporter.ts`. PDF = build HTML from the CV template, render via **Puppeteer/Chromium**; falls back to `pdfkit` when Chromium is unavailable. **Prod must ship Chromium** or PDFs degrade to the pdfkit fallback. DOCX via `docx`.

## Conventions

- Conventional Commits. Recent history: `feat(ai):`, `refactor(cv-editor):`.
- Cross-app types live in `packages/shared` — change there, not duplicated per app.
- Secrets (API keys, OAuth tokens) stay encrypted + session-scoped; `/auth/me` returns `{ provider, model? }` only, never keys/tokens.
- Rate limits: 100 req/15min global; 10 req/min on `/jd` + `/optimize`.
