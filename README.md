# CVOptimizer

AI-powered resume builder that tailors your CV to any job description. Parses your existing CV, analyzes the JD, rewrites content for ATS compatibility, and — for DOCX/PPTX and best-effort PDF sources — carries the original's fonts, emphasis, and accent color into the export.

**Live demo:** https://cv-optimizer-web-delta.vercel.app

## What it does

1. **Upload CV** — PDF, DOCX, PPTX, PNG/JPEG (via OCR), or paste text. Extracts all sections automatically; DOCX/PPTX and PDF also recover style hints (fonts, bold/italic, accent color) — OCR'd images carry text only, no style.
2. **Paste JD** — Extracts required skills, keywords, seniority level, responsibilities.
3. **AI Optimization** — Rewrites bullet points and sections to match the JD while keeping bold/italic emphasis intact. Enforces human-like writing, no hallucination, measurable achievements.
4. **ATS Score** — 0–100 score with keyword gap analysis and section-by-section breakdown.
5. **Edit & Export** — TipTap rich-text editor with accept/reject per-section diffs. Paginated A4 preview mirrors the PDF (same fonts/sizes, style hints applied, same page-break rules — pages fill, and an entry header never separates from its first bullets). Export to PDF or DOCX.
6. **Modify from your data** — Skip the JD: hand the AI free-form notes (new role, fresh metrics, projects to drop) and it folds them into the right sections, mirrors existing entry structure, re-sorts by date, and asks follow-up questions where your notes are too thin. Returns the same accept/reject diff as optimization.
7. **History** — Every job is remembered locally (company, job title, ATS score, date) so you can re-open past results and track which companies you've applied to.

---

## AI Providers

Pick how the AI runs from the **Connect Provider** screen. Three ways:

| Mode | How | Setup |
|---|---|---|
| **Free AI** (default) | Keyless. Runs on the server's shared Groq key — no sign-in, no API key. Choose a model in the picker. | Server needs `API_GROQ_API_KEY` |
| **Google (Gemini)** | OAuth — sign in with Google, free tier (1,500 req/day). | `API_GOOGLE_CLIENT_ID` / `API_GOOGLE_CLIENT_SECRET` |
| **Bring your own key** | Paste an API key for Anthropic Claude, OpenAI, Google Gemini, or Groq. Key is encrypted into your session, never stored. | none |

**Free AI models** (`groq-free`):

| Model | Notes |
|---|---|
| `openai/gpt-oss-120b` | Default — best quality (8K TPM free limit) |
| `openai/gpt-oss-20b` | Fastest (8K TPM free limit) |
| `groq/compound-mini` | Long CVs — biggest free limit (70K TPM); also used automatically as the retry fallback when a request hits the 413 TPM cap on the default model |

> **Note:** Free/OAuth tiers have rate limits. Responses may be slow or temporarily unavailable under load. Groq has repeatedly deprecated non-`gpt-oss` free models on short notice (three in mid-2026 alone) — verify a model's current status at [console.groq.com/docs/models](https://console.groq.com/docs/models) before relying on it long-term.

---

## Tech Stack

| Layer | Tech |
|---|---|
| Frontend | Next.js 14, TypeScript, TailwindCSS, Zustand, TipTap, React Hook Form |
| Backend | Node.js, Express, TypeScript |
| AI | Anthropic Claude, OpenAI, Google Gemini, Groq — selectable per session |
| Database | PostgreSQL via Prisma ORM |
| Parsers | `pdfjs-dist` + `pdf-parse` (PDF), `tesseract.js` + `pdf-to-img` (OCR), `jszip` + `fast-xml-parser` (DOCX/PPTX) |
| Export | `puppeteer` (PDF, HTML→Chromium template; `pdfkit` fallback), `docx` (DOCX), `archiver` |
| Package manager | pnpm |

---

## Project Structure

