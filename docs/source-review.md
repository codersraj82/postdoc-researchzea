# Approved source review

## iMechanica Job Channel

- Review date: 2026-08-02
- Official hostname: `imechanica.org`
- Primary RSS URL: `https://imechanica.org/taxonomy/term/73/feed`
- Static HTML listing URL: `https://imechanica.org/taxonomy/term/73`
- Robots URL: `https://imechanica.org/robots.txt`
- Robots result: the current wildcard group permits the registered listing and visible root-level job-detail paths. Administrative, account, comment, search, and other disallowed paths remain excluded. HTML crawling fails closed if this policy cannot be evaluated.
- Content-Signal result: no `Content-Signal: search=no` header was present on the reviewed robots, RSS, or listing responses. Any future `search=no` response is skipped.
- Allowed crawl scope: one registered listing URL, at most one discovered pagination page, and at most ten same-host detail URLs found inside visible job-entry headings. Root-level slugs and numeric `/node/` detail paths are accepted only after listing discovery. Assets, accounts, comments, other taxonomies, navigation, external sites, and application URLs are not crawl targets.
- JavaScript rendering required: no. The listing and detail content is available as ordinary server-rendered HTML.
- Decision: approved for RSS-first collection with a robots-aware static HTML fallback.
- Reason: the source provides a structured RSS feed and a bounded public job-channel listing. The fallback can operate without login, browser rendering, form submission, or broad crawling while preserving original-source attribution.

Browser Run remains deferred. It will require a separate reviewed JavaScript-dependent source before any Browser binding or production browser call is introduced.
