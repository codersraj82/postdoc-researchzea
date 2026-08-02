PRAGMA defer_foreign_keys = ON;

ALTER TABLE collection_runs RENAME TO collection_runs_phase7a;

CREATE TABLE collection_runs (
  id TEXT PRIMARY KEY,
  trigger_type TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'success', 'partial', 'failed', 'skipped')),
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

INSERT INTO collection_runs (
  id, trigger_type, started_at, finished_at, status,
  sources_attempted, sources_succeeded, items_received, items_accepted,
  items_rejected, jobs_inserted, jobs_updated, jobs_unchanged,
  jobs_expired, error_count, summary_json
)
SELECT
  id, trigger_type, started_at, finished_at, status,
  sources_attempted, sources_succeeded, items_received, items_accepted,
  items_rejected, jobs_inserted, jobs_updated, jobs_unchanged,
  jobs_expired, error_count, summary_json
FROM collection_runs_phase7a;

DROP TABLE collection_runs_phase7a;

CREATE INDEX IF NOT EXISTS idx_collection_runs_started
ON collection_runs (started_at DESC);

ALTER TABLE jobs ADD COLUMN source_language TEXT;
ALTER TABLE jobs ADD COLUMN original_title TEXT;
ALTER TABLE jobs ADD COLUMN original_description TEXT;

UPDATE jobs
SET source_language = CASE
      WHEN LOWER(TRIM(language)) = 'english' THEN 'en'
      ELSE 'unknown'
    END,
    original_title = title,
    original_description = description
WHERE origin_type = 'collected';

ALTER TABLE collector_sources ADD COLUMN consecutive_failures INTEGER NOT NULL DEFAULT 0;
ALTER TABLE collector_sources ADD COLUMN next_allowed_at TEXT;

CREATE TABLE source_runs (
  id TEXT PRIMARY KEY,
  collection_run_id TEXT,
  message_id TEXT NOT NULL,
  source_key TEXT NOT NULL,
  source_name TEXT NOT NULL,
  source_type TEXT NOT NULL,
  mode_used TEXT,
  status TEXT NOT NULL
    CHECK (status IN ('queued', 'running', 'success', 'partial', 'failed', 'skipped', 'dead_lettered')),
  scheduled_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT,
  attempt_number INTEGER NOT NULL DEFAULT 0,
  pages_requested INTEGER NOT NULL DEFAULT 0,
  pages_succeeded INTEGER NOT NULL DEFAULT 0,
  items_received INTEGER NOT NULL DEFAULT 0,
  items_accepted INTEGER NOT NULL DEFAULT 0,
  items_rejected INTEGER NOT NULL DEFAULT 0,
  jobs_inserted INTEGER NOT NULL DEFAULT 0,
  jobs_updated INTEGER NOT NULL DEFAULT 0,
  jobs_unchanged INTEGER NOT NULL DEFAULT 0,
  jobs_stale INTEGER NOT NULL DEFAULT 0,
  jobs_expired INTEGER NOT NULL DEFAULT 0,
  duplicates_merged INTEGER NOT NULL DEFAULT 0,
  error_code TEXT,
  error_summary TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (collection_run_id) REFERENCES collection_runs(id) ON DELETE SET NULL,
  UNIQUE (message_id),
  UNIQUE (collection_run_id, source_key)
);

CREATE INDEX idx_source_runs_status ON source_runs (status);
CREATE INDEX idx_source_runs_source_key ON source_runs (source_key);
CREATE INDEX idx_source_runs_scheduled_at ON source_runs (scheduled_at DESC);
CREATE INDEX idx_source_runs_collection_run ON source_runs (collection_run_id);

CREATE TABLE job_sources (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  source_key TEXT NOT NULL,
  source_name TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_item_id TEXT NOT NULL,
  source_url TEXT NOT NULL,
  apply_url TEXT,
  source_language TEXT NOT NULL DEFAULT 'unknown',
  observed_title TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  last_verified_at TEXT NOT NULL,
  is_primary INTEGER NOT NULL DEFAULT 0 CHECK (is_primary IN (0, 1)),
  observation_state TEXT NOT NULL DEFAULT 'active'
    CHECK (observation_state IN ('active', 'stale', 'expired')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE,
  UNIQUE (source_key, source_item_id)
);

CREATE INDEX idx_job_sources_job_id ON job_sources (job_id);
CREATE INDEX idx_job_sources_source_url ON job_sources (source_url);
CREATE INDEX idx_job_sources_apply_url ON job_sources (apply_url);
CREATE INDEX idx_job_sources_is_primary ON job_sources (is_primary);
CREATE UNIQUE INDEX idx_job_sources_one_primary
ON job_sources (job_id)
WHERE is_primary = 1;

INSERT OR IGNORE INTO job_sources (
  id, job_id, source_key, source_name, source_type, source_item_id,
  source_url, apply_url, source_language, observed_title, content_hash,
  first_seen_at, last_seen_at, last_verified_at, is_primary,
  observation_state, created_at, updated_at
)
SELECT
  'observation-' || id,
  id,
  source_key,
  COALESCE(source_name, source_key),
  source_type,
  source_item_id,
  COALESCE(source_url, canonical_url),
  apply_url,
  COALESCE(source_language, 'unknown'),
  title,
  COALESCE(content_hash, id),
  COALESCE(first_seen_at, created_at),
  COALESCE(last_seen_at, updated_at),
  COALESCE(last_verified_at, updated_at),
  1,
  collection_state,
  created_at,
  updated_at
FROM jobs
WHERE origin_type = 'collected'
  AND is_demo = 0
  AND source_key IS NOT NULL
  AND source_item_id IS NOT NULL
  AND COALESCE(source_url, canonical_url) IS NOT NULL;

PRAGMA defer_foreign_keys = OFF;
