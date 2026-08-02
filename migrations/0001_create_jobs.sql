CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,

  title TEXT NOT NULL,
  institution TEXT NOT NULL,

  country TEXT NOT NULL,
  city TEXT,

  research_area TEXT NOT NULL,
  language TEXT NOT NULL DEFAULT 'English',

  description TEXT NOT NULL,

  apply_url TEXT NOT NULL,
  source_url TEXT,

  deadline TEXT,
  posted_at TEXT NOT NULL,

  employment_type TEXT,
  duration TEXT,
  tags_json TEXT NOT NULL DEFAULT '[]',

  is_active INTEGER NOT NULL DEFAULT 1
    CHECK (is_active IN (0, 1)),

  is_demo INTEGER NOT NULL DEFAULT 0
    CHECK (is_demo IN (0, 1)),

  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_jobs_active
ON jobs (is_active);

CREATE INDEX IF NOT EXISTS idx_jobs_country
ON jobs (country);

CREATE INDEX IF NOT EXISTS idx_jobs_research_area
ON jobs (research_area);

CREATE INDEX IF NOT EXISTS idx_jobs_language
ON jobs (language);

CREATE INDEX IF NOT EXISTS idx_jobs_deadline
ON jobs (deadline);

CREATE INDEX IF NOT EXISTS idx_jobs_posted_at
ON jobs (posted_at DESC);

CREATE INDEX IF NOT EXISTS idx_jobs_active_posted
ON jobs (is_active, posted_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_jobs_unique_source_url
ON jobs (source_url)
WHERE source_url IS NOT NULL;