```
cv-optimizer/
├── apps/
│   ├── api/                    Express API
│   │   ├── prisma/
│   │   │   └── schema.prisma   DB models: User, CV, JD, OptimizationJob
│   │   └── src/
│   │       ├── config/         Env config with validation
│   │       ├── middleware/     Multer upload, error handler
│   │       ├── routes/         cv, jd, optimize, modify, export, auth
│   │       └── services/
│   │           ├── aiProvider.ts    Multi-provider AI dispatch (Claude/OpenAI/Gemini/Groq + keyless groq-free)
│   │           ├── googleOAuth.ts   Google OAuth flow
│   │           ├── encryption.ts    AES encrypt/decrypt for session-held keys
│   │           ├── parser.ts        PDF/DOCX/TXT → structured sections
│   │           ├── jdAnalyzer.ts    JD → keywords/requirements
│   │           ├── atsScorer.ts     0–100 ATS scoring engine
│   │           ├── cvOptimizer.ts   Core AI rewriter + master prompt
│   │           ├── cvModifier.ts    Fold user notes into CV (no JD); changes/removed/needsMoreInfo
│   │           └── exporter.ts      PDF (Chromium/pdfkit) / DOCX export
│   └── web/                    Next.js frontend
│       └── src/
│           ├── app/
│           │   ├── page.tsx              Dashboard
│           │   ├── upload/page.tsx       Upload CV + JD
│           │   ├── analysis/[jobId]/     ATS score + keyword gaps
│           │   ├── editor/[jobId]/       CV editor + AI suggestions
│           │   ├── modify/              Modify-from-notes wizard (page.tsx + [cvId]/)
│           │   └── history/page.tsx     Past jobs (company, role, ATS score)
│           ├── components/
│           │   ├── ui/           Button, Card, Badge, CircularProgress
│           │   ├── upload/       FileDropzone
│           │   ├── editor/       CVEditor (TipTap), SuggestionsPanel, split-diff view
│           │   ├── analysis/     ATSScoreCard, KeywordChips
│           │   ├── auth/         ProviderCard, ConnectProviderModal (provider + model picker)
│           │   └── layout/       Navbar with step indicator
│           ├── lib/
│           │   ├── api.ts        Typed axios API client
│           │   ├── providers.ts  AI provider/model catalog for the picker
│           │   ├── types.ts      All TypeScript interfaces
│           │   └── utils.ts      cn, formatFileSize, score color helpers
│           └── store/
│               ├── cvStore.ts    Zustand store with localStorage persist
│               └── historyStore.ts  Applied-jobs history (localStorage: cv-optimizer-history)
└── packages/
    └── shared/                 Shared TypeScript types
        └── src/types.ts        CVSection, JDAnalysis, ATSScore, etc.
```

---

## Getting Started

### Prerequisites

- Node.js 20+
- pnpm 9+
- PostgreSQL 15+ (or Docker)

### 1. Clone & install

```bash
git clone <repo>
cd cv-optimizer
pnpm install
```

### 2. Configure environment

One shared file at the repo root covers both apps — backend vars are
`API_`-prefixed, frontend vars are `NEXT_PUBLIC_`-prefixed (each app reads
only its own subset, so sharing one file is safe):

```bash
# `pnpm dev` reads .env.local (gitignored); `pnpm start` reads .env instead
# and ignores .env.local entirely
cp .env.example .env.local
```

Edit `.env.local`:

