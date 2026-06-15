# CVOptimizer

AI-powered resume builder that tailors your CV to any job description. Parses your existing CV, analyzes the JD, rewrites content for ATS compatibility, and preserves your original template.

## What it does

1. **Upload CV** — PDF, DOCX, or paste text. Extracts all sections automatically.
2. **Paste JD** — Extracts required skills, keywords, seniority level, responsibilities.
3. **AI Optimization** — Rewrites bullet points and sections to match the JD while keeping your original layout intact. Enforces human-like writing, no hallucination, measurable achievements.
4. **ATS Score** — 0–100 score with keyword gap analysis and section-by-section breakdown.
5. **Edit & Export** — TipTap rich-text editor with accept/reject per-section diffs. Export to PDF or DOCX.

---

## AI — Free Mode

Uses **Google Gemini via OAuth** — sign in with Google, no API key required, no cost.

> **Note:** Free tier has rate limits (1,500 requests/day). Responses may be slow or temporarily unavailable.

---

## Tech Stack

| Layer | Tech |
|---|---|
| Frontend | Next.js 14, TypeScript, TailwindCSS, Zustand, TipTap, React Hook Form |
| Backend | Node.js, Express, TypeScript |
| AI | Google Gemini (OAuth, free tier) |
| Database | PostgreSQL via Prisma ORM |
| Parsers | `pdf-parse` (PDF), `mammoth` (DOCX) |
| Export | `docx` package (DOCX), Puppeteer optional (PDF) |
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
│   │       ├── routes/         cv, jd, optimize, export, auth
│   │       └── services/
│   │           ├── aiProvider.ts    Gemini OAuth provider
│   │           ├── parser.ts        PDF/DOCX/TXT → structured sections
│   │           ├── jdAnalyzer.ts    JD → keywords/requirements
│   │           ├── atsScorer.ts     0–100 ATS scoring engine
│   │           ├── cvOptimizer.ts   Core AI rewriter + master prompt
│   │           └── exporter.ts      PDF/DOCX export
│   └── web/                    Next.js frontend
│       └── src/
│           ├── app/
│           │   ├── page.tsx              Dashboard
│           │   ├── upload/page.tsx       Upload CV + JD
│           │   ├── analysis/[jobId]/     ATS score + keyword gaps
│           │   └── editor/[jobId]/       CV editor + AI suggestions
│           ├── components/
│           │   ├── ui/           Button, Card, Badge, CircularProgress
│           │   ├── upload/       FileDropzone
│           │   ├── editor/       CVEditor (TipTap), SuggestionsPanel
│           │   ├── analysis/     ATSScoreCard, KeywordChips
│           │   └── layout/       Navbar with step indicator
│           ├── lib/
│           │   ├── api.ts        Typed axios API client
│           │   ├── types.ts      All TypeScript interfaces
│           │   └── utils.ts      cn, formatFileSize, score color helpers
│           └── store/
│               └── cvStore.ts    Zustand store with localStorage persist
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

# Google OAuth (required for Gemini free AI)
GOOGLE_CLIENT_ID="..."
GOOGLE_CLIENT_SECRET="..."
GOOGLE_REDIRECT_URI="http://localhost:3001/api/v1/auth/google/callback"

# Session security
ENCRYPTION_KEY=""   # 64 hex chars: openssl rand -hex 32
SESSION_SECRET=""   # any long random string
```

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
| `GET` | `/auth/google` | Redirect to Google OAuth consent screen |
| `GET` | `/auth/google/callback` | OAuth callback — sets session cookie |
| `GET` | `/auth/me` | Current session info (never returns tokens) |
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
| `/jd`, `/optimize` (AI routes) | 10 requests / min |

---

## Supported File Types

| Type | Parser |
|---|---|
| `.pdf` | `pdf-parse` |
| `.docx` | `mammoth` |
| `.txt` | `fs.readFile` |

Max upload size: **10 MB** (configurable via `MAX_FILE_SIZE_MB`).

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
| `GOOGLE_CLIENT_ID` | Yes | — | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | Yes | — | Google OAuth client secret |
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
