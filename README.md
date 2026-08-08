# Postdoc ResearchZeal

Postdoc ResearchZeal is a focused, no-signup search interface for discovering Postdoc opportunities worldwide.

## Domain

`https://postdoc.researchzeal.com`

## Current phase

Phase 8A: No-signup Postdoc search with D1 API loading, automatic local-data fallback, queue-based collection from four reviewed sources, local comparison/shortlisting, transparent preference matching, and an anonymous visitor counter.

The homepage loads active real D1 jobs when available and automatically keeps the bundled demonstration jobs when the API is unavailable. D1 demonstrations are shown only when there are no active real collected jobs.

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

- Search jobs across titles, institutions, places, descriptions, areas, and tags
- Filter jobs by country, research area, language, and deadline
- Filter by the original source language using human-readable language names
- Compare up to three real positions without AI or an account
- Save a device-local shortlist containing job IDs only
- Calculate optional, deterministic preference matches with visible reasons
- Show approximate unique-browser and daily visitor counts without storing IP addresses or fingerprints
- Load up to 100 jobs from the same-origin D1 API
- Fall back automatically to bundled sample jobs when the API is unavailable or invalid
- Retry the database from the compact source-status control
- Open original-source and application links safely in a new tab
- Browse without login or profile creation
- Use a responsive, accessible dark interface

## Not yet implemented

- Email alerts
- Turnstile
- Profiles
- Resume upload
- AI matching

## Planned implementation order

1. Static search UI
2. Results cards and filters
3. D1 jobs database
4. Cloudflare Worker search API
5. Frontend API loading and automatic fallback
6. Production hardening
7. Automatic job collection from reviewed sources
8. Optional email alerts
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

### Phase 3 status

Phase 3 now connects the frontend to `/api/jobs` and automatically falls back to local sample data when the API is unavailable.

## Phase 3 — Frontend API loading and fallback

The statically exported homepage includes the bundled `sampleJobs` records in its initial HTML. After hydration, `PostdocSearch` requests:

```text
GET /api/jobs?limit=100
```

When the API returns a valid D1 response, the database jobs replace the bundled sample jobs. A valid response containing `jobs: []` is accepted as an empty database result and does not activate the fallback.

The existing sample jobs remain visible when the request fails because of a network error, an unsuccessful HTTP status, invalid JSON, or an invalid response shape. The source status identifies the current state as:

```text
Checking live database
Live database
Sample data fallback
```

When fallback data is active, **Retry database** repeats the same API request without reloading the page. Search and filters continue to run locally against whichever job collection is active.

For the combined local static-assets, Worker, and D1 environment, run:

```bash
npm run db:migrate:local
npm run db:seed:local
npm run dev:worker
```

Running only `npm run dev` starts Next.js without the Worker API, so the homepage will intentionally demonstrate the sample-data fallback behavior.

## Phase 7A — Automatic job collection

Phase 7A collects postdoctoral openings automatically through a Cloudflare Worker Cron Trigger. No manual job upload is required, and the project contains no job editor, admin dashboard, authentication flow, manual approval workflow, or public collection-trigger endpoint.

The only enabled source is the reviewed `iMechanica Job Channel`. Collection first requests the canonical RSS feed at `https://imechanica.org/taxonomy/term/73/feed`. Only when RSS fails does it use the approved static listing at `https://imechanica.org/taxonomy/term/73`; a successful RSS run does not crawl HTML. The source registry is code-controlled. Adding another source requires its own reviewed adapter and safety policy; browser forms cannot supply source URLs. Broad generic crawling, search-engine scraping, social-media scraping, and access-control bypasses are not implemented.

The Cron Trigger runs at `17 1,13 * * *`, or 01:17 and 13:17 UTC. Cloudflare Cron expressions use UTC.

Collection behavior:

