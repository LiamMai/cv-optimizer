# CVOptimizer

AI-powered resume builder that tailors your CV to any job description. Parses your existing CV, analyzes the JD, rewrites content for ATS compatibility, and preserves your original template.

**Live demo:** https://cv-optimizer-web-delta.vercel.app

## What it does

1. **Upload CV** — PDF, DOCX, or paste text. Extracts all sections automatically.
2. **Paste JD** — Extracts required skills, keywords, seniority level, responsibilities.
3. **AI Optimization** — Rewrites bullet points and sections to match the JD while keeping your original layout intact. Enforces human-like writing, no hallucination, measurable achievements.
4. **ATS Score** — 0–100 score with keyword gap analysis and section-by-section breakdown.
5. **Edit & Export** — TipTap rich-text editor with accept/reject per-section diffs. Paginated A4 preview mirrors the PDF (Inter 11pt, same page-break rules — pages fill, and an entry header never separates from its first bullets). Export to PDF or DOCX.
6. **Modify from your data** — Skip the JD: hand the AI free-form notes (new role, fresh metrics, projects to drop) and it folds them into the right sections, mirrors existing entry structure, re-sorts by date, and asks follow-up questions where your notes are too thin. Returns the same accept/reject diff as optimization.
7. **History** — Every job is remembered locally (company, job title, ATS score, date) so you can re-open past results and track which companies you've applied to.

---

## AI Providers

Pick how the AI runs from the **Connect Provider** screen. Three ways:

| Mode | How | Setup |
|---|---|---|
| **Free AI** (default) | Keyless. Runs on the server's shared Groq key — no sign-in, no API key. Choose a model in the picker. | Server needs `GROQ_API_KEY` |
| **Google (Gemini)** | OAuth — sign in with Google, free tier (1,500 req/day). | `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` |
| **Bring your own key** | Paste an API key for Anthropic Claude, OpenAI, Google Gemini, or Groq. Key is encrypted into your session, never stored. | none |

**Free AI models** (`groq-free`):

| Model | Notes |
|---|---|
| `openai/gpt-oss-120b` | Default — best quality (8K TPM free limit) |
| `openai/gpt-oss-20b` | 8K TPM free limit |
| `meta-llama/llama-4-scout-17b-16e-instruct` | Long CVs — biggest free limit (30K TPM) |
| `llama-3.1-8b-instant` | Fastest (6K TPM free limit) |

> **Note:** Free/OAuth tiers have rate limits. Responses may be slow or temporarily unavailable under load.

---

## Tech Stack

| Layer | Tech |
|---|---|
| Frontend | Next.js 14, TypeScript, TailwindCSS, Zustand, TipTap, React Hook Form |
| Backend | Node.js, Express, TypeScript |
| AI | Anthropic Claude, OpenAI, Google Gemini, Groq — selectable per session |
| Database | PostgreSQL via Prisma ORM |
| Parsers | `pdfjs-dist` + `pdf-parse` (PDF), `tesseract.js` + `pdf-to-img` (OCR fallback), `mammoth` (DOCX) |
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

```bash
# API
cp apps/api/.env.example apps/api/.env

# Web
cp apps/web/.env.example apps/web/.env
```

Edit `apps/api/.env`:

```env
DATABASE_URL="postgresql://user:password@localhost:5432/cv_optimizer"

PORT=3001
CORS_ORIGIN="http://localhost:3000"

# Free AI (keyless "Free AI" mode) — server's shared Groq key
GROQ_API_KEY="..."

# Optional: env-default provider for the deprecated keyless createCompletion path
AI_PROVIDER="claude"          # claude | openai
ANTHROPIC_API_KEY="..."       # bring-your-own keys are normally sent per-session,
OPENAI_API_KEY="..."          # not via env — these are only for the env fallback
GEMINI_API_KEY="..."

# Google OAuth (only needed for the "Sign in with Google / Gemini" mode)
GOOGLE_CLIENT_ID="..."
GOOGLE_CLIENT_SECRET="..."
GOOGLE_REDIRECT_URI="http://localhost:3001/api/v1/auth/google/callback"

# Session security
ENCRYPTION_KEY=""   # 64 hex chars: openssl rand -hex 32
SESSION_SECRET=""   # any long random string
```

> Bring-your-own API keys are submitted at runtime via `POST /auth/api-key`, encrypted with `ENCRYPTION_KEY`, and held only in the session. The `*_API_KEY` env vars above feed only the legacy env-based fallback.

### 3. Set up database

```bash
cd apps/api
npx prisma migrate dev --name init
npx prisma generate
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

| Type | Parser |
|---|---|
| `.pdf` | `pdfjs-dist` (primary, preserves reading order) → `pdf-parse` (fallback) → `tesseract.js` OCR (last resort) |
| `.docx` | `mammoth` |
| `.txt` | `fs.readFile` |

Max upload size: **10 MB** (configurable via `MAX_FILE_SIZE_MB`).

**Image-only / scanned PDFs:** when text extraction yields fewer than 50 chars (no text layer — scanned pages or text exported as vector outlines), the parser renders each page to a PNG via `pdf-to-img` and OCRs it with `tesseract.js` (English). OCR is slow (~1s/page) and runs only as a fallback. First run downloads the tesseract language data from a CDN, so the API host must allow outbound network (or the data must be pre-cached).

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
cd apps/api && npx prisma studio

# Generate Prisma client after schema changes
cd apps/api && npx prisma generate
```

---

## Environment Variables

### API (`apps/api/.env`)

| Variable | Required | Default | Description |
|---|---|---|---|
| `DATABASE_URL` | Yes | — | PostgreSQL connection string |
| `PORT` | No | `3001` | API server port |
| `CORS_ORIGIN` | No | `http://localhost:3000` | Allowed CORS origin |
| `GROQ_API_KEY` | For Free AI | — | Server's shared Groq key powering keyless `groq-free` mode |
| `AI_PROVIDER` | No | `claude` | Env-fallback provider (`claude`/`openai`) for legacy `createCompletion` |
| `ANTHROPIC_API_KEY` | No | — | Env fallback only — BYO keys are sent per-session |
| `OPENAI_API_KEY` | No | — | Env fallback only |
| `GEMINI_API_KEY` | No | — | Env fallback only |
| `GOOGLE_CLIENT_ID` | For Google sign-in | — | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | For Google sign-in | — | Google OAuth client secret |
| `GOOGLE_REDIRECT_URI` | No | `http://localhost:3001/api/v1/auth/google/callback` | OAuth callback URL |
| `ENCRYPTION_KEY` | Yes | — | 64 hex chars — encrypt session tokens |
| `SESSION_SECRET` | Yes | — | Express session signing secret |
| `SESSION_TTL_HOURS` | No | `2` | Session lifetime in hours |
| `UPLOAD_DIR` | No | `uploads` | Directory for temp file storage |
| `MAX_FILE_SIZE_MB` | No | `10` | Max upload size |

### Web (`apps/web/.env`)

| Variable | Required | Default | Description |
|---|---|---|---|
| `NEXT_PUBLIC_API_URL` | No | `http://localhost:3001` | API base URL |
