import { finalizeCollectionRun, TERMINAL_SOURCE_STATUSES } from "./collectors/collectionRuns.js";
import { createOnDemandSourceQueueMessage, looksLikeUuid } from "./collectors/queueMessage.js";
import { getEnabledSources } from "./collectors/sourceRegistry.js";
import {
  countMatchingJobs,
  DEADLINE_OPTIONS,
  hasMeaningfulJobSearchFilter,
  JOB_SEARCH_LIMITS,
  normalizeJobSearchFilters,
} from "./jobSearch.js";
import {
  createVisitorIdCookie,
  hashVisitorId,
  isValidVisitorId,
  parseCookieHeader,
  VISITOR_COOKIE,
} from "./visitors.js";

const BODY_LIMIT_BYTES = 4 * 1024;
const CACHE_HOURS = 12;
const SOURCE_COOLDOWN_MS = 60 * 60 * 1000;
const STALE_REQUEST_MS = 45 * 60 * 1000;
const VISITOR_HOURLY_LIMIT = 3;
const GLOBAL_HOURLY_LIMIT = 20;
const TERMINAL_REQUEST_STATUSES = new Set(["success", "partial", "no_results", "failed"]);
const REUSABLE_TERMINAL_REQUEST_STATUSES = new Set(["success", "partial", "no_results"]);
const ACTIVE_REQUEST_STATUSES = new Set(["queued", "running"]);
const REQUEST_KEYS = Object.freeze([
  "country",
  "deadline",
  "keyword",
  "language",
  "research_area",
]);
const DEADLINE_SET = new Set(DEADLINE_OPTIONS);
const HTML_OR_URL = /(?:<|>|&(?:lt|gt|#0*60|#x0*3c);|https?:\/\/|www\.)/i;

const RESPONSE_HEADERS = Object.freeze({
  "Cache-Control": "no-store",
  "Content-Type": "application/json; charset=utf-8",
  "X-Content-Type-Options": "nosniff",
});

export function sourceSearchJson(payload, status = 200, options = {}) {
  const headers = new Headers(RESPONSE_HEADERS);
  for (const [name, value] of Object.entries(options.headers ?? {})) {
    headers.set(name, value);
  }
  for (const value of options.cookies ?? []) headers.append("Set-Cookie", value);
  return new Response(JSON.stringify(payload), { status, headers });
}

export function sourceSearchError(status, code, message, options = {}) {
  return sourceSearchJson({ ok: false, error: { code, message } }, status, options);
}

function allowedKeys(value, expected) {
  return value !== null
    && typeof value === "object"
    && !Array.isArray(value)
    && Object.keys(value).every((key) => expected.includes(key));
}

function sameOrigin(request) {
  const origin = request.headers.get("Origin");
  if (!origin) return true;
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

async function readBoundedBody(request, maximumBytes = BODY_LIMIT_BYTES) {
  const declared = Number(request.headers.get("Content-Length"));
  if (Number.isFinite(declared) && declared > maximumBytes) {
    return { ok: false, code: "REQUEST_TOO_LARGE" };
  }
  const reader = request.body?.getReader();
  if (!reader) return { ok: true, text: "" };
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximumBytes) {
        await reader.cancel();
        return { ok: false, code: "REQUEST_TOO_LARGE" };
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, text: new TextDecoder().decode(bytes) };
}

export function validateSourceSearchPayload(payload) {
  if (!allowedKeys(payload, REQUEST_KEYS)) {
    return { valid: false, code: "INVALID_REQUEST", message: "The request fields are invalid." };
  }
  for (const value of Object.values(payload)) {
    if (typeof value !== "string") {
      return { valid: false, code: "INVALID_REQUEST", message: "Search fields must be strings." };
    }
  }
  const rawLimits = {
    keyword: JOB_SEARCH_LIMITS.keyword,
    country: JOB_SEARCH_LIMITS.country,
    research_area: JOB_SEARCH_LIMITS.research_area,
    language: JOB_SEARCH_LIMITS.language,
  };
  for (const [key, maximum] of Object.entries(rawLimits)) {
    const value = String(payload[key] ?? "");
    if (value.trim().length > maximum) {
      return { valid: false, code: "VALUE_TOO_LONG", message: `The ${key} filter is too long.` };
    }
    if (HTML_OR_URL.test(value)) {
      return { valid: false, code: "UNSAFE_FILTER", message: "URLs and HTML are not accepted." };
    }
  }
  const deadline = String(payload.deadline ?? "").trim().toLowerCase() || "any";
  if (!DEADLINE_SET.has(deadline)) {
    return { valid: false, code: "INVALID_DEADLINE", message: "The deadline filter is invalid." };
  }
  const filters = normalizeJobSearchFilters({ ...payload, deadline });
  if (!hasMeaningfulJobSearchFilter(filters)) {
    return { valid: false, code: "EMPTY_FILTER", message: "At least one search filter is required." };
  }
  return { valid: true, filters };
}

function canonicalValue(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

export function canonicalSourceSearchQuery(filters) {
  const normalized = normalizeJobSearchFilters(filters);
  return JSON.stringify({
    country: canonicalValue(normalized.country),
    deadline: canonicalValue(normalized.deadline),
    keyword: canonicalValue(normalized.keyword),
    language: canonicalValue(normalized.language),
    research_area: canonicalValue(normalized.research_area),
  });
}

export async function hashSourceSearchQuery(filters, cryptoImpl = crypto) {
  const bytes = new TextEncoder().encode(canonicalSourceSearchQuery(filters));
  const digest = await cryptoImpl.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function hourWindow(now) {
  const start = new Date(now);
  start.setUTCMinutes(0, 0, 0);
  const end = new Date(start.getTime() + 60 * 60 * 1000);
  return {
    start: start.toISOString(),
    retryAfter: Math.max(1, Math.ceil((end.getTime() - now.getTime()) / 1000)),
  };
}

export async function consumeSourceSearchRateLimit(db, visitorHash, now = new Date()) {
  const window = hourWindow(now);
  const nowIso = now.toISOString();
  const result = await db.prepare(
    `WITH current_counts AS (
       SELECT
         COALESCE((
           SELECT request_count FROM source_search_rate_limits
           WHERE scope_type = 'visitor' AND scope_key = ?1 AND window_start = ?2
         ), 0) AS visitor_count,
         COALESCE((
           SELECT request_count FROM source_search_rate_limits
           WHERE scope_type = 'global'
             AND scope_key = 'approved-source-search'
             AND window_start = ?2
         ), 0) AS global_count
     ), permitted AS (
       SELECT 1 AS allowed FROM current_counts
       WHERE visitor_count < ?4 AND global_count < ?5
     )
     INSERT INTO source_search_rate_limits (
       scope_type, scope_key, window_start, request_count, updated_at
     )
     SELECT 'visitor', ?1, ?2, 1, ?3 FROM permitted WHERE true
     UNION ALL
     SELECT 'global', 'approved-source-search', ?2, 1, ?3
     FROM permitted WHERE true
     ON CONFLICT(scope_type, scope_key, window_start) DO UPDATE SET
       request_count = source_search_rate_limits.request_count + 1,
       updated_at = excluded.updated_at
     RETURNING scope_type, request_count`,
  ).bind(
    visitorHash,
    window.start,
    nowIso,
    VISITOR_HOURLY_LIMIT,
    GLOBAL_HOURLY_LIMIT,
  ).all();
  return {
    allowed: result.results?.length === 2,
    retryAfter: window.retryAfter,
  };
}

function sourceUrl(source) {
  return source.modes?.rss?.url
    ?? source.modes?.htmlFallback?.listingUrls?.[0]
    ?? "https://postdoc.researchzeal.com";
}

function timestamp(value) {
  const parsed = new Date(value ?? "").getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

export function sourceRefreshDisposition(state, now = new Date()) {
  const nextAllowedAt = timestamp(state?.next_allowed_at);
  if (nextAllowedAt !== null && nextAllowedAt > now.getTime()) {
    const policyPause = nextAllowedAt >= new Date("9999-01-01T00:00:00.000Z").getTime();
    return {
      eligible: false,
      reliable: false,
      mode: policyPause ? "policy-pause" : "backoff",
      code: policyPause ? "SOURCE_POLICY_PAUSED" : "SOURCE_BACKOFF",
    };
  }
  const lastSuccessAt = timestamp(state?.last_success_at);
  if (lastSuccessAt !== null && now.getTime() - lastSuccessAt < SOURCE_COOLDOWN_MS) {
    return { eligible: false, reliable: true, mode: "recent-cache", code: null };
  }
  return { eligible: true, reliable: false, mode: null, code: null };
}

async function loadSourceStates(db) {
  const result = await db.prepare(
    `SELECT source_key, last_attempt_at, last_success_at, next_allowed_at,
            consecutive_failures, last_status
     FROM collector_sources`,
  ).all();
  return Object.fromEntries((result.results ?? []).map((row) => [row.source_key, row]));
}

function requestPublicFields(row) {
  return {
    ok: true,
    request_id: row.id,
    status: row.status,
    expected_sources: Number(row.expected_sources ?? 0),
    completed_sources: Number(row.completed_sources ?? 0),
    sources_succeeded: Number(row.sources_succeeded ?? 0),
    matching_jobs: Number(row.matching_jobs ?? 0),
    started_at: row.started_at ?? null,
    finished_at: row.finished_at ?? null,
    cache_expires_at: row.cache_expires_at,
  };
}

async function findReusableRequest(db, queryHash, now = new Date()) {
  const nowDate = now instanceof Date ? now : new Date(now);
  const nowIso = nowDate.toISOString();
  const staleCutoff = new Date(nowDate.getTime() - STALE_REQUEST_MS).toISOString();
  return db.prepare(
    `SELECT * FROM source_search_requests
     WHERE query_hash = ?
       AND (
         (status IN ('queued', 'running') AND requested_at >= ?)
         OR (status IN ('success', 'partial', 'no_results')
             AND cache_expires_at > ?)
       )
     ORDER BY CASE WHEN status IN ('queued', 'running') THEN 0 ELSE 1 END,
              requested_at DESC
     LIMIT 1`,
  ).bind(queryHash, staleCutoff, nowIso).first();
}

async function insertSearchClaim(db, values) {
  const result = await db.prepare(
    `INSERT OR IGNORE INTO source_search_requests (
       id, query_hash, keyword, country, research_area, language, deadline,
       status, collection_run_id, requested_at, cache_expires_at,
       expected_sources, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', NULL, ?, ?, ?, ?, ?)`,
  ).bind(
    values.requestId,
    values.queryHash,
    values.filters.keyword,
    values.filters.country,
    values.filters.research_area,
    values.filters.language,
    values.filters.deadline,
    values.now,
    values.cacheExpiresAt,
    values.expectedSources,
    values.now,
    values.now,
  ).run();
  return Number(result?.meta?.changes ?? 0) === 1;
}

async function insertCollectionRunForSearch(db, values) {
  const results = await db.batch([
    db.prepare(
      `INSERT INTO collection_runs (
         id, trigger_type, started_at, status, sources_attempted, summary_json
       ) VALUES (?, 'on_demand_search', ?, 'running', ?, ?)`,
    ).bind(
      values.runId,
      values.now,
      values.expectedSources,
      JSON.stringify({ reason: "on_demand", searchRequestId: values.requestId }),
    ),
    db.prepare(
      `UPDATE source_search_requests SET collection_run_id = ?, updated_at = ?
       WHERE id = ? AND status = 'queued' AND collection_run_id IS NULL`,
    ).bind(values.runId, values.now, values.requestId),
  ]);
  if (Number(results[1]?.meta?.changes ?? 0) !== 1) {
    throw new Error("Approved-source search claim could not be linked.");
  }
}

async function releaseRateLimitedClaim(db, requestId) {
  await db.prepare(
    `DELETE FROM source_search_requests
     WHERE id = ? AND status = 'queued' AND collection_run_id IS NULL`,
  ).bind(requestId).run();
}

async function insertSourceRun(db, values) {
  await db.prepare(
    `INSERT INTO source_runs (
       id, collection_run_id, message_id, source_key, source_name,
       source_type, mode_used, status, scheduled_at, finished_at,
       error_code, error_summary, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    values.id,
    values.runId,
    values.message.messageId,
    values.source.key,
    values.source.name,
    values.source.type,
    values.disposition.mode,
    values.disposition.eligible ? "queued" : "skipped",
    values.now,
    values.disposition.eligible ? null : values.now,
    values.disposition.code,
    values.disposition.code
      ? "Source refresh was deferred by its approved health policy."
      : null,
    values.now,
    values.now,
  ).run();
}

async function scheduleApprovedSources(env, values, options = {}) {
  const sources = options.sources ?? getEnabledSources();
  const states = await loadSourceStates(env.DB);
  const queued = [];
  const failures = [];
  for (const source of sources) {
    await env.DB.prepare(
      `INSERT INTO collector_sources (source_key, source_name, source_url)
       VALUES (?, ?, ?)
       ON CONFLICT(source_key) DO UPDATE SET
         source_name = excluded.source_name,
         source_url = excluded.source_url`,
    ).bind(source.key, source.name, sourceUrl(source)).run();
    const disposition = sourceRefreshDisposition(states[source.key], values.nowDate);
    const message = createOnDemandSourceQueueMessage({
      runId: values.runId,
      sourceKey: source.key,
      searchRequestId: values.requestId,
      scheduledAt: values.nowDate,
      uuid: values.uuid,
    });
    await insertSourceRun(env.DB, {
      id: values.uuid(),
      runId: values.runId,
      message,
      source,
      disposition,
      now: values.now,
    });
    if (!disposition.eligible) continue;
    try {
      await env.SOURCE_COLLECTION_QUEUE.send(message);
      queued.push(source.key);
    } catch (error) {
      failures.push(source.key);
      await env.DB.prepare(
        `UPDATE source_runs SET status = 'failed', finished_at = ?,
           error_code = 'QUEUE_SEND_FAILED', error_summary = ?, updated_at = ?
         WHERE message_id = ? AND status = 'queued'`,
      ).bind(
        values.now,
        "The approved source could not be queued.",
        values.now,
        message.messageId,
      ).run();
    }
  }
  await env.DB.prepare(
    `UPDATE collection_runs SET error_count = ?, summary_json = ? WHERE id = ?`,
  ).bind(
    failures.length,
    JSON.stringify({
      reason: "on_demand",
      searchRequestId: values.requestId,
      sourcesQueued: queued,
      queueFailures: failures,
    }),
    values.runId,
  ).run();
  return { queued, failures };
}

export async function markSourceSearchRunning(db, requestId, now = new Date()) {
  if (!requestId) return;
  await db.prepare(
    `UPDATE source_search_requests SET status = 'running',
       started_at = COALESCE(started_at, ?), updated_at = ?
     WHERE id = ? AND status IN ('queued', 'running')`,
  ).bind(now.toISOString(), now.toISOString(), requestId).run();
}

function sourceRunSummary(rows) {
  const completed = rows.filter((row) => TERMINAL_SOURCE_STATUSES.has(row.status));
  const reliable = rows.filter((row) =>
    ["success", "partial"].includes(row.status)
    || (row.status === "skipped" && row.mode_used === "recent-cache"));
  const failures = rows.filter((row) =>
    ["failed", "dead_lettered"].includes(row.status)
    || (row.status === "skipped" && row.mode_used !== "recent-cache"));
  return {
    completed: completed.length,
    reliable: reliable.length,
    failures: failures.length,
    jobsInserted: rows.reduce((total, row) => total + Number(row.jobs_inserted ?? 0), 0),
    running: rows.some((row) => !TERMINAL_SOURCE_STATUSES.has(row.status)),
  };
}

export async function finalizeSourceSearchRequest(db, requestId, now = new Date(), options = {}) {
  if (!requestId) return { finalized: false, status: null };
  const request = await db.prepare(
    "SELECT * FROM source_search_requests WHERE id = ? LIMIT 1",
  ).bind(requestId).first();
  if (!request || TERMINAL_REQUEST_STATUSES.has(request.status)) {
    return { finalized: false, status: request?.status ?? null };
  }
  const result = await db.prepare(
    `SELECT status, mode_used, jobs_inserted
     FROM source_runs WHERE collection_run_id = ? ORDER BY source_key`,
  ).bind(request.collection_run_id).all();
  const rows = result.results ?? [];
  const summary = sourceRunSummary(rows);
  const expectedSources = Math.max(0, Number(request.expected_sources ?? 0));
  const incompleteAccounting = rows.length < expectedSources;
  const nowIso = now.toISOString();
  if (summary.running || incompleteAccounting) {
    const completedSources = Math.min(summary.completed, expectedSources);
    const sourcesSucceeded = Math.min(summary.reliable, expectedSources);
    await db.prepare(
      `UPDATE source_search_requests SET status = 'running',
         started_at = COALESCE(started_at, ?), completed_sources = ?,
         sources_succeeded = ?, jobs_inserted = ?, updated_at = ?
       WHERE id = ? AND status IN ('queued', 'running')`,
    ).bind(
      nowIso,
      completedSources,
      sourcesSucceeded,
      summary.jobsInserted,
      nowIso,
      requestId,
    ).run();
    return { finalized: false, status: "running" };
  }
  const filters = {
    keyword: request.keyword,
    country: request.country,
    research_area: request.research_area,
    language: request.language,
    deadline: request.deadline,
  };
  const countJobs = options.countMatchingJobs ?? countMatchingJobs;
  const matchingJobs = await countJobs(db, filters);
  const accountingMismatch = rows.length !== expectedSources;
  let status;
  if (matchingJobs > 0) {
    status = summary.failures || accountingMismatch ? "partial" : "success";
  }
  else status = summary.reliable > 0 ? "no_results" : "failed";
  const cacheExpiresAt = status === "failed"
    ? nowIso
    : new Date(now.getTime() + CACHE_HOURS * 60 * 60 * 1000).toISOString();
  const completedSources = Math.min(summary.completed, expectedSources);
  const sourcesSucceeded = Math.min(summary.reliable, expectedSources);
  await db.prepare(
    `UPDATE source_search_requests SET status = ?,
       started_at = COALESCE(started_at, requested_at), finished_at = ?,
       cache_expires_at = ?, completed_sources = ?, sources_succeeded = ?,
       matching_jobs = ?, jobs_inserted = ?, error_code = ?, error_summary = ?,
       updated_at = ?
     WHERE id = ? AND status IN ('queued', 'running')`,
  ).bind(
    status,
    nowIso,
    cacheExpiresAt,
    completedSources,
    sourcesSucceeded,
    matchingJobs,
    summary.jobsInserted,
    status === "failed" ? "REFRESH_FAILED" : null,
    status === "failed" ? "No approved source refresh completed successfully." : null,
    nowIso,
    requestId,
  ).run();
  return {
    finalized: true,
    status,
    matchingJobs,
    jobsInserted: summary.jobsInserted,
  };
}

export async function startApprovedSourceSearch(env, filters, options = {}) {
  const nowDate = options.now instanceof Date ? options.now : new Date();
  const now = nowDate.toISOString();
  const uuid = options.uuid ?? (() => crypto.randomUUID());
  const countJobs = options.countMatchingJobs ?? countMatchingJobs;
  const hashQuery = options.hashSourceSearchQuery ?? hashSourceSearchQuery;
  const findReusable = options.findReusableRequest ?? findReusableRequest;
  const consumeRateLimit = options.consumeSourceSearchRateLimit
    ?? consumeSourceSearchRateLimit;
  const claimRequest = options.insertSearchClaim ?? insertSearchClaim;
  const createRun = options.insertCollectionRunForSearch ?? insertCollectionRunForSearch;
  const rejectClaim = options.releaseRateLimitedClaim ?? releaseRateLimitedClaim;
  const scheduleSources = options.scheduleApprovedSources ?? scheduleApprovedSources;
  const loadRequest = options.loadSourceSearchRequest ?? ((db, requestId) => db.prepare(
    "SELECT * FROM source_search_requests WHERE id = ?",
  ).bind(requestId).first());
  const matchingJobs = await countJobs(env.DB, filters);
  if (matchingJobs > 0) {
    return {
      payload: {
        ok: true,
        status: "results_available",
        refresh_started: false,
        matching_jobs: matchingJobs,
      },
    };
  }
  const queryHash = await hashQuery(filters, options.cryptoImpl ?? crypto);
  const reusable = await findReusable(env.DB, queryHash, nowDate);
  if (reusable) {
    return {
      payload: {
        ok: true,
        status: reusable.status,
        request_id: reusable.id,
        refresh_started: false,
        cached: REUSABLE_TERMINAL_REQUEST_STATUSES.has(reusable.status),
        matching_jobs: Number(reusable.matching_jobs ?? 0),
        cache_expires_at: reusable.cache_expires_at,
      },
    };
  }

  const sources = options.sources ?? getEnabledSources();
  const requestId = uuid();
  const runId = uuid();
  const cacheExpiresAt = new Date(
    nowDate.getTime() + CACHE_HOURS * 60 * 60 * 1000,
  ).toISOString();
  const claimValues = {
    requestId,
    runId,
    queryHash,
    filters,
    expectedSources: sources.length,
    now,
    cacheExpiresAt,
  };
  const claimed = await claimRequest(env.DB, claimValues);
  if (!claimed) {
    const concurrent = await findReusable(env.DB, queryHash, nowDate);
    if (!concurrent) {
      throw new Error("Equivalent approved-source search claim was not visible.");
    }
    return {
      payload: {
        ok: true,
        status: concurrent.status,
        request_id: concurrent.id,
        refresh_started: false,
        cached: REUSABLE_TERMINAL_REQUEST_STATUSES.has(concurrent.status),
        matching_jobs: Number(concurrent.matching_jobs ?? 0),
        cache_expires_at: concurrent.cache_expires_at,
      },
    };
  }

  const visitorHash = options.visitorHash;
  const rateLimit = await consumeRateLimit(env.DB, visitorHash, nowDate);
  if (!rateLimit.allowed) {
    await rejectClaim(env.DB, requestId);
    return {
      status: 429,
      headers: { "Retry-After": String(rateLimit.retryAfter) },
      payload: {
        ok: false,
        error: {
          code: "RATE_LIMITED",
          message: "Approved-source search is temporarily rate limited. Please try again later.",
        },
      },
    };
  }

  await createRun(env.DB, claimValues);

  const scheduling = await scheduleSources(env, {
    requestId,
    runId,
    nowDate,
    now,
    uuid,
  }, { sources });
  if (!scheduling.queued.length || scheduling.failures.length) {
    await finalizeCollectionRun(env.DB, runId, nowDate);
    await finalizeSourceSearchRequest(env.DB, requestId, nowDate);
  }
  const request = await loadRequest(env.DB, requestId);
  return {
    status: 202,
    payload: {
      ok: true,
      status: request?.status ?? "queued",
      request_id: requestId,
      refresh_started: scheduling.queued.length > 0,
      cached: false,
      matching_jobs: Number(request?.matching_jobs ?? 0),
      cache_expires_at: request?.cache_expires_at ?? cacheExpiresAt,
    },
  };
}

function visitorIdentity(request, options = {}) {
  const cookies = parseCookieHeader(request.headers.get("Cookie"));
  const existing = cookies[VISITOR_COOKIE];
  if (isValidVisitorId(existing)) return { visitorId: existing, cookie: null };
  const visitorId = (options.randomUUID ?? (() => crypto.randomUUID()))();
  return { visitorId, cookie: createVisitorIdCookie(visitorId) };
}

export async function handleSourceSearchPost(request, env, options = {}) {
  if (!sameOrigin(request)) {
    return sourceSearchError(403, "ORIGIN_NOT_ALLOWED", "The request origin is not allowed.");
  }
  const contentType = request.headers.get("Content-Type")?.split(";", 1)[0].trim().toLowerCase();
  if (contentType !== "application/json") {
    return sourceSearchError(415, "UNSUPPORTED_MEDIA_TYPE", "Content-Type must be application/json.");
  }
  const body = await readBoundedBody(request);
  if (!body.ok) {
    return sourceSearchError(413, "REQUEST_TOO_LARGE", "The request body exceeds 4 KB.");
  }
  let payload;
  try {
    payload = JSON.parse(body.text);
  } catch {
    return sourceSearchError(400, "INVALID_JSON", "The request body must be valid JSON.");
  }
  const validation = validateSourceSearchPayload(payload);
  if (!validation.valid) {
    return sourceSearchError(400, validation.code, validation.message);
  }
  const identity = visitorIdentity(request, options);
  const visitorHash = await hashVisitorId(identity.visitorId, options.cryptoImpl ?? crypto);
  try {
    const result = await startApprovedSourceSearch(env, validation.filters, {
      ...options,
      visitorHash,
    });
    return sourceSearchJson(result.payload, result.status ?? 200, {
      headers: result.headers,
      cookies: identity.cookie ? [identity.cookie] : [],
    });
  } catch (error) {
    console.error(JSON.stringify({
      event: "approved_source_search_failed",
      error: error instanceof Error ? error.name : "UnknownError",
    }));
    return sourceSearchError(
      503,
      "SOURCE_SEARCH_UNAVAILABLE",
      "Approved-source search is temporarily unavailable.",
      { cookies: identity.cookie ? [identity.cookie] : [] },
    );
  }
}

export async function handleSourceSearchStatus(requestId, env) {
  if (!looksLikeUuid(requestId)) {
    return sourceSearchError(400, "INVALID_REQUEST_ID", "The search request ID is invalid.");
  }
  try {
    const row = await env.DB.prepare(
      `SELECT id, status, expected_sources, completed_sources,
              sources_succeeded, matching_jobs, started_at, finished_at,
              cache_expires_at
       FROM source_search_requests WHERE id = ? LIMIT 1`,
    ).bind(requestId).first();
    if (!row) {
      return sourceSearchError(404, "NOT_FOUND", "The search request was not found.");
    }
    return sourceSearchJson(requestPublicFields(row));
  } catch (error) {
    console.error(JSON.stringify({
      event: "approved_source_search_status_failed",
      error: error instanceof Error ? error.name : "UnknownError",
    }));
    return sourceSearchError(
      503,
      "SOURCE_SEARCH_UNAVAILABLE",
      "Approved-source search is temporarily unavailable.",
    );
  }
}

export async function cleanupSourceSearchData(db, now = new Date()) {
  const requestCutoff = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const rateCutoff = new Date(now.getTime() - 48 * 60 * 60 * 1000).toISOString();
  const results = await db.batch([
    db.prepare(
      `DELETE FROM source_search_requests
       WHERE requested_at < ?
         AND status IN ('success', 'partial', 'no_results', 'failed')`,
    ).bind(requestCutoff),
    db.prepare(
      "DELETE FROM source_search_rate_limits WHERE window_start < ?",
    ).bind(rateCutoff),
  ]);
  return {
    requestsDeleted: Number(results[0]?.meta?.changes ?? 0),
    rateWindowsDeleted: Number(results[1]?.meta?.changes ?? 0),
  };
}

function recoverySourceDefinition(source, index) {
  if (source) return source;
  return {
    key: `unavailable-approved-source-${index + 1}`,
    name: "Previously approved source",
    type: "recovery",
  };
}

async function createRecoveryCollectionRun(db, request, now, uuid) {
  const collectionRunId = uuid();
  await db.batch([
    db.prepare(
      `INSERT INTO collection_runs (
         id, trigger_type, started_at, status, sources_attempted, summary_json
       ) VALUES (?, 'on_demand_search', ?, 'running', ?, ?)`,
    ).bind(
      collectionRunId,
      request.requested_at,
      Number(request.expected_sources ?? 0),
      JSON.stringify({ reason: "stale-recovery", searchRequestId: request.id }),
    ),
    db.prepare(
      `UPDATE source_search_requests SET collection_run_id = ?, updated_at = ?
       WHERE id = ? AND status IN ('queued', 'running') AND collection_run_id IS NULL`,
    ).bind(collectionRunId, now, request.id),
  ]);
  return collectionRunId;
}

async function insertMissingRecoveryRun(db, request, collectionRunId, source, now, uuid) {
  await db.prepare(
    `INSERT OR IGNORE INTO source_runs (
       id, collection_run_id, message_id, source_key, source_name, source_type,
       mode_used, status, scheduled_at, finished_at, attempt_number,
       error_code, error_summary, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, 'stale-recovery', 'failed', ?, ?, 0,
       'STALE_ON_DEMAND_SEARCH', ?, ?, ?)`,
  ).bind(
    uuid(),
    collectionRunId,
    uuid(),
    source.key,
    source.name,
    source.type,
    request.requested_at,
    now,
    "The interrupted approved-source search was recovered after its timeout.",
    now,
    now,
  ).run();
}

export async function recoverStaleSourceSearchRequests(db, now = new Date(), options = {}) {
  const nowIso = now.toISOString();
  const staleCutoff = new Date(now.getTime() - STALE_REQUEST_MS).toISOString();
  const sources = options.sources ?? getEnabledSources();
  const uuid = options.uuid ?? (() => crypto.randomUUID());
  const finalizeCollection = options.finalizeCollectionRun ?? finalizeCollectionRun;
  const finalizeSearch = options.finalizeSourceSearchRequest ?? finalizeSourceSearchRequest;
  const staleResult = await db.prepare(
    `SELECT * FROM source_search_requests
     WHERE status IN ('queued', 'running') AND requested_at < ?
     ORDER BY requested_at ASC LIMIT 50`,
  ).bind(staleCutoff).all();
  let recovered = 0;
  for (const request of staleResult.results ?? []) {
    let collectionRunId = request.collection_run_id;
    if (!collectionRunId) {
      collectionRunId = await createRecoveryCollectionRun(db, request, nowIso, uuid);
    } else {
      await db.prepare(
        `UPDATE collection_runs SET status = 'running', finished_at = NULL
         WHERE id = ?`,
      ).bind(collectionRunId).run();
    }
    const runResult = await db.prepare(
      "SELECT source_key, status FROM source_runs WHERE collection_run_id = ?",
    ).bind(collectionRunId).all();
    const existingKeys = new Set((runResult.results ?? []).map((run) => run.source_key));
    const expectedSources = Math.max(0, Number(request.expected_sources ?? 0));
    for (let index = 0; index < expectedSources; index += 1) {
      const definition = recoverySourceDefinition(sources[index], index);
      if (existingKeys.has(definition.key)) continue;
      await insertMissingRecoveryRun(
        db,
        request,
        collectionRunId,
        definition,
        nowIso,
        uuid,
      );
      existingKeys.add(definition.key);
    }
    await db.prepare(
      `UPDATE source_runs SET status = 'failed', finished_at = ?,
         mode_used = COALESCE(mode_used, 'stale-recovery'),
         error_code = 'STALE_ON_DEMAND_SEARCH',
         error_summary = ?, updated_at = ?
       WHERE collection_run_id = ? AND status IN ('queued', 'running')`,
    ).bind(
      nowIso,
      "The interrupted approved-source search exceeded its recovery timeout.",
      nowIso,
      collectionRunId,
    ).run();
    await finalizeCollection(db, collectionRunId, now);
    await finalizeSearch(db, request.id, now);
    recovered += 1;
  }
  return { recovered, staleCutoff };
}

export {
  ACTIVE_REQUEST_STATUSES,
  BODY_LIMIT_BYTES,
  CACHE_HOURS,
  findReusableRequest,
  GLOBAL_HOURLY_LIMIT,
  REUSABLE_TERMINAL_REQUEST_STATUSES,
  SOURCE_COOLDOWN_MS,
  STALE_REQUEST_MS,
  TERMINAL_REQUEST_STATUSES,
  VISITOR_HOURLY_LIMIT,
  scheduleApprovedSources,
};
