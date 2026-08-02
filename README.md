# Postdoc ResearchZeal

Postdoc ResearchZeal is a focused, no-signup search interface for discovering Postdoc opportunities worldwide.

## Domain

`https://postdoc.researchzeal.com`

## Current phase

Phase 2: Static no-signup Postdoc search UI plus a read-only Cloudflare Worker and D1 jobs API.

All positions shown in this phase are clearly labelled demonstration data. The homepage still uses local sample data; the API uses separate D1 demonstration data.

## Local development

```bash
npm install
npm run dev
```

## Production verification

```bash
npm run lint
npm run build
```

The production build uses Next.js static export and generates the deployable site in `out/`.

## Cloudflare Workers configuration

```text
Build command: npm run build
Deploy command: npx wrangler deploy
Static-assets directory: out
Root directory: /
```

`/` means the repository root—the existing `postdoc` folder—not a nested application folder. Next.js remains configured with `output: "export"`.

Equivalent Cloudflare project settings:

```text
Project root: repository root
Build command: npm run build
Deploy command: npx wrangler deploy
Production domain: postdoc.researchzeal.com
```

Do not add Cloudflare credentials to this repository. The Worker configuration preserves the custom domain `postdoc.researchzeal.com`.

## Current capabilities

- Search demonstration jobs across titles, institutions, places, descriptions, areas, and tags
- Filter demonstration jobs by country, research area, language, and deadline
- Open demonstration source and apply links safely in a new tab
- Browse without login or profile creation
- Use a responsive, accessible dark interface

## Not yet implemented

- Frontend API loading
- Manual admin entry
- Email alerts
- Turnstile
- Automatic job collection
- Profiles
- Resume upload
- AI matching

## Planned implementation order

1. Static search UI
2. Results cards and filters
3. D1 jobs database
4. Cloudflare Worker search API
5. Manual job-entry workflow
6. Email-alert signup
7. Weekly email alert system
8. Automatic job collection
9. Optional profiles
10. Optional resume-based AI matching

## Phase 2 architecture

The D1 API is separate from the Phase 1 homepage data source.

```text
Browser
   ↓
Cloudflare Worker
   ├── static Next.js export from out/
   └── /api/* → D1 jobs database
```

Future email-alert flow:

```text
Browser form
   ↓
Cloudflare Turnstile
   ↓
Worker server-side token verification
   ↓
D1 email_alerts and saved_searches tables
```

Future optional AI flow:

```text
Optional user consent
   ↓
Resume stored in Cloudflare R2
   ↓
AI analysis service
   ↓
Job matching results
```

The email-alert and optional AI flows are future phases only. Phase 2 contains no data collection, upload, authentication, or AI integration.

## Phase 2 — Cloudflare D1 Jobs API

Phase 2 adds a read-only Cloudflare Worker API backed by D1 while preserving the existing statically exported frontend.

### Architecture

```text
Browser
  |-- Website and static assets
  |      |
  |      `-- out/
  |
  `-- /api/*
         |
         `-- Worker
                |
                `-- D1
```

### Current data behavior

```text
Homepage:
local sample data

API:
D1 demonstration data
```

The homepage is intentionally not connected to the API in Phase 2. Its local sample data remains the stable frontend data source.

### Endpoints

```text
GET /api/health
GET /api/jobs
```

`GET /api/health` verifies the D1 binding with a real database query. `GET /api/jobs` returns active, non-expired jobs and supports these query parameters:

```text
keyword
q
country
research_area
language
deadline
limit
offset
```

The `deadline` filter accepts `any`, `7`, `30`, `60`, `open`, and `none`.

### Local database commands

```bash
npm run db:migrate:local
npm run db:seed:local
npm run db:list:local
npm run dev:worker
```

`npm run dev:worker` builds the static export before starting the Worker and its local D1 binding.

### Remote database commands

Authenticate with Cloudflare and ensure `wrangler.jsonc` contains the real database ID before using remote commands:

```bash
npx wrangler login
npm run db:migrate:remote
npm run db:seed:remote
npm run db:list:remote
```

Warning: scripts containing `--remote` affect the production `postdoc-researchzeal-db` database. Run them only after local migration, seed, API, build, and dry-run validation succeeds.

### Deployment commands

```bash
npm run deploy:dry
npm run deploy
```

The connected Cloudflare build remains:

```text
Build command: npm run build
Deploy command: npx wrangler deploy
Static assets: out/
```

### Not implemented yet

- Frontend API loading
- Admin entry
- Authentication
- Email alerts
- Turnstile
- Automatic collection
- Profiles
- Resume upload
- AI matching

### Next phase

Phase 3 will connect the frontend to `/api/jobs` and automatically fall back to local sample data when the API is unavailable.