```env
API_DATABASE_URL="postgresql://user:password@localhost:5432/cv_optimizer"

PORT=3001
API_CORS_ORIGIN="http://localhost:3000"

# Free AI (keyless "Free AI" mode) — server's shared Groq key
API_GROQ_API_KEY="..."

# Optional: env-default provider for the deprecated keyless createCompletion path
API_AI_PROVIDER="claude"          # claude | openai
API_ANTHROPIC_API_KEY="..."       # bring-your-own keys are normally sent per-session,
API_OPENAI_API_KEY="..."          # not via env — these are only for the env fallback
API_GEMINI_API_KEY="..."

# Google OAuth (only needed for the "Sign in with Google / Gemini" mode)
API_GOOGLE_CLIENT_ID="..."
API_GOOGLE_CLIENT_SECRET="..."
API_GOOGLE_REDIRECT_URI="http://localhost:3001/api/v1/auth/google/callback"

# Session security
API_ENCRYPTION_KEY=""   # 64 hex chars: openssl rand -hex 32
API_SESSION_SECRET=""   # any long random string

# Frontend
NEXT_PUBLIC_API_URL="http://localhost:3001"
```

> Bring-your-own API keys are submitted at runtime via `POST /auth/api-key`, encrypted with `API_ENCRYPTION_KEY`, and held only in the session. The `API_*_API_KEY` env vars above feed only the legacy env-based fallback.

### 3. Set up database

```bash
cd apps/api
pnpm db:migrate --name init
pnpm db:generate
```

### 4. Run

```bash
# From repo root — runs both API and web concurrently
pnpm dev
```

Or individually:

```bash
pnpm dev:api    # http://localhost:3001
pnpm dev:web    # http://localhost:3000
```

---

## Docker

```bash
# Start Postgres + API + Web
docker-compose up -d

# First run: run migrations
docker-compose exec api npx prisma migrate deploy
```

---

## API Reference

All routes are prefixed with `/api/v1`.

### Auth

| Method | Path | Description |
|---|---|---|
| `POST` | `/auth/free` | Connect keyless Free AI (`groq-free`); body `{ model? }` |
| `POST` | `/auth/api-key` | Connect a provider with your own key; body `{ provider, apiKey }` (provider: `claude`/`openai`/`gemini`/`groq`) |
| `GET` | `/auth/google` | Redirect to Google OAuth consent screen |
| `GET` | `/auth/google/callback` | OAuth callback — sets session cookie |
| `GET` | `/auth/me` | Current session info: `{ provider, model? }` (never returns tokens/keys) |
| `DELETE` | `/auth/logout` | Destroy session |

### CV

| Method | Path | Description |
|---|---|---|
| `POST` | `/cv/upload` | Upload CV file (multipart/form-data, field: `file`) |
| `POST` | `/cv/upload/text` | Upload CV as raw text (body: `{ text }`) |
| `GET` | `/cv/:id` | Get parsed CV by ID |
| `PUT` | `/cv/:id` | Update CV sections |
| `DELETE` | `/cv/:id` | Delete CV |

### Job Description

| Method | Path | Description |
|---|---|---|
| `POST` | `/jd/analyze` | Analyze JD (body: `{ text }` or multipart `file`) |
| `GET` | `/jd/:id` | Get JD analysis |

### Optimization

| Method | Path | Description |
|---|---|---|
| `POST` | `/optimize` | Start optimization job — returns `{ jobId }` immediately |
| `GET` | `/optimize/:jobId` | Poll job status and result |

### Modify (from user data, no JD)

| Method | Path | Description |
|---|---|---|
| `POST` | `/modify` | Start a "modify CV from notes" job — returns `{ jobId }`; poll via `GET /optimize/:jobId` |

**POST `/modify` body:**
```json
{
  "cvId": "...",
  "userData": "Free-form notes: new role, fresh metrics, projects to drop…",
  "config": { "maxPages": 2, "tone": "professional" }
}
```

Runs async in the **shared `jobStore`**, so the existing `GET /optimize/:jobId` poll, the diff editor, and export all work unchanged. The result adds `kind: 'modify'`, `changes[]` (what the AI edited), `removed[]` (dropped/recommended-to-drop content), and `needsMoreInfo[]` (`{ section, question }` follow-ups where notes were too thin). `tone`: `professional` / `conversational` / `executive`; `maxPages` 1–4.

