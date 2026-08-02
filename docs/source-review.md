# Approved source review

Review date: 2026-08-02. Reviews used the identified public listing, one bounded policy request, and one bounded extraction path per proposed source. No login, CAPTCHA, search-engine result, anti-bot bypass, or production database write was used.

## Enabled sources

### iMechanica Job Channel

- Source key: `imechanica-job-channel`
- Source name: iMechanica Job Channel
- Official hostname: `imechanica.org`
- Listing URL: `https://imechanica.org/taxonomy/term/73`; primary feed: `https://imechanica.org/taxonomy/term/73/feed`
- Source type: reviewed research-opportunity feed; RSS-first hybrid with static HTML fallback
- Robots result: wildcard rules permit the registered listing and discovered root-level or `/node/` job details. Administrative, account, comment, search, and other disallowed paths remain excluded. HTML collection fails closed if robots cannot be evaluated.
- Content-Signal result: no `search=no` signal was present. Any future `search=no` response is rejected.
- Terms result: no clear prohibition was identified for bounded retrieval of the public feed/listing. Attribution and original links are retained; only a short public excerpt is displayed.
- Allowed path scope: the registered feed, one registered listing plus one pagination page, and at most ten same-host detail URLs discovered in job headings. Assets, accounts, comments, other taxonomies, navigation, and application destinations are not crawled.
- Rendering requirement: RSS or server-rendered HTML; no browser.
- Pagination: at most two listing pages through the reviewed `page` parameter.
- Structured data: RSS is primary; JobPosting JSON-LD is used on details when present.
- Application and closure: bounded main-content application/vacancy links only; otherwise the individual source detail. Explicit closure text and deadline lifecycle rules apply.
- Language and geography: default language `en`; international research postings.
- Proposed frequency: `twice_daily`.
- Decision: enabled (existing Phase 7A source).
- Reason: a structured feed and tightly bounded, robots-aware fallback remain usable without login or rendering.

### Oak Ridge National Laboratory Postdoctoral Jobs

- Source key: `ornl-postdoctoral-jobs`
- Source name: Oak Ridge National Laboratory Postdoctoral Jobs
- Official hostname: `jobs.ornl.gov`
- Listing URL: `https://jobs.ornl.gov/go/Postdoctoral-Jobs/4537100/`
- Source type: official U.S. national laboratory careers portal; static HTML
- Robots result: the wildcard policy allows the listing and `/job/.../<id>/` details. `/talentcommunity/`, `/applybutton/`, `/preapply/`, account, and subscription paths are disallowed and are never crawl targets.
- Content-Signal result: no `search=no` signal was present on the reviewed responses.
- Terms result: ORNL's public security/privacy notices prohibit circumvention and misuse but did not state a prohibition on bounded reading of public vacancy pages. The collector does not submit applications or collect applicant data.
- Allowed path scope: the one registered postdoctoral listing, reviewed `startrow` pagination, and discovered same-host `/job/.../<numeric-id>` details only.
- Rendering requirement: server-rendered HTML; no browser.
- Pagination: controlled `startrow` links, maximum two listing pages.
- Structured data: no JobPosting JSON-LD was present in the reviewed live detail; deterministic visible HTML extraction is used.
- Application and closure: the official vacancy remains the source; an official first-party Apply action may be surfaced but is not crawled. Explicit closed/unavailable text and deadlines are honored.
- Language and geography: `en`; Oak Ridge, Tennessee, United States.
- Live extraction: HTTP 200 listing and active detail; a current Postdoctoral Research Associate vacancy and official application action were extracted.
- Proposed frequency: `daily`.
- Decision: enabled.
- Reason: official ownership, public static pages, permissive required paths, stable requisition identity, and accurate first-party links.

### Berkeley Lab Postdoctoral Opportunities

- Source key: `berkeley-lab-postdoctoral`
- Source name: Berkeley Lab Postdoctoral Opportunities
- Official hostname: `jobs.lbl.gov`
- Listing URL: `https://jobs.lbl.gov/landingpages/postdoctoral-fellow-opportunities-at-lbl-12`
- Source type: official U.S. Department of Energy laboratory careers portal; static HTML
- Robots result: the reviewed wildcard group was `Disallow:` with no blocked path. The server labels robots as HTML, but its body is a valid plain robots policy.
- Content-Signal result: no `search=no` signal was present.
- Terms result: Berkeley Lab's public web/privacy notices describe normal browsing telemetry and recruitment privacy; no clear prohibition on bounded public vacancy retrieval was identified. No form submission or applicant data is involved.
- Allowed path scope: the one registered landing page, reviewed `page` pagination, and same-host `/jobs/<slug>-<id>` details only.
- Rendering requirement: server-rendered HTML; no browser.
- Pagination: controlled `page` links, maximum two listing pages.
- Structured data: no JobPosting JSON-LD was present in the reviewed live detail; deterministic visible HTML extraction is used.
- Application and closure: the first-party vacancy detail and its official Apply action are retained. Explicit closed/unavailable text and deadlines are honored.
- Language and geography: `en`; Berkeley/Bay Area, California, United States.
- Live extraction: HTTP 200 landing and active detail; current postdoctoral records, requisition metadata, location, and first-party action were extracted.
- Proposed frequency: `every_48_hours`.
- Decision: enabled.
- Reason: official ownership, public stable details, permissive robots policy, and reliable requisition links.