- Uses strict, deterministic postdoctoral terms; PhD-only and faculty-only entries are rejected.
- Fetches only registered HTTPS hosts with a timeout, a response-size limit, conditional requests, controlled redirects, and at most one retry.
- Parses XML without document type declarations or external entity resolution.
- Evaluates `robots.txt` before HTML fallback, respects the applicable `ResearchZealBot` or wildcard rules and crawl delay, and fails closed when policy cannot be evaluated.
- Treats `Content-Signal: search=no` as a prohibition on HTML indexing.
- Bounds HTML fallback to two listing pages, ten same-host detail pages, crawl depth one, sequential requests, and a minimum one-second same-host delay.
- Prefers valid JobPosting JSON-LD and otherwise extracts deterministic visible page signals through Cloudflare `HTMLRewriter`.
- Normalizes factual metadata and stores only a short plain-text excerpt, not the complete external advertisement.
- Selects application links only from bounded main-vacancy content, rejects taxonomy/navigation/profile/asset/unsafe links, ranks explicit application and official vacancy URLs, and uses the individual source detail page for email-only applications.
- Preserves source attribution, original-source links, feed identity, and publication date while normalizing only explicitly supported institution, country, deadline, and duration evidence.
- Prevents duplicates across RSS and HTML by canonical detail URL and source identity, leaves unchanged jobs intact, and updates changed source records without replacing stronger metadata with blank values.
- Marks collected jobs stale after 45 unseen days and expired after 75 unseen days, and expires jobs with known past deadlines.
- Keeps stale and expired collected jobs stored but hides them from the public API.
- Keeps all demonstration records stored. Demonstrations remain public until at least one active real collected job exists, then are hidden automatically.
- Never modifies seed or demonstration jobs through collection or lifecycle maintenance.

Collection runs store bounded operational metrics in D1. Full RSS responses, full descriptions, secrets, cookies, and exception stack traces are not retained.

Browser Run is intentionally deferred. iMechanica exposes ordinary HTML, so Phase 7A adds no Browser binding and makes no production browser-rendering calls. A future dynamic source would require a separate source review and approved-host adapter.

### Local validation

```bash
npm run test:collector
npm run lint
npm run build
npm run deploy:dry
npx wrangler d1 migrations apply postdoc-researchzeal-db --local
npm run dev:worker
```

The collector tests are deterministic and use fictional minimal fixtures. The optional `npm run test:collector:live` command checks current availability of the approved feed and does not write to D1.

With `npm run dev:worker` running, invoke the local scheduled handler from another terminal:

```bash
curl "http://localhost:8787/cdn-cgi/handler/scheduled?format=json"
```

PowerShell equivalent:

```powershell
Invoke-RestMethod -Uri "http://localhost:8787/cdn-cgi/handler/scheduled?format=json"
```

Run the local scheduled request twice to verify that the second run updates verification timestamps without inserting duplicates. Inspect the local API at `http://localhost:8787/api/jobs?limit=100` to confirm the automatic transition from demonstration jobs to active real jobs.

### Manual production order

1. Review the collector code and additive migration.
2. Apply the additive migration to production D1 manually through the approved operator workflow.
3. Merge the feature branch into `main` after review.
4. Allow the Git-connected Cloudflare deployment to complete.
5. Verify the Cron Trigger uses `17 1,13 * * *` in UTC.
6. Check collection events and short structured Worker logs.
7. Verify active real jobs, filters, original-source links, and application links on the public site.

Codex did not apply a remote migration, deploy, or trigger production collection during Phase 7A implementation.

## Phase 7B-A â€” Multi-source Position Hunter

Phase 7B-A changes the existing twice-daily Cron from a crawler into a fast queue producer. A scheduled event creates one `collection_runs` row, deterministically selects enabled sources that are due, creates one queued `source_runs` row per source, and sends one controlled message per due source to `postdoc-source-collection`. The same `postdoc-researchzea` Worker remains the static-assets/API Worker, scheduler, Queue producer, and Queue consumer.

The Queue contract contains only a version, generated message/run identifiers, a code-controlled source key, scheduled timestamp, and scheduled reason. It contains no arbitrary URL, HTML, description, cookie, credential, secret, or browser input. The consumer validates that contract, verifies the enabled registry entry and due state, then processes each source independently. Cloudflare Queue delivery is at least once, so message IDs, source-run uniqueness, source identities, canonical URLs, application URLs, content hashes, and D1 upserts make repeated delivery safe.

### Queue resources

```text
Queue: postdoc-source-collection
Dead-letter queue: postdoc-source-collection-dlq
Producer binding: SOURCE_COLLECTION_QUEUE
Consumer batch size: 1
Consumer retries: 3
Consumer concurrency cap: 2
```

