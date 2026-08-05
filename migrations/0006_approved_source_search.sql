CREATE TABLE source_search_requests (
  id TEXT PRIMARY KEY,
  query_hash TEXT NOT NULL,
  keyword TEXT NOT NULL DEFAULT '',
  country TEXT NOT NULL DEFAULT '',
  research_area TEXT NOT NULL DEFAULT '',
  language TEXT NOT NULL DEFAULT '',
  deadline TEXT NOT NULL DEFAULT 'any'
    CHECK (deadline IN ('any', '7', '30', '60', 'open', 'none')),
  status TEXT NOT NULL
    CHECK (status IN ('queued', 'running', 'success', 'partial', 'no_results', 'failed')),
  collection_run_id TEXT,
  requested_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT,
  cache_expires_at TEXT NOT NULL,
  expected_sources INTEGER NOT NULL DEFAULT 0,
  completed_sources INTEGER NOT NULL DEFAULT 0,
  sources_succeeded INTEGER NOT NULL DEFAULT 0,
  matching_jobs INTEGER NOT NULL DEFAULT 0,
  jobs_inserted INTEGER NOT NULL DEFAULT 0,
  error_code TEXT,
  error_summary TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (collection_run_id) REFERENCES collection_runs(id)
    ON DELETE SET NULL
);

CREATE INDEX idx_source_search_query_requested
ON source_search_requests (query_hash, requested_at DESC);

CREATE INDEX idx_source_search_status
ON source_search_requests (status);

CREATE INDEX idx_source_search_collection_run
ON source_search_requests (collection_run_id);

CREATE INDEX idx_source_search_cache_expires
ON source_search_requests (cache_expires_at);

CREATE UNIQUE INDEX idx_source_search_one_active_query
ON source_search_requests (query_hash)
WHERE status IN ('queued', 'running');

CREATE TABLE source_search_rate_limits (
  scope_type TEXT NOT NULL
    CHECK (scope_type IN ('visitor', 'global')),
  scope_key TEXT NOT NULL,
  window_start TEXT NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 0
    CHECK (request_count >= 0),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (scope_type, scope_key, window_start)
);

CREATE INDEX idx_source_search_rate_window
ON source_search_rate_limits (window_start);