### European Molecular Biology Laboratory Jobs

- Source key: `embl-postdoctoral-jobs`
- Source name: European Molecular Biology Laboratory Jobs
- Official hostnames: `www.embl.org` and the linked official tenant `embl.wd103.myworkdayjobs.com`
- Listing URL: `https://www.embl.org/jobs/`; approved API root: `https://embl.wd103.myworkdayjobs.com/wday/cxs/embl/EMBL`
- Source type: official intergovernmental research institute careers portal; public Workday JSON API
- Robots result: `www.embl.org/jobs/` is allowed and redirects to the official tenant. The Workday policy allows `/EMBL/`, disallows `/refreshFacet/`, and does not disallow the bounded public careers JSON path. Refresh-facet and account/application workflow paths are not called.
- Content-Signal result: no `search=no` signal was present.
- Terms result: EMBL's public privacy/legal material covers recruitment and normal website use and did not identify a clear prohibition on bounded public vacancy retrieval. Only public vacancy facts and a bounded original-text field are stored; no applicant data or form submission occurs.
- Allowed path scope: one controlled POST to `/wday/cxs/embl/EMBL/jobs` with a fixed postdoc query and at most eight returned `/wday/cxs/embl/EMBL/job/...` detail GETs.
- Rendering requirement: the public page is a JavaScript shell, but its first-party public JSON endpoint provides the necessary data. Browser Run is not required.
- Pagination: fixed `offset`/`limit`; Phase 7B-A requests one page only.
- Structured data: stable JSON fields for requisition, title, description, dates, location, work time, state, and official URL; no HTML JobPosting JSON-LD is needed.
- Application and closure: the official Workday vacancy URL is both the truthful details/application destination. `posted`, `canApply`, explicit closure text, and deadline determine closure.
- Language and geography: `en`; EMBL sites across Germany, France, Spain, Italy, and the United Kingdom are mapped only from explicit Workday location text.
- Live extraction: the bounded API returned eight search results, including valid postdoctoral fellowships; a bounded detail returned requisition `JR4031`, dates, original English description, and official destination.
- Proposed frequency: `daily`.
- Decision: enabled.
- Reason: official ownership, allowed public API, accurate structured fields, international contribution, and no need for browser automation.

## Pending or rejected candidates

### EURAXESS Jobs

- Source key: `euraxess-jobs` (not registered as enabled)
- Source name: EURAXESS Jobs
- Official hostname: `euraxess.ec.europa.eu`
- Listing URL: `https://euraxess.ec.europa.eu/jobs`
- Source type: European Commission research-opportunity portal
- Robots result: the landing page is explicitly allowed, but the current policy also says `Disallow: /jobs/*`, which covers the actual `/jobs/search` and job-detail paths required for collection.
- Content-Signal result: no `search=no` signal was present on the public landing response.
- Terms result: the Commission legal notice generally permits reuse of EU-owned content with attribution, subject to third-party rights. EURAXESS states that employer organisations remain responsible for vacancies. This does not override robots restrictions.
- Allowed path scope: `/jobs` landing only; no usable job-detail collection scope was approved.
- Rendering requirement: the landing is server-rendered, but it contains navigation rather than vacancy records.
- Pagination and structured data: the landing had no vacancy pagination and no JobPosting JSON-LD. The actual search path returned HTTP 403 during the bounded check.
- Application and closure: not evaluated beyond the landing because the required search/detail paths failed policy/access review.
- Language and geography: multilingual, broad European/international contribution.
- Proposed frequency: none while pending.
- Decision: pending/rejected for automation.
- Reason: robots disallows required paths and the bounded search request returned 403. No bypass, browser automation, or alternate unreviewed endpoint will be attempted.

## Browser Run decision

Browser Run remains deferred. None of the three enabled additions requires it: ORNL and Berkeley Lab expose static HTML, and EMBL exposes a reviewed first-party public JSON endpoint. No `BROWSER` binding, API token, Quick Action, AI extraction, CAPTCHA handling, or WAF bypass is included.
