# Postdoc ResearchZeal

Postdoc ResearchZeal is a focused, no-signup search interface for discovering Postdoc opportunities worldwide.

## Domain

`https://postdoc.researchzeal.com`

## Current phase

Phase 1: Static no-signup Postdoc search UI.

All positions shown in this phase are clearly labelled demonstration data. The live jobs database is not connected yet.

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

## Cloudflare Pages configuration

```text
Framework preset: Next.js (Static HTML Export)
Build command: npm run build
Build output directory: out
Root directory: /
```

`/` means the repository root—the existing `postdoc` folder—not a nested application folder.

Equivalent Cloudflare project settings:

```text
Project root: repository root
Build command: npm run build
Build output directory: out
Production domain: postdoc.researchzeal.com
```

Do not add Cloudflare credentials to this repository. The Pages project will later use the custom domain `postdoc.researchzeal.com`; no invented DNS values are required here.

## Current capabilities

- Search demonstration jobs across titles, institutions, places, descriptions, areas, and tags
- Filter demonstration jobs by country, research area, language, and deadline
- Open demonstration source and apply links safely in a new tab
- Browse without login or profile creation
- Use a responsive, accessible dark interface

## Not yet implemented

- Live jobs database
- Worker API
- Cloudflare D1
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

## Future architecture

The planned live jobs architecture is documented here for direction only; it is not implemented in Phase 1.

```text
Browser
   ↓
Cloudflare Pages static Next.js frontend
   ↓
Cloudflare Worker API
   ↓
Cloudflare D1 jobs database
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

The email-alert and optional AI flows are future phases only. Phase 1 contains no backend, data collection, upload, authentication, or AI integration.