Both queues must be created manually before the Phase 7B-A Worker configuration is deployed. Wrangler local development simulates Queue bindings, but the deterministic test suite uses synthetic batches and mocked acknowledgements/retries so it never requires a remote queue.

### Source adapters

Enabled sources:

- `imechanica-job-channel`: existing RSS-first iMechanica source with robots-aware static fallback; twice daily.
- `ornl-postdoctoral-jobs`: official Oak Ridge National Laboratory static careers pages; daily.
- `berkeley-lab-postdoctoral`: official Berkeley Lab static careers pages; every 48 hours.
- `embl-postdoctoral-jobs`: official EMBL public Workday JSON endpoint; daily.

Pending/rejected source:

- EURAXESS is not enabled. Its current robots policy disallows the required `/jobs/*` paths and its bounded job-search check returned HTTP 403.

The registry declares allowed hosts/paths, language, frequency, request delay, timeout, response limit, page budgets, render mode, robots behavior, application rules, closure signals, and deterministic primary-source priority. No search-engine crawling, social-network scraping, login flow, CAPTCHA handling, WAF bypass, Browser Run, or anti-bot circumvention is implemented.

### Per-source processing and health

Each Queue delivery owns one `source_runs` record and records bounded page/item/job metrics. Network timeouts, HTTP 408/429, selected 5xx responses, DNS failures, and equivalent temporary errors are retried with bounded delays. Invalid messages and permanent policy, configuration, schema, or persistent 4xx failures are acknowledged without indefinite retry. A final temporary failure is recorded as dead-lettered before the Queue moves it to `postdoc-source-collection-dlq`.

`collector_sources` tracks consecutive failures and `next_allowed_at`. One temporary failure waits for the next normal source interval; the second delays 12 hours, the third 24 hours, and the fourth or later 72 hours. A confirmed robots/policy prohibition blocks future collection until review. A single network failure never expires every job from that source.

The parent collection run becomes terminal only after its expected source runs are terminal: all success is `success`, mixed success/failure is `partial`, no success is `failed`, no due sources is `skipped`, and any queued/running child keeps it `running`.

### Job observations, language, and duplicates

Migration `0004_multisource_queue.sql` adds `source_runs`, `job_sources`, source health/backoff fields, and `jobs.source_language`, `jobs.original_title`, and `jobs.original_description`. Existing collected jobs are backfilled into one primary observation when safe; seed demonstrations are preserved and are not added as collected observations.

One public vacancy can have several `job_sources` observations. Strong duplicate evidence includes the same normalized official application URL, the same canonical official vacancy URL, the same reference plus institution, the same institution/exact title/deadline, or a strong compatible content hash. Similar titles alone are never merged. A deterministic priority prefers institution/laboratory-owned pages over official portals and reviewed feeds. Secondary attribution remains stored while the public API continues to expose one primary job row.

Original source language and original title/description are stored separately from the bounded normalized display fields. Phase 7B-A performs no translation, AI extraction, semantic search, AI matching, manual upload, or manual job management.

### Local validation

```bash
npm run test:collector
npm run test:collector:live
npm run lint
npm run build
npm run deploy:dry
npm run db:migrate:local
npx wrangler d1 execute postdoc-researchzeal-db --local --command="SELECT status, COUNT(*) FROM source_runs GROUP BY status;"
npx wrangler d1 execute postdoc-researchzeal-db --local --command="SELECT job_id, COUNT(*) AS source_count FROM job_sources GROUP BY job_id;"
git diff --check
```

The live test is deliberately separate from deterministic tests. It performs one bounded current-source validation and writes nothing to D1. For local end-to-end API/frontend review, start `npm run dev:worker`; do not point local testing at production D1.

### Manual production order (do not run as part of local implementation)

1. Review Phase 7B-A source policy, migration, queue handler, tests, and dry-run output.
2. Create the production resources manually:

   ```bash
   npx wrangler queues create postdoc-source-collection
   npx wrangler queues create postdoc-source-collection-dlq
   ```

3. Apply migration 0004 before deploying the new Worker:

   ```bash
   npm run db:migrate:remote
   ```

