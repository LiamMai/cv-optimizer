# CVOptimizer

AI-powered resume builder that tailors your CV to any job description. Parses your existing CV, analyzes the JD, rewrites content for ATS compatibility, and preserves your original template.

## What it does

1. **Upload CV** — PDF, DOCX, or paste text. Extracts all sections automatically.
2. **Paste JD** — Extracts required skills, keywords, seniority level, responsibilities.
3. **AI Optimization** — Rewrites bullet points and sections to match the JD while keeping your original layout intact. Enforces human-like writing, no hallucination, measurable achievements.
4. **ATS Score** — 0–100 score with keyword gap analysis and section-by-section breakdown.
5. **Edit & Export** — TipTap rich-text editor with accept/reject per-section diffs. Export to PDF or DOCX.

---

## Tech Stack

| Layer | Tech |
|---|---|
| Frontend | Next.js 14, TypeScript, TailwindCSS, Zustand, TipTap, React Hook Form |
| Backend | Node.js, Express, TypeScript |
| AI | Claude (`claude-sonnet-4-6`) or OpenAI (`gpt-4o`) — switchable via env |
| Database | PostgreSQL via Prisma ORM |
| Parsers | `pdf-parse` (PDF), `mammoth` (DOCX) |
| Export | `docx` package (DOCX), Puppeteer optional (PDF) |

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
│   │       ├── routes/         cv, jd, optimize, export
│   │       └── services/
│   │           ├── aiProvider.ts    Claude/OpenAI factory
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
- PostgreSQL 15+ (or Docker)

### 1. Clone & install

```bash
git clone <repo>
cd cv-optimizer
npm install
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

# Pick one provider
AI_PROVIDER="claude"           # or "openai"
ANTHROPIC_API_KEY="sk-ant-..."
OPENAI_API_KEY="sk-..."        # only needed if AI_PROVIDER=openai

PORT=3001
JWT_SECRET="change-me"
CORS_ORIGIN="http://localhost:3000"
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
npm run dev
```

Or individually:

```bash
npm run dev:api    # http://localhost:3001
npm run dev:web    # http://localhost:3000
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

## AI Configuration

### Provider selection

Set `AI_PROVIDER` in `.env`:

- `claude` → uses `claude-sonnet-4-6` (Anthropic)
- `openai` → uses `gpt-4o` (OpenAI)

### Optimization config

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
npm run type-check --workspace=apps/web
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
| `AI_PROVIDER` | Yes | `claude` | `claude` or `openai` |
| `ANTHROPIC_API_KEY` | If claude | — | Anthropic API key |
| `OPENAI_API_KEY` | If openai | — | OpenAI API key |
| `PORT` | No | `3001` | API server port |
| `JWT_SECRET` | Yes | — | Secret for JWT signing |
| `UPLOAD_DIR` | No | `uploads` | Directory for temp file storage |
| `MAX_FILE_SIZE_MB` | No | `10` | Max upload size |
| `CORS_ORIGIN` | No | `http://localhost:3000` | Allowed CORS origin |

### Web (`apps/web/.env`)

| Variable | Required | Default | Description |
|---|---|---|---|
| `NEXT_PUBLIC_API_URL` | No | `http://localhost:3001` | API base URL |
