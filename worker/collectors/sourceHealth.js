import { calculateBackoff, isPolicyFailure } from "./sourceSchedule.js";

function sourceUrl(source) {
  return source.modes?.rss?.url
    ?? source.modes?.htmlFallback?.listingUrls?.[0]
    ?? "https://postdoc.researchzeal.com";
}

function sanitize(error) {
  return (error instanceof Error ? error.message : String(error ?? "Source failed."))
    .replace(/[\r\n\t]+/g, " ")
    .slice(0, 300);
}

export async function recordSourceSuccess(db, source, values, now = new Date()) {
  await db.prepare(
    `INSERT INTO collector_sources (
       source_key, source_name, source_url, etag, last_modified,
       last_attempt_at, last_success_at, last_status, last_error,
       last_mode, policy_result, consecutive_failures, next_allowed_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, 0, NULL)
     ON CONFLICT(source_key) DO UPDATE SET
       source_name = excluded.source_name,
       source_url = excluded.source_url,
       etag = COALESCE(excluded.etag, collector_sources.etag),
       last_modified = COALESCE(excluded.last_modified, collector_sources.last_modified),
       last_attempt_at = excluded.last_attempt_at,
       last_success_at = excluded.last_success_at,
       last_status = excluded.last_status,
       last_error = NULL,
       last_mode = excluded.last_mode,
       policy_result = excluded.policy_result,
       consecutive_failures = 0,
       next_allowed_at = NULL`,
  ).bind(
    source.key,
    source.name,
    sourceUrl(source),
    values.etag ?? null,
    values.lastModified ?? null,
    now.toISOString(),
    now.toISOString(),
    values.status ?? "success",
    values.mode ?? null,
    values.policyResult ? JSON.stringify(values.policyResult).slice(0, 1000) : null,
  ).run();
}

export async function recordSourceFailure(db, source, error, now = new Date()) {
  const state = await db.prepare(
    "SELECT consecutive_failures FROM collector_sources WHERE source_key = ?",
  ).bind(source.key).first();
  const failures = Number(state?.consecutive_failures ?? 0) + 1;
  const policyFailure = isPolicyFailure(error);
  const nextAllowedAt = calculateBackoff(failures, now, { policyFailure });
  await db.prepare(
    `INSERT INTO collector_sources (
       source_key, source_name, source_url, last_attempt_at, last_status,
       last_error, last_mode, policy_result, consecutive_failures, next_allowed_at
     ) VALUES (?, ?, ?, ?, 'failed', ?, NULL, ?, ?, ?)
     ON CONFLICT(source_key) DO UPDATE SET
       source_name = excluded.source_name,
       source_url = excluded.source_url,
       last_attempt_at = excluded.last_attempt_at,
       last_status = 'failed',
       last_error = excluded.last_error,
       policy_result = COALESCE(excluded.policy_result, collector_sources.policy_result),
       consecutive_failures = excluded.consecutive_failures,
       next_allowed_at = excluded.next_allowed_at`,
  ).bind(
    source.key,
    source.name,
    sourceUrl(source),
    now.toISOString(),
    sanitize(error),
    policyFailure ? JSON.stringify({ decision: "disabled-until-review", code: error?.code }) : null,
    failures,
    nextAllowedAt,
  ).run();
  return { consecutiveFailures: failures, nextAllowedAt, policyFailure };
}

export { sanitize as sanitizeSourceError };
