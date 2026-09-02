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

# prisma (from apps/api) — db:push/migrate/studio are wrapped with dotenv-cli
# to load the root .env.local/.env (Prisma's own env("API_DATABASE_URL") in
# schema.prisma has no knowledge of config/index.ts's dotenv loading, so a
# bare `npx prisma ...` fails with "Environment variable not found")
pnpm db:migrate --name <x>
pnpm db:generate
pnpm db:studio
```

No test suite. Verify changes with `type-check` / `tsc --noEmit` and by running the app.

## AI architecture (read before touching AI)

`apps/api/src/services/aiProvider.ts` is the single dispatch point. Providers:

- **BYO key** — `claude`, `openai`, `gemini`, `groq`. Key submitted via `POST /auth/api-key`, AES-encrypted (`encryption.ts`, `API_ENCRYPTION_KEY`), held only in the session. Never logged, never persisted to DB. The `groq` BYO path, like the free path below, cascades through `FREE_MODELS` on a 429/413 rather than calling a single fixed model.
- **`groq-free`** — keyless "Free AI". Runs on the server's shared `API_GROQ_API_KEY`. User picks a model from `FREE_MODELS` (default `openai/gpt-oss-120b`). This is the default mode. Pollinations/anonymous endpoints were tried and dropped (rate-limited, truncated JSON). Groq has repeatedly retired non-`gpt-oss` Production-tier models on short notice (`llama-3.1-8b-instant`, `llama-3.3-70b-versatile`, `llama-4-scout-17b-16e-instruct` all died within months of each other in mid-2026) — `FREE_MODELS` now only carries `openai/gpt-oss-120b`/`-20b` and the two `groq/compound`/`compound-mini` Production Systems (each its own rate-limit bucket — 70K TPM vs 8K for the gpt-oss models), listed last as the escape hatches. `compound` is unverified for this app's structured-JSON prompts (more agentic than `compound-mini`, which was tested clean) — watch for it correlating with JSON-parse failures in logs. `_callGroqCascading` tries the selected/default model first, then walks the rest of `FREE_MODELS` on a 429 (rate limit) or 413 (too large) instead of just retrying the same exhausted model — see the comment above `FREE_MODELS` in `aiProvider.ts` for how to verify a model's tier before adding one back.
- **`gemini-oauth`** — Google sign-in. Legacy; currently routed through the server Groq key like `groq-free`.

Entry point is `createCompletionFromSession(session, messages, options)`. `createCompletion(...)` is the **deprecated** env-key fallback (`API_AI_PROVIDER` + `API_*_API_KEY`) — don't build new features on it.

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

Typography: Inter by default (fetched from Google Fonts inside the Chromium page — needs outbound network in prod, else it silently falls back to Helvetica), 11pt body / 25pt name / 15pt header title / 13pt section headings. Page-break rules: pages fill — entries break at bullet boundaries, but an entry header + the first ~2 lines of its first bullet (`orphans:2`) never separate, and headings glue to their first content. `_measureBottom` simulates these breaks (including `orphans`/`widows` line-level splits for `<li>`/`p.summary`, not just atomic `header`/`h2`/`.entry` blocks) so `_fitToPages`'s page-count prediction matches what Chromium actually prints — it MUST list the same atomic elements and split rules as the CSS break rules — change one, change both. The editor's paginated preview (`PaginatedCv` in `apps/web/src/components/editor/CvPaper.tsx`) mirrors these fonts/sizes/break rules client-side, including a matching font-scale fit/compaction pass, so it renders the same page count and breaks as the exported PDF; keep it in sync with the template.

**Block editor** — `BlockEditor.tsx` (same directory) is the structured, Canva-style editing surface: a flowing (non-paginated) list of drag-reorderable/click-to-edit sections/entries/bullets, built on `dnd-kit`. It can't live inside `PaginatedCv` itself — that renderer can render one block twice (split across a page-break clip), which breaks dnd-kit's one-DOM-node-per-sortable-id assumption — so it's a separate component, and the editor page's "Preview" tab reuses `PaginatedCv` read-only to show real page breaks. Every edit re-parses/re-serializes through the same `formatSection()`/`blocksToContent()` pair `PaginatedCv` already uses, and writes the resulting flat string back via `updateSectionContent` (`store/cvStore.ts`) into `optimizationJob.result.optimizedSections` — the wire/server shape is untouched, so edits reach `/export/*` for free through the existing per-section override mechanism (no server changes for content edits). A debounced call to `POST /optimize/:jobId/score` (cheap, non-AI — reuses `atsScorer.score()`) keeps the header ATS score live after each edit. Section *drag order* (`sectionOrder` in the store) is preview-only: it's threaded into `sortByPdfOrder`'s optional second param for the block editor and Preview tab, but is **not** sent to `/export/*` — section order in exports is still hardcoded separately in `PDF_SECTION_ORDER` (client) and three places in `exporter.ts` (HTML/pdfkit/DOCX), which would need their own change to honor a custom order.

**Style hints** — `parser.ts` recovers `StyleHints` (`headingFont`/`bodyFont`/`accentColor`) from DOCX/PPTX (direct OOXML walk via `jszip` + `fast-xml-parser` — `mammoth.extractRawText` is style-blind by design, so it isn't used for DOCX section content anymore) and, best-effort, from PDF (`pdfjs-dist`'s `getTextContent()` font-family + a "Bold"/"Black" name heuristic; no color, not exposed by that API). OCR'd images/scanned PDFs carry no style. Bold/italic emphasis is embedded into the plain-text section strings as `**bold**`/`*italic*` markdown, the same pattern already used for PDF link recovery (`injectLinkAnchors`) — parsed back out by `_parseInlineRuns` in `exporter.ts` and `parseInline` in `apps/web/src/lib/cvFormat.ts`, which **must stay in sync** with each other (mirrors the existing link-syntax duplication between those two files). `StyleHints` live on `CVRecord` (`routes/cv.ts`), are looked up by `cvId` — never by `jobId` — since the AI rewrite never touches them, and are applied at export time: Puppeteer/HTML and the web preview bucket the detected font into a small curated Google-Fonts-safe set (arbitrary system fonts aren't installed in the Chromium container or most browsers); pdfkit buckets into its 14 standard fonts (no font embedding); DOCX passes the font name through literally (it renders client-side in the user's own Word, which substitutes locally if the font is missing).

## Conventions

- Conventional Commits. Recent history: `feat(ai):`, `refactor(cv-editor):`.
- `packages/shared/src/types.ts` is currently **unused dead code** — neither `apps/api` nor `apps/web` imports `@cv-optimizer/shared` anywhere (confirmed via repo-wide grep). The real CV data shape is `CVSections` in `apps/api/src/routes/cv.ts` (flat per-section strings), independently mirrored client-side by `apps/web/src/lib/types.ts`'s `CVSection[]`. Don't add to `packages/shared` expecting it to be picked up — change both real copies, or treat reconciling them as its own separate cleanup task.
- Secrets (API keys, OAuth tokens) stay encrypted + session-scoped; `/auth/me` returns `{ provider, model? }` only, never keys/tokens.
- Rate limits: 100 req/15min global; 10 req/min on `/jd` + `/optimize` + `/modify` (POST only — the `GET /optimize/:jobId` status poll is exempt, else the client poller 429s its own running job).
- Env vars live in **one root-level file** (`.env.example` / `.env.prod.example`), not per-app: backend vars are `API_`-prefixed (read via `apps/api/src/config/index.ts` and a handful of files that read `process.env` directly — `sessionConfig.ts`, `encryption.ts`, `googleOAuth.ts`, `exporter.ts`, `routes/auth.ts`), frontend vars are `NEXT_PUBLIC_`-prefixed (Next.js's own convention for browser-exposed vars). `PORT`/`NODE_ENV` stay unprefixed — Render injects `PORT` directly and expects that exact name. `pnpm dev` reads root `.env.local`; `pnpm start` reads root `.env` and never touches `.env.local`. Both `apps/api/src/config/index.ts` and `apps/web/next.config.js` resolve the root path via `__dirname`, so this works regardless of cwd. Adding a new backend env var: add it with the `API_` prefix in both `.env.example` and `.env.prod.example`, and to `render.yaml`'s `envVars` if it's needed in production.

## Keep docs in sync (do this automatically)

Whenever a change adds a feature, a new route/service/page, or alters an existing flow, **update `README.md` and this `CLAUDE.md` in the same change** — don't wait to be asked. What to touch, by change type:

- **New API route** → README "API Reference" table (+ body example if it takes one) and "Rate Limits" if it sits behind a limiter; CLAUDE.md if it introduces a new flow/dispatch point.
- **New service / page / store** → README "Project Structure" tree (one line each); CLAUDE.md only if it changes how a subsystem works (AI dispatch, export, auth, job pipeline).
- **New user-facing feature** → README "What it does"; a short note here if there's a non-obvious wiring detail (e.g. shared `jobStore`, client-only history).
- **New AI provider / free model** → keep `FREE_MODELS` + `PROVIDERS` + README "AI Providers" tables in agreement.
- **New / changed env var** → README "Environment Variables" table.

Keep edits surgical and match the surrounding doc style (terse tables, the box-drawing tree). If a change is purely internal (refactor, no behavior/contract change), docs may not need touching — say so rather than padding them.
