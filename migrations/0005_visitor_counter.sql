CREATE TABLE site_visitors (
  visitor_hash TEXT PRIMARY KEY,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);

CREATE TABLE site_visitor_days (
  visit_date TEXT NOT NULL,
  visitor_hash TEXT NOT NULL,
  first_seen_at TEXT NOT NULL,
  PRIMARY KEY (visit_date, visitor_hash),
  FOREIGN KEY (visitor_hash) REFERENCES site_visitors(visitor_hash)
    ON DELETE CASCADE
);

CREATE INDEX idx_site_visitor_days_date
ON site_visitor_days (visit_date);