**POST `/optimize` body:**
```json
{
  "cvId": "...",
  "jdId": "...",
  "config": {
    "maxPages": 2,
    "tone": "professional",
    "atsAggressiveness": "medium",
    "humanizationLevel": "high",
    "creativityLevel": "medium"
  }
}
```

### Export

| Method | Path | Description |
|---|---|---|
| `POST` | `/export/pdf` | Export as PDF (body: `{ cvId }` or `{ jobId }`) |
| `POST` | `/export/docx` | Export as DOCX |

---

## Optimization Config

| Option | Values | Effect |
|---|---|---|
| `maxPages` | `1`, `2`, `3` | Target page count — AI compresses or expands content accordingly |
| `tone` | `professional`, `technical`, `executive`, `minimal` | Writing style |
| `atsAggressiveness` | `low`, `medium`, `high` | Keyword injection density |
| `humanizationLevel` | `low`, `medium`, `high` | Sentence variety, metric usage, natural phrasing |
| `creativityLevel` | `low`, `medium`, `high` | Rewording latitude |

### AI writing rules (enforced in prompt)

- Never invent companies, roles, or dates
- Never add experience beyond what's in the original CV
- Use measurable achievements where possible (`35% reduction`, `50k+ users`)
- Vary sentence length and structure
- Avoid generic phrases (`results-driven`, `team player`, `passionate about`)
- Match JD terminology naturally — no keyword stuffing
- Preserve original career timeline exactly

---

## ATS Scoring

Score is 0–100, weighted:

| Component | Weight | Method |
|---|---|---|
| Keyword match | 40% | Fuzzy match CV text against JD keywords |
| Required skill coverage | 40% | Exact match of required skills |
| Section quality | 20% | Presence and length of key sections |

Returns: `coveredKeywords`, `missingKeywords`, `weakSections`, `suggestions`.

---

## Rate Limits

| Endpoint group | Limit |
|---|---|
| All routes | 100 requests / 15 min |
| `/jd`, `/optimize`, `/modify` (AI routes) | 10 requests / min — **POST only**; the `GET /optimize/:jobId` status poll is exempt |

---

## Supported File Types

| Type | Parser | Style hints |
|---|---|---|
| `.pdf` | `pdfjs-dist` (primary, preserves reading order) → `pdf-parse` (fallback) → `tesseract.js` OCR (last resort) | Best-effort: dominant body font + bold-line guess from the resolved font name. No color (not exposed by `getTextContent()`). None when the OCR fallback fires. |
| `.docx` | Direct `word/document.xml` walk (`jszip` + `fast-xml-parser`) | Heading/body font, bold/italic per run, accent color from heading runs. |
| `.pptx` | Direct slide XML walk (`jszip` + `fast-xml-parser`), slide order resolved via `presentation.xml.rels` | Dominant font + accent color across all runs (no heading/body distinction). |
| `.png` / `.jpg` / `.jpeg` | `tesseract.js` OCR | None — a photo/scan carries no extractable font/color/layout. |
| `.txt` | `fs.readFile` | None. |

Max upload size: **10 MB** (configurable via `API_MAX_FILE_SIZE_MB`).

**Image-only / scanned PDFs:** when text extraction yields fewer than 50 chars (no text layer — scanned pages or text exported as vector outlines), the parser renders each page to a PNG via `pdf-to-img` and OCRs it with `tesseract.js` (English). OCR is slow (~1s/page) and runs only as a fallback. First run downloads the tesseract language data from a CDN, so the API host must allow outbound network (or the data must be pre-cached). Standalone image uploads (PNG/JPEG) OCR the same way, directly.

**Style-aware export:** recovered style hints (`CVRecord.styleHints` — heading/body font, accent color) are stored per upload and applied at export time instead of the previous single hardcoded template. The Puppeteer/HTML and web-preview renderers bucket a detected font into a small curated Google-Fonts-safe set (serif/sans/monospace); the pdfkit fallback buckets into the 14 standard PDF fonts (no arbitrary font embedding); the DOCX exporter passes the detected font name through literally, since it renders client-side in the user's own Word. Bold/italic emphasis (`**bold**`/`*italic*`) is carried as markdown through the same plain-text section pipeline used for links, and rendered by all three exporters plus the editor preview. Hints are keyed off the *original* upload (`cvId`) and looked up separately for AI-optimized exports, since the AI rewrite never touches them.