4. Commit, push, review, and merge through the normal Git workflow so the connected Cloudflare build deploys the Worker and static assets.
5. Verify the Queue producer, Queue consumer, DLQ, D1, Assets, and existing `17 1,13 * * *` UTC Cron bindings in Cloudflare.
6. Observe the first scheduled fan-out and confirm each source run, source health state, job observation, public API result, search/filter behavior, and external links.

Migration 0004 and both queues are prerequisites for the Phase 7B-A Worker. This implementation does not create remote queues, apply the remote migration, deploy, trigger production collection, or modify production D1.

## Phase 8A - Private local comparison and visitor counts

Phase 8A adds a no-AI comparison sheet for up to three active real positions, a local shortlist, and optional rule-based preference matching. Comparison and shortlist storage contain job IDs only. Preferences are also stored only in the current browser. None of these values are written to D1 or synchronized between devices, and missing or expired IDs are removed after a valid live API result is loaded.

Preference matching uses normalized literal tokens and an explicit 100-point model: research terms up to 40; country/source-language preferences up to 20; deadline preference up to 15; direct application and official institution-owned source up to 15; and stated comparison details up to 10. Every awarded reason is visible. This is not AI, uses no embeddings or external service, and does not claim that the highest score is objectively best.

Listings remain in their original source language. The English interface supplies human-readable language labels and a source-language filter, but it performs no automatic translation and incurs no AI or translation-service cost.

### Anonymous visitor counter

`POST /api/visit` sets a random, opaque `rz_visitor_id` cookie for about one year and an `rz_visit_day` marker bounded to the current UTC day. Both cookies are `HttpOnly`, `Secure`, `SameSite=Lax`, and scoped to `/`. The Worker stores only a SHA-256 hash of the random identifier in `site_visitors` and one hash/date pair in `site_visitor_days`; it does not read or store an IP address, `CF-Connecting-IP`, geolocation, user agent, fingerprint, advertising identifier, email, or account data.

Counts represent approximate unique browsers, not people or accounting-grade traffic. Cookie clearing, blocked cookies, multiple browsers, and deliberate requests can affect them. The endpoint accepts only bodyless same-origin `POST` requests, uses parameterized D1 statements, and returns a safe unavailable response if counting fails.

Migration `0005_visitor_counter.sql` is additive and creates the two visitor tables plus the date index. It seeds no visitors and does not modify jobs, job observations, source runs, Queue state, collection history, or collector health.

### Production order

After local review, the recommended production order is:

1. Review the Phase 8A UI, privacy model, Worker endpoint, migration, and tests.
2. Apply migrations through the existing Wrangler migration tracker so `0005_visitor_counter.sql` runs once after migrations 0001-0004.
3. Commit and push the reviewed branch through the normal Git workflow.
4. Merge only after review, then allow the connected Cloudflare build to deploy.
5. Verify `/api/visit`, cookie attributes, visitor counts, comparison, shortlist, preferences, source-language filtering, and mobile layout.

No Queue, Cron, domain, secret, or collector change is required for Phase 8A.

## Phase 8B - Approved-source search

Phase 8B adds an explicit **Search approved sources** action when a successful D1 response has no positions matching at least one active API-supported filter. The action is never shown for sample fallback data, an unknown D1 state, an unfiltered empty list, or an empty Saved positions view.

> Search approved sources refreshes ResearchZeal's reviewed sources and then applies the user's filters. It does not search the entire web.

The workflow is database-first. `POST /api/source-search` re-runs the same active-public-job SQL used by `GET /api/jobs`; an existing match returns immediately without Queue work or rate-limit consumption. Equivalent successful, partial, and no-results searches are cached in D1 for 12 hours. Failed searches are not reused. Only a new, uncached, zero-result request can create an `on_demand_search` collection run and version-2 Queue messages.

The four code-controlled approved sources remain:

- `imechanica-job-channel`
- `ornl-postdoctoral-jobs`
- `berkeley-lab-postdoctoral`
- `embl-postdoctoral-jobs`

Version-2 messages contain only generated request/run/message identifiers, one registry source key, a timestamp, and the `on_demand` reason. They contain no query text, URL, HTML, cookie, visitor hash, or credential. Version-1 scheduled messages and the existing `17 1,13 * * *` UTC Cron remain unchanged.

