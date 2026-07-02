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
- **`groq-free`** — keyless "Free AI". Runs on the server's shared `GROQ_API_KEY`. User picks a model from `FREE_MODELS` (default `openai/gpt-oss-120b`; llama-3.3-70b was dropped when Groq deprecated it). This is the default mode. Pollinations/anonymous endpoints were tried and dropped (rate-limited, truncated JSON).
- **`gemini-oauth`** — Google sign-in. Legacy; currently routed through the server Groq key like `groq-free`.

Entry point is `createCompletionFromSession(session, messages, options)`. `createCompletion(...)` is the **deprecated** env-key fallback (`AI_PROVIDER` + `*_API_KEY`) — don't build new features on it.

When adding a free model: update `FREE_MODELS` in `aiProvider.ts` AND `PROVIDERS` in `apps/web/src/lib/providers.ts` (they must agree; the server validates the picked model against `FREE_MODELS`).

AI output is JSON; models emit dirty JSON often. Use `parseJsonResponse()` — it strips fences, narrows to the JSON body, and repairs literal control chars in strings. Don't hand-roll `JSON.parse` on AI output.

## Two AI flows: optimize vs modify

There are two job-producing flows, and they share one store + one poll + one editor:

- **Optimize** (`routes/optimize.ts` → `services/cvOptimizer.ts`) — tailor CV to a JD.
- **Modify** (`routes/modify.ts` → `services/cvModifier.ts`) — fold free-form user notes into the CV, **no JD**. `POST /api/v1/modify { cvId, userData, config }` (under `aiLimiter`). Result is tagged `kind: 'modify'` and carries `changes[]`, `removed[]`, `needsMoreInfo[{section,question}]`, `sourceNotes`.

Modify writes into the **shared `jobStore`** (from `routes/optimize.ts`) so `GET /api/v1/optimize/:jobId`, the split-diff editor, and export all work unchanged — don't fork a parallel job pipeline. Both result shapes are unified in `OptimizationResult` (`packages/shared/src/types.ts`); the `kind`/`changes`/`removed`/`needsMoreInfo` fields are optional and modify-only.

History is **client-only**: `apps/web/src/store/historyStore.ts`, a Zustand store persisted to localStorage (`cv-optimizer-history`). No DB table, no API. It records `{ id (=jobId), company, jobTitle, cvId, jdId, appliedAt, atsScore? }`.

## Export

`apps/api/src/services/exporter.ts`. PDF = build HTML from the CV template, render via **Puppeteer/Chromium**; falls back to `pdfkit` when Chromium is unavailable. **Prod must ship Chromium** or PDFs degrade to the pdfkit fallback. DOCX via `docx`.

Typography: Inter (fetched from Google Fonts inside the Chromium page — needs outbound network in prod, else it silently falls back to Helvetica), 11pt body / 25pt name / 15pt header title / 13pt section headings. Page-break rules: pages fill — entries break at bullet boundaries, but an entry header + its first two bullets never separate, and headings glue to their first content. The `_measureBottom` pagination simulation MUST list the same atomic elements as the CSS break rules — change one, change both. The editor's paginated preview (`PaginatedCv` in `apps/web/src/components/editor/CvPaper.tsx`) mirrors these fonts/sizes/break rules client-side; keep it in sync with the template.

## Conventions

- Conventional Commits. Recent history: `feat(ai):`, `refactor(cv-editor):`.
- Cross-app types live in `packages/shared` — change there, not duplicated per app.
- Secrets (API keys, OAuth tokens) stay encrypted + session-scoped; `/auth/me` returns `{ provider, model? }` only, never keys/tokens.
- Rate limits: 100 req/15min global; 10 req/min on `/jd` + `/optimize` + `/modify` (POST only — the `GET /optimize/:jobId` status poll is exempt, else the client poller 429s its own running job).

## Keep docs in sync (do this automatically)

Whenever a change adds a feature, a new route/service/page, or alters an existing flow, **update `README.md` and this `CLAUDE.md` in the same change** — don't wait to be asked. What to touch, by change type:

- **New API route** → README "API Reference" table (+ body example if it takes one) and "Rate Limits" if it sits behind a limiter; CLAUDE.md if it introduces a new flow/dispatch point.
- **New service / page / store** → README "Project Structure" tree (one line each); CLAUDE.md only if it changes how a subsystem works (AI dispatch, export, auth, job pipeline).
- **New user-facing feature** → README "What it does"; a short note here if there's a non-obvious wiring detail (e.g. shared `jobStore`, client-only history).
- **New AI provider / free model** → keep `FREE_MODELS` + `PROVIDERS` + README "AI Providers" tables in agreement.
- **New / changed env var** → README "Environment Variables" table.

Keep edits surgical and match the surrounding doc style (terse tables, the box-drawing tree). If a change is purely internal (refactor, no behavior/contract change), docs may not need touching — say so rather than padding them.