---

## Database Models

```
User          id, email, timestamps
CV            id, userId?, fileName, originalText, sections (JSON), mimetype, timestamps
JD            id, userId?, text, analysis (JSON), timestamps
OptimizationJob  id, cvId, jdId, userId?, config (JSON), status, result (JSON), atsScore, timestamps
```

`OptimizationJob.status`: `PENDING → RUNNING → COMPLETED | FAILED`

---

## Development

```bash
# Type check
pnpm --filter @cv-optimizer/web type-check
cd apps/api && npx tsc --noEmit

# Prisma Studio (DB browser)
cd apps/api && pnpm db:studio

# Generate Prisma client after schema changes
cd apps/api && pnpm db:generate
```

---

## Environment Variables

One shared file at the repo root (`.env.local` for `pnpm dev`, `.env` for
`pnpm start`) — see [Configure environment](#2-configure-environment).
Backend vars are `API_`-prefixed, frontend vars are `NEXT_PUBLIC_`-prefixed;
`PORT`/`NODE_ENV` stay unprefixed since hosting platforms (e.g. Render)
inject/expect those exact names. Postgres vars are read by docker-compose only.

### Backend (apps/api)

| Variable | Required | Default | Description |
|---|---|---|---|
| `API_DATABASE_URL` | Yes | — | PostgreSQL connection string |
| `PORT` | No | `3001` | API server port |
| `API_CORS_ORIGIN` | No | `http://localhost:3000` | Allowed CORS origin |
| `API_GROQ_API_KEY` | For Free AI | — | Server's shared Groq key powering keyless `groq-free` mode |
| `API_AI_PROVIDER` | No | `claude` | Env-fallback provider (`claude`/`openai`) for legacy `createCompletion` |
| `API_ANTHROPIC_API_KEY` | No | — | Env fallback only — BYO keys are sent per-session |
| `API_OPENAI_API_KEY` | No | — | Env fallback only |
| `API_GEMINI_API_KEY` | No | — | Env fallback only |
| `API_GOOGLE_CLIENT_ID` | For Google sign-in | — | Google OAuth client ID |
| `API_GOOGLE_CLIENT_SECRET` | For Google sign-in | — | Google OAuth client secret |
| `API_GOOGLE_REDIRECT_URI` | No | `http://localhost:3001/api/v1/auth/google/callback` | OAuth callback URL |
| `API_ENCRYPTION_KEY` | Yes | — | 64 hex chars — encrypt session tokens |
| `API_SESSION_SECRET` | Yes | — | Express session signing secret |
| `API_SESSION_TTL_HOURS` | No | `2` | Session lifetime in hours |
| `API_UPLOAD_DIR` | No | `uploads` | Directory for temp file storage |
| `API_MAX_FILE_SIZE_MB` | No | `10` | Max upload size |
| `API_PUPPETEER_EXECUTABLE_PATH` | No | — | System Chromium path in containers |

### Frontend (apps/web)

| Variable | Required | Default | Description |
|---|---|---|---|
| `NEXT_PUBLIC_API_URL` | No | `http://localhost:3001` | API base URL |

### Database (docker-compose)

| Variable | Required | Default | Description |
|---|---|---|---|
| `POSTGRES_USER` | No | `cvo` | Dev postgres container user |
| `POSTGRES_PASSWORD` | No | `cvo_secret` | Dev postgres container password |
| `POSTGRES_DB` | No | `cv_optimizer` | Dev postgres container database name |
| `POSTGRES_PORT` | No | `5433` | Host port mapped to the postgres container |