Each source keeps its reviewed adapter, robots and content-policy checks, request/page limits, health backoff, and retry classification. A source successfully refreshed within the preceding 60 minutes is safely reused instead of crawled again. Backoff and policy pauses are never bypassed. The collectors fetch their complete bounded postdoc listings; user filters are applied only to stored active D1 records after source runs finish.

The status endpoint is:

```text
GET /api/source-search/:requestId
```

It returns only bounded progress and result counts. The browser polls about every 2.5 seconds for at most 90 seconds, stores only the opaque request ID plus canonical query key in `sessionStorage`, and reloads `/api/jobs` after matching results become available. Comparison IDs, shortlist IDs, preferences, and language filters remain local and survive that refresh.

### Privacy, security, and limits

New refresh requests are limited to three per visitor per UTC hour and 20 globally per UTC hour. One atomic D1 statement checks both scopes and increments both counters or neither, so a rejected visitor cannot consume global allowance and global exhaustion cannot consume visitor allowance. The active-query claim is created before rate consumption, so simultaneous equivalent searches create one request, one collection run, one Queue fan-out, and one accepted rate-limit increment. Existing D1 results, active-query reuse, and 12-hour cached searches do not consume those limits. The existing secure `rz_visitor_id` cookie is reused; when absent or malformed, the Worker creates the same random UUID format with `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`, and about a one-year maximum age. Only its SHA-256 hash is used for visitor-scoped limits.

Approved-source search does not read or store IP addresses, `CF-Connecting-IP`, geolocation, user agents, fingerprints, email, or account data. Requests have a 4 KB body limit, an exact property allow-list, bounded string fields, a strict deadline enum, same-origin validation when `Origin` is present, parameterized D1 statements, safe public errors, `Cache-Control: no-store`, and `X-Content-Type-Options: nosniff`.

This phase adds no AI, embeddings, semantic search, automatic translation, Google/Bing crawling, LinkedIn/Indeed crawling, arbitrary URLs, accounts, CV upload, email alerts, paid API, Worker, Queue, Cron expression, secret, or domain change.

### Migration 0006

`migrations/0006_approved_source_search.sql` adds:

- `source_search_requests`, including canonical query hashes, saved filters, lifecycle/progress fields, 12-hour cache expiry, and a partial unique index preventing two queued/running requests for the same query;
- `source_search_rate_limits`, containing only visitor/global scope keys, UTC-hour windows, and bounded counters.

The migration inserts no fake search or rate-limit rows and does not alter jobs, collection history, source runs, job observations, collector health, visitor tables, or Queue state. The existing scheduled handler first recovers queued/running on-demand searches older than 45 minutes: it creates truthful failed accounting rows for missing sources, fails only remaining active source runs, preserves completed source metrics, and finalizes the collection and search without allowing incomplete accounting to report success. It then performs best-effort cleanup of terminal search requests older than seven days and rate windows older than 48 hours. Recovery or cleanup failure cannot block normal source scheduling.

### Local validation

Use local or isolated D1 only:

```bash
npm run test:collector
npm run test:collector:live
npm run lint
npm run build
npm run deploy:dry
git diff --check
```

For a fresh isolated migration review:

```bash
npx wrangler d1 migrations apply postdoc-researchzeal-db --local --persist-to ./.tmp/phase8b-d1
npx wrangler d1 execute postdoc-researchzeal-db --local --persist-to ./.tmp/phase8b-d1 --command="PRAGMA foreign_key_check;"
```

For a combined local Worker/API/assets review, apply migration 0006 locally before starting `npm run dev:worker`. Local Queue simulation may contact the four approved public sources; it never modifies production D1.

### Production order

Migration 0006 must be applied through Wrangler migration tracking **before** deploying code that exposes the new endpoints:

1. Review the Worker, Queue v1/v2 compatibility, UI, migration, deterministic tests, live source test, and dry run.
2. Apply `0006_approved_source_search.sql` to production D1 through the approved operator workflow.
3. Commit, push, and merge only after review.
4. Allow the existing Git-connected deployment to update the single Worker and static assets.
5. Verify database-first results, cached no-results, Queue v2 processing, rate limits, status polling, and scheduled cleanup.

