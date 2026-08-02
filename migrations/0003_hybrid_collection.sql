ALTER TABLE jobs ADD COLUMN source_type TEXT NOT NULL DEFAULT 'seed'
  CHECK (source_type IN ('seed', 'rss', 'html'));

ALTER TABLE jobs ADD COLUMN canonical_url TEXT;
ALTER TABLE jobs ADD COLUMN expiry_reason TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_jobs_source_canonical
ON jobs (source_key, canonical_url)
WHERE origin_type = 'collected'
  AND source_key IS NOT NULL
  AND canonical_url IS NOT NULL;

ALTER TABLE collector_sources ADD COLUMN last_mode TEXT;
ALTER TABLE collector_sources ADD COLUMN policy_result TEXT;
