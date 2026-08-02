ALTER TABLE jobs ADD COLUMN origin_type TEXT NOT NULL DEFAULT 'seed'
  CHECK (origin_type IN ('seed', 'collected'));

ALTER TABLE jobs ADD COLUMN source_key TEXT;
ALTER TABLE jobs ADD COLUMN source_name TEXT;
ALTER TABLE jobs ADD COLUMN source_item_id TEXT;
ALTER TABLE jobs ADD COLUMN content_hash TEXT;
ALTER TABLE jobs ADD COLUMN first_seen_at TEXT;
ALTER TABLE jobs ADD COLUMN last_seen_at TEXT;
ALTER TABLE jobs ADD COLUMN last_verified_at TEXT;

ALTER TABLE jobs ADD COLUMN collection_state TEXT NOT NULL DEFAULT 'active'
  CHECK (collection_state IN ('active', 'stale', 'expired'));

CREATE UNIQUE INDEX IF NOT EXISTS idx_jobs_source_identity
ON jobs (source_key, source_item_id)
WHERE source_key IS NOT NULL AND source_item_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_jobs_public_collection
ON jobs (collection_state, is_demo, posted_at DESC)
WHERE is_active = 1;

CREATE TABLE IF NOT EXISTS collection_runs (
  id TEXT PRIMARY KEY,
  trigger_type TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'success', 'partial', 'failed')),
  sources_attempted INTEGER NOT NULL DEFAULT 0,
  sources_succeeded INTEGER NOT NULL DEFAULT 0,
  items_received INTEGER NOT NULL DEFAULT 0,
  items_accepted INTEGER NOT NULL DEFAULT 0,
  items_rejected INTEGER NOT NULL DEFAULT 0,
  jobs_inserted INTEGER NOT NULL DEFAULT 0,
  jobs_updated INTEGER NOT NULL DEFAULT 0,
  jobs_unchanged INTEGER NOT NULL DEFAULT 0,
  jobs_expired INTEGER NOT NULL DEFAULT 0,
  error_count INTEGER NOT NULL DEFAULT 0,
  summary_json TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_collection_runs_started
ON collection_runs (started_at DESC);

CREATE TABLE IF NOT EXISTS collector_sources (
  source_key TEXT PRIMARY KEY,
  source_name TEXT NOT NULL,
  source_url TEXT NOT NULL,
  etag TEXT,
  last_modified TEXT,
  last_attempt_at TEXT,
  last_success_at TEXT,
  last_status TEXT,
  last_error TEXT
);