Operational limitations remain deliberate: external source availability can delay or partially complete a refresh; the browser stops polling after 90 seconds even though Queue work may continue; cached terminal answers can remain for up to 12 hours; source cooldown is 60 minutes; and approved-source search covers only the four reviewed sources, not the entire internet.

## Phase 8C - Paginated results and URL-preserved filters

Phase 8C prepares the public results list for a substantially larger active dataset without adding a database migration or Cloudflare resource. The browser requests 20 D1 rows at a time with explicit `limit` and `offset` values. The first page replaces the current result set; **Load more positions** appends the next page and leaves existing cards, focus, comparison state, shortlist state, and preferences intact.

The public jobs query keeps its existing `posted_at DESC, created_at DESC` business order and adds `id DESC` as a deterministic final tie-breaker. Appended pages merge by stable job ID: new IDs retain API order, while an ID already displayed is updated in place rather than rendered twice. The next offset advances by the number of server rows consumed (`page.offset + page.count`), not by the unique visible-card count.

Initial requests and Load More requests use separate abort controllers plus a canonical-query generation check. Changing an applied filter, navigating Back or Forward, refreshing from Phase 8B, or unmounting the component invalidates older work so a slow response cannot mix results from different queries. Only one Load More request can be active. An initial API failure may show the existing controlled sample fallback; a later-page failure preserves already loaded D1 cards and provides **Retry loading more** at the same offset.

The result header distinguishes the loaded-card count from the total matching D1 count, for example `Showing 20 of 145 matching positions.` When the last page is consumed it reports that all matching positions are loaded. Updates are exposed through a polite live region, loading containers use `aria-busy`, and all Load More and retry controls remain ordinary keyboard-accessible buttons with mobile-sized touch targets.

### URL filter behavior

The canonical public query parameters are:

- `keyword`
- `country`
- `research_area`
- `language`
- `deadline` (`7`, `30`, `60`, `open`, or `none`; `any` is omitted)

Values are bounded and encoded with `URLSearchParams`. The URL contains no offset, result total, visitor identifier, comparison ID, shortlist ID, preference setting, or approved-source request ID. Select filters apply immediately. Keyword typing uses a short debounce so browser history does not receive an entry for every keystroke. Back and Forward restore the controls and load page one for the restored query without clearing local comparison, shortlist, or preference state.

The distinct **Source language** control keeps its Phase 8A browser-local meaning: it compares normalized `job.source_language` values only across positions already loaded. It is not mapped to the advertisement-language filter, is not sent to Phase 8B, and is not placed in the public URL. Preference matching continues to annotate loaded jobs with transparent scores and reasons; it does not reorder server pages or claim a global ranking.

> Phase 8C preserves applied search filters in the URL. The exact Load More depth and scroll position are not persisted.

A refresh or shared link therefore restores the filters and requests offset zero. Offset pagination can also shift when new jobs are inserted between page requests; frontend ID merging prevents visible duplicates, while cursor pagination remains a possible future enhancement.

### Phase 8B and fallback integration

Approved-source search remains explicit and appears only after a settled, successful D1 first page reports `total: 0` for at least one meaningful API-supported filter. It stays hidden during initial loading, for API failure, for sample fallback, for Saved-only mode, and for later-page errors. A completed approved-source refresh reloads only offset zero for the same URL filters.

A legitimate D1 zero result is never treated as an API failure. Sample fallback cards are never combined with a D1 total, cannot use Load More, and cannot trigger approved-source collection. Sample positions retain their existing demonstration labels.

### Local validation

Run locally or against an isolated local D1 state only:

```bash
npm run test:collector
npm run test:collector:live
npm run lint
npm run build
npm run deploy:dry
git diff --check
```

For pagination review, use more than 45 active local jobs and verify offsets 0, 20, and 40, stable equal-timestamp boundaries, URL restoration, Back/Forward navigation, Load More retry, 1440px desktop layout, and 390px mobile layout. Phase 8C changes no migration, binding, Queue, Cron trigger, Worker route, domain, secret, or production data. Production rollout remains the normal reviewed Git-connected build; do not manually deploy this implementation.
