import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  approvedSourceSearchFilters,
  approvedSourceSearchKey,
  shouldOfferApprovedSourceSearch,
} from "../../src/lib/approvedSourceSearch.js";
import worker from "../../worker/index.js";
import {
  canonicalSourceSearchQuery,
  cleanupSourceSearchData,
  consumeSourceSearchRateLimit,
  findReusableRequest,
  finalizeSourceSearchRequest,
  handleSourceSearchPost,
  handleSourceSearchStatus,
  hashSourceSearchQuery,
  recoverStaleSourceSearchRequests,
  scheduleApprovedSources,
  sourceRefreshDisposition,
  startApprovedSourceSearch,
  validateSourceSearchPayload,
} from "../../worker/sourceSearch.js";

const NOW = new Date("2026-08-04T12:15:00.000Z");
const VISITOR_ID = "123e4567-e89b-42d3-a456-426614174000";
const REQUEST_ID = "00000000-0000-4000-8000-000000000001";
const RUN_ID = "00000000-0000-4000-8000-000000000002";
const FILTERS = Object.freeze({
  keyword: "quantum",
  country: "",
  research_area: "",
  language: "",
  deadline: "any",
});

function request(body, options = {}) {
  const headers = new Headers(options.headers);
  if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  return new Request("https://postdoc.researchzeal.com/api/source-search", {
    method: options.method ?? "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

test("source-search validation accepts only the bounded filter allow-list", () => {
  assert.equal(validateSourceSearchPayload(FILTERS).valid, true);
  assert.equal(validateSourceSearchPayload({ keyword: "quantum" }).valid, true);
  assert.equal(validateSourceSearchPayload({ ...FILTERS, sourceKey: "ornl-postdoctoral-jobs" }).valid, false);
  assert.equal(validateSourceSearchPayload({ ...FILTERS, url: "https://example.test" }).valid, false);
  assert.equal(validateSourceSearchPayload({ ...FILTERS, keyword: { nested: true } }).valid, false);
  assert.equal(validateSourceSearchPayload({ ...FILTERS, keyword: ["quantum"] }).valid, false);
  assert.equal(validateSourceSearchPayload({ ...FILTERS, keyword: "<b>quantum</b>" }).code, "UNSAFE_FILTER");
  assert.equal(validateSourceSearchPayload({ ...FILTERS, keyword: "https://example.test/job" }).code, "UNSAFE_FILTER");
  assert.equal(validateSourceSearchPayload({ ...FILTERS, keyword: "", deadline: "any" }).code, "EMPTY_FILTER");
  assert.equal(validateSourceSearchPayload({ ...FILTERS, deadline: "tomorrow" }).code, "INVALID_DEADLINE");
  assert.equal(validateSourceSearchPayload({ ...FILTERS, keyword: "x".repeat(151) }).code, "VALUE_TOO_LONG");
});

test("POST endpoint rejects media type, oversized body, invalid JSON, and cross-origin requests", async () => {
  const invalidType = await handleSourceSearchPost(request(FILTERS, {
    headers: { "Content-Type": "text/plain" },
  }), {});
  assert.equal(invalidType.status, 415);

  const oversized = await handleSourceSearchPost(request(JSON.stringify({
    ...FILTERS,
    keyword: "x".repeat(5000),
  })), {});
  assert.equal(oversized.status, 413);

  const invalidJson = await handleSourceSearchPost(request("{"), {});
  assert.equal(invalidJson.status, 400);

  const crossOrigin = await handleSourceSearchPost(request(FILTERS, {
    headers: { Origin: "https://attacker.example" },
  }), {});
  assert.equal(crossOrigin.status, 403);
});

test("Worker routing allows only POST creation and GET status with validated UUIDs", async () => {
  const createGet = await worker.fetch(new Request(
    "https://postdoc.researchzeal.com/api/source-search",
  ), {});
  assert.equal(createGet.status, 405);
  assert.equal(createGet.headers.get("Allow"), "POST");

  const statusPost = await worker.fetch(new Request(
    `https://postdoc.researchzeal.com/api/source-search/${REQUEST_ID}`,
    { method: "POST" },
  ), {});
  assert.equal(statusPost.status, 405);
  assert.equal(statusPost.headers.get("Allow"), "GET");

  const malformed = await worker.fetch(new Request(
    "https://postdoc.researchzeal.com/api/source-search/not-a-uuid",
  ), {});
  assert.equal(malformed.status, 400);
  assert.equal((await malformed.json()).error.code, "INVALID_REQUEST_ID");
});

test("canonical query hashing ignores case and harmless whitespace but separates filters", async () => {
  const first = { ...FILTERS, keyword: "  Quantum   Materials " };
  const second = { ...FILTERS, keyword: "quantum materials" };
  assert.equal(canonicalSourceSearchQuery(first), canonicalSourceSearchQuery(second));
  assert.equal(await hashSourceSearchQuery(first), await hashSourceSearchQuery(second));
  assert.notEqual(
    await hashSourceSearchQuery(first),
    await hashSourceSearchQuery({ ...second, country: "Canada" }),
  );
});

test("existing D1 matches short-circuit before cache, Queue, and rate limit", async () => {
  let rateCalls = 0;
  let scheduleCalls = 0;
  const result = await startApprovedSourceSearch({ DB: {} }, FILTERS, {
    now: NOW,
    visitorHash: "visitor-hash",
    countMatchingJobs: async () => 2,
    consumeSourceSearchRateLimit: async () => { rateCalls += 1; },
    scheduleApprovedSources: async () => { scheduleCalls += 1; },
  });
  assert.deepEqual(result.payload, {
    ok: true,
    status: "results_available",
    refresh_started: false,
    matching_jobs: 2,
  });
  assert.equal(rateCalls, 0);
  assert.equal(scheduleCalls, 0);
});

test("a live 12-hour cache is reused without Queue work or rate consumption", async () => {
  let rateCalls = 0;
  const result = await startApprovedSourceSearch({ DB: {} }, FILTERS, {
    now: NOW,
    visitorHash: "visitor-hash",
    countMatchingJobs: async () => 0,
    hashSourceSearchQuery: async () => "query-hash",
    findReusableRequest: async () => ({
      id: REQUEST_ID,
      status: "no_results",
      matching_jobs: 0,
      cache_expires_at: "2026-08-05T00:15:00.000Z",
    }),
    consumeSourceSearchRateLimit: async () => { rateCalls += 1; },
  });
  assert.equal(result.payload.cached, true);
  assert.equal(result.payload.request_id, REQUEST_ID);
  assert.equal(result.payload.refresh_started, false);
  assert.equal(rateCalls, 0);
});

test("only successful terminal states receive the 12-hour cache and stale active rows are ignored", async () => {
  async function lookup(candidate, date = NOW) {
    let capturedSql = "";
    let capturedValues = [];
    const db = {
      prepare(sql) {
        capturedSql = sql;
        return {
          bind(...values) {
            capturedValues = values;
            return {
              async first() {
                const [, staleCutoff, nowIso] = values;
                if (candidate.query_hash !== values[0]) return null;
                if (["queued", "running"].includes(candidate.status)) {
                  return candidate.requested_at >= staleCutoff ? candidate : null;
                }
                if (["success", "partial", "no_results"].includes(candidate.status)) {
                  return candidate.cache_expires_at > nowIso ? candidate : null;
                }
                return null;
              },
            };
          },
        };
      },
    };
    const result = await findReusableRequest(db, "query-hash", date);
    return { result, capturedSql, capturedValues };
  }

  for (const status of ["success", "partial", "no_results"]) {
    const cached = await lookup({
      id: REQUEST_ID,
      query_hash: "query-hash",
      status,
      requested_at: "2026-08-04T12:00:00.000Z",
      cache_expires_at: "2026-08-05T00:15:00.000Z",
    });
    assert.equal(cached.result.status, status);
    assert.doesNotMatch(cached.capturedSql, /'failed'\)/);
  }
  const failed = await lookup({
    query_hash: "query-hash",
    status: "failed",
    requested_at: "2026-08-04T12:00:00.000Z",
    cache_expires_at: "2026-08-05T00:15:00.000Z",
  });
  assert.equal(failed.result, null);
  const stale = await lookup({
    query_hash: "query-hash",
    status: "running",
    requested_at: "2026-08-04T11:29:59.000Z",
    cache_expires_at: "2026-08-05T00:15:00.000Z",
  });
  assert.equal(stale.result, null);
  assert.equal(stale.capturedValues[1], "2026-08-04T11:30:00.000Z");
});

test("an equivalent active request is reused without a second Queue fan-out", async () => {
  let rateCalls = 0;
  const result = await startApprovedSourceSearch({ DB: {} }, FILTERS, {
    now: NOW,
    visitorHash: "visitor-hash",
    countMatchingJobs: async () => 0,
    hashSourceSearchQuery: async () => "query-hash",
    findReusableRequest: async () => ({
      id: REQUEST_ID,
      status: "running",
      matching_jobs: 0,
      cache_expires_at: "2026-08-05T00:15:00.000Z",
    }),
    consumeSourceSearchRateLimit: async () => { rateCalls += 1; },
  });
  assert.equal(result.payload.status, "running");
  assert.equal(result.payload.cached, false);
  assert.equal(result.payload.refresh_started, false);
  assert.equal(rateCalls, 0);
});

test("an expired cache path creates one request, one run, and one controlled scheduling call", async () => {
  const claims = [];
  const runs = [];
  const scheduled = [];
  const ids = [REQUEST_ID, RUN_ID];
  const result = await startApprovedSourceSearch({ DB: {} }, FILTERS, {
    now: NOW,
    visitorHash: "visitor-hash",
    sources: [{ key: "approved-source" }],
    uuid: () => ids.shift(),
    countMatchingJobs: async () => 0,
    hashSourceSearchQuery: async () => "query-hash",
    findReusableRequest: async () => null,
    consumeSourceSearchRateLimit: async () => ({ allowed: true, retryAfter: 2700 }),
    insertSearchClaim: async (_db, values) => {
      claims.push(values);
      return true;
    },
    insertCollectionRunForSearch: async (_db, values) => runs.push(values),
    scheduleApprovedSources: async (_env, values) => {
      scheduled.push(values);
      return { queued: ["approved-source"], failures: [] };
    },
    loadSourceSearchRequest: async () => ({
      id: REQUEST_ID,
      status: "queued",
      matching_jobs: 0,
      cache_expires_at: "2026-08-05T00:15:00.000Z",
    }),
  });
  assert.equal(claims.length, 1);
  assert.equal(claims[0].requestId, REQUEST_ID);
  assert.equal(claims[0].runId, RUN_ID);
  assert.equal(runs.length, 1);
  assert.equal(scheduled.length, 1);
  assert.equal(result.status, 202);
  assert.equal(result.payload.refresh_started, true);
});

test("simultaneous equivalent searches claim once and consume one rate allowance", async () => {
  let active = null;
  let rateCalls = 0;
  let runCalls = 0;
  let scheduleCalls = 0;
  const options = {
    now: NOW,
    visitorHash: "visitor-hash",
    sources: [{ key: "approved-source" }],
    countMatchingJobs: async () => 0,
    hashSourceSearchQuery: async () => "query-hash",
    findReusableRequest: async () => active,
    insertSearchClaim: async (_db, values) => {
      if (active) return false;
      active = {
        id: values.requestId,
        status: "queued",
        matching_jobs: 0,
        cache_expires_at: values.cacheExpiresAt,
      };
      return true;
    },
    consumeSourceSearchRateLimit: async () => {
      rateCalls += 1;
      return { allowed: true, retryAfter: 2700 };
    },
    insertCollectionRunForSearch: async () => { runCalls += 1; },
    scheduleApprovedSources: async () => {
      scheduleCalls += 1;
      return { queued: ["approved-source"], failures: [] };
    },
    loadSourceSearchRequest: async () => active,
  };
  const [first, second] = await Promise.all([
    startApprovedSourceSearch({ DB: {} }, FILTERS, options),
    startApprovedSourceSearch({ DB: {} }, FILTERS, options),
  ]);
  assert.equal(first.payload.request_id, second.payload.request_id);
  assert.equal(rateCalls, 1);
  assert.equal(runCalls, 1);
  assert.equal(scheduleCalls, 1);
  assert.equal([first, second].filter((result) => result.payload.refresh_started).length, 1);
});

test("a rate-limited claim is released without creating collection work", async () => {
  let released = null;
  let runCalls = 0;
  const result = await startApprovedSourceSearch({ DB: {} }, FILTERS, {
    now: NOW,
    visitorHash: "visitor-hash",
    sources: [{ key: "approved-source" }],
    countMatchingJobs: async () => 0,
    hashSourceSearchQuery: async () => "query-hash",
    findReusableRequest: async () => null,
    insertSearchClaim: async () => true,
    consumeSourceSearchRateLimit: async () => ({ allowed: false, retryAfter: 2700 }),
    releaseRateLimitedClaim: async (_db, requestId) => { released = requestId; },
    insertCollectionRunForSearch: async () => { runCalls += 1; },
  });
  assert.equal(result.status, 429);
  assert.match(released, /^[0-9a-f-]{36}$/i);
  assert.equal(runCalls, 0);
});

class RateStatement {
  constructor(db, sql) {
    this.db = db;
    this.sql = sql;
    this.values = [];
  }

  bind(...values) {
    this.values = values;
    return this;
  }

  async all() {
    assert.match(this.sql, /source_search_rate_limits/);
    assert.match(this.sql, /WITH current_counts/);
    const [visitorHash, windowStart, , visitorMaximum, globalMaximum] = this.values;
    const visitorKey = `visitor:${visitorHash}:${windowStart}`;
    const globalKey = `global:approved-source-search:${windowStart}`;
    const visitorCount = this.db.counts.get(visitorKey) ?? 0;
    const globalCount = this.db.counts.get(globalKey) ?? 0;
    if (visitorCount >= visitorMaximum || globalCount >= globalMaximum) {
      return { results: [] };
    }
    this.db.counts.set(visitorKey, visitorCount + 1);
    this.db.counts.set(globalKey, globalCount + 1);
    return {
      results: [
        { scope_type: "visitor", request_count: visitorCount + 1 },
        { scope_type: "global", request_count: globalCount + 1 },
      ],
    };
  }
}

class RateDb {
  constructor() {
    this.counts = new Map();
  }

  prepare(sql) {
    return new RateStatement(this, sql);
  }

  count(scopeType, scopeKey, date = NOW) {
    const start = new Date(date);
    start.setUTCMinutes(0, 0, 0);
    return this.counts.get(`${scopeType}:${scopeKey}:${start.toISOString()}`) ?? 0;
  }
}

test("visitor and global UTC-hour limits increment all-or-nothing and reset next hour", async () => {
  const db = new RateDb();
  for (let index = 0; index < 3; index += 1) {
    assert.equal((await consumeSourceSearchRateLimit(db, "visitor-hash", NOW)).allowed, true);
  }
  const fourth = await consumeSourceSearchRateLimit(db, "visitor-hash", NOW);
  assert.equal(fourth.allowed, false);
  assert.equal(fourth.retryAfter, 2700);
  assert.equal(db.count("visitor", "visitor-hash"), 3);
  assert.equal(db.count("global", "approved-source-search"), 3);
  for (let index = 0; index < 50; index += 1) {
    assert.equal((await consumeSourceSearchRateLimit(db, "visitor-hash", NOW)).allowed, false);
  }
  assert.equal(db.count("global", "approved-source-search"), 3);
  assert.equal((await consumeSourceSearchRateLimit(
    db,
    "visitor-hash",
    new Date("2026-08-04T13:00:00.000Z"),
  )).allowed, true);

  const globalDb = new RateDb();
  for (let index = 0; index < 20; index += 1) {
    assert.equal((await consumeSourceSearchRateLimit(globalDb, `hash-${index}`, NOW)).allowed, true);
  }
  assert.equal((await consumeSourceSearchRateLimit(globalDb, "hash-20", NOW)).allowed, false);
  assert.equal(globalDb.count("visitor", "hash-20"), 0);
  assert.equal(globalDb.count("global", "approved-source-search"), 20);
  const concurrentDb = new RateDb();
  const concurrent = await Promise.all(Array.from({ length: 30 }, (_, index) =>
    consumeSourceSearchRateLimit(concurrentDb, `concurrent-${index}`, NOW)));
  assert.equal(concurrent.filter((result) => result.allowed).length, 20);
  assert.equal(concurrentDb.count("global", "approved-source-search"), 20);
  assert.equal(
    [...concurrentDb.counts.entries()]
      .filter(([key]) => key.startsWith("visitor:concurrent-"))
      .reduce((total, [, count]) => total + count, 0),
    20,
  );
  assert.equal([...globalDb.counts.keys()].some((key) => key.includes(VISITOR_ID)), false);
});

test("missing visitor cookie is generated securely while an existing result remains rate-limit free", async () => {
  const response = await handleSourceSearchPost(request(FILTERS), { DB: {} }, {
    now: NOW,
    randomUUID: () => VISITOR_ID,
    countMatchingJobs: async () => 1,
  });
  assert.equal(response.status, 200);
  const cookies = response.headers.getSetCookie();
  assert.equal(cookies.length, 1);
  assert.match(cookies[0], /^rz_visitor_id=/);
  assert.match(cookies[0], /HttpOnly/);
  assert.match(cookies[0], /Secure/);
  assert.match(cookies[0], /SameSite=Lax/);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
});

test("status API returns only safe public fields and hides jobs-inserted and query data", async () => {
  const row = {
    id: REQUEST_ID,
    status: "partial",
    expected_sources: 4,
    completed_sources: 4,
    sources_succeeded: 3,
    matching_jobs: 2,
    started_at: "2026-08-04T12:00:00.000Z",
    finished_at: "2026-08-04T12:10:00.000Z",
    cache_expires_at: "2026-08-05T00:10:00.000Z",
    keyword: "private-query",
    jobs_inserted: 99,
    error_summary: "private error",
  };
  const db = {
    prepare() {
      return { bind() { return { async first() { return row; } }; } };
    },
  };
  const response = await handleSourceSearchStatus(REQUEST_ID, { DB: db });
  const payload = await response.json();
  assert.deepEqual(Object.keys(payload).sort(), [
    "cache_expires_at",
    "completed_sources",
    "expected_sources",
    "finished_at",
    "matching_jobs",
    "ok",
    "request_id",
    "sources_succeeded",
    "started_at",
    "status",
  ]);
  assert.equal(JSON.stringify(payload).includes("private-query"), false);
  assert.equal(JSON.stringify(payload).includes("jobs_inserted"), false);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
});

function finalizerDb(requestRow, sourceRuns) {
  const updates = [];
  return {
    updates,
    prepare(sql) {
      return {
        bind(...values) {
          return {
            async first() {
              if (sql.includes("FROM source_search_requests")) return requestRow;
              return null;
            },
            async all() {
              if (sql.includes("FROM source_runs")) return { results: sourceRuns };
              return { results: [] };
            },
            async run() {
              updates.push({ sql, values });
              return { meta: { changes: 1 } };
            },
          };
        },
      };
    },
  };
}

async function finalizedStatus(sourceRuns, matchingJobs) {
  const db = finalizerDb({
    id: REQUEST_ID,
    status: "running",
    collection_run_id: RUN_ID,
    expected_sources: sourceRuns.length,
    keyword: "quantum",
    country: "",
    research_area: "",
    language: "",
    deadline: "any",
  }, sourceRuns);
  const result = await finalizeSourceSearchRequest(db, REQUEST_ID, NOW, {
    countMatchingJobs: async () => matchingJobs,
  });
  return { result, db };
}

test("finalization distinguishes success, partial, no-results, failure, and running", async () => {
  const success = await finalizedStatus([
    { status: "success", mode_used: "html", jobs_inserted: 2 },
    { status: "skipped", mode_used: "recent-cache", jobs_inserted: 0 },
  ], 1);
  assert.equal(success.result.status, "success");
  assert.equal(success.db.updates.at(-1).values[2], "2026-08-05T00:15:00.000Z");
  assert.equal((await finalizedStatus([
    { status: "success", mode_used: "html", jobs_inserted: 3 },
    { status: "failed", mode_used: null, jobs_inserted: 0 },
  ], 1)).result.status, "partial");
  assert.equal((await finalizedStatus([
    { status: "success", mode_used: "rss", jobs_inserted: 4 },
  ], 0)).result.status, "no_results");
  const failed = await finalizedStatus([
    { status: "failed", mode_used: null, jobs_inserted: 9 },
    { status: "skipped", mode_used: "backoff", jobs_inserted: 0 },
  ], 0);
  assert.equal(failed.result.status, "failed");
  assert.equal(failed.db.updates.at(-1).values[2], NOW.toISOString());
  const running = await finalizedStatus([
    { status: "success", mode_used: "rss", jobs_inserted: 1 },
    { status: "queued", mode_used: null, jobs_inserted: 0 },
  ], 99);
  assert.equal(running.result.status, "running");
  assert.equal(running.result.finalized, false);
});

test("incomplete source accounting stays running and counters never exceed expected", async () => {
  const requestRow = {
    id: REQUEST_ID,
    status: "running",
    collection_run_id: RUN_ID,
    expected_sources: 4,
    keyword: "quantum",
    country: "",
    research_area: "",
    language: "",
    deadline: "any",
  };
  const db = finalizerDb(requestRow, [
    { status: "success", mode_used: "rss", jobs_inserted: 2 },
    { status: "success", mode_used: "html", jobs_inserted: 1 },
  ]);
  let countCalls = 0;
  const result = await finalizeSourceSearchRequest(db, REQUEST_ID, NOW, {
    countMatchingJobs: async () => { countCalls += 1; return 10; },
  });
  assert.deepEqual(result, { finalized: false, status: "running" });
  assert.equal(countCalls, 0);
  const update = db.updates.find(({ sql }) => sql.includes("completed_sources"));
  assert.equal(update.values[1], 2);
  assert.equal(update.values[2], 2);
  assert.ok(update.values[1] <= requestRow.expected_sources);
  assert.ok(update.values[2] <= requestRow.expected_sources);
});

test("source cooldown and backoff remain deterministic and policy-safe", () => {
  assert.deepEqual(sourceRefreshDisposition({
    last_success_at: "2026-08-04T11:30:00.000Z",
  }, NOW), { eligible: false, reliable: true, mode: "recent-cache", code: null });
  assert.equal(sourceRefreshDisposition({
    last_success_at: "2026-08-04T10:00:00.000Z",
  }, NOW).eligible, true);
  assert.deepEqual(sourceRefreshDisposition({
    next_allowed_at: "2026-08-04T14:00:00.000Z",
  }, NOW), { eligible: false, reliable: false, mode: "backoff", code: "SOURCE_BACKOFF" });
  assert.equal(sourceRefreshDisposition({
    next_allowed_at: "9999-12-31T23:59:59.000Z",
  }, NOW).mode, "policy-pause");
});

test("on-demand scheduling creates every source run but queues only cooldown-eligible approved sources", async () => {
  const states = [
    { source_key: "recent-source", last_success_at: "2026-08-04T11:30:00.000Z" },
    { source_key: "backoff-source", next_allowed_at: "2026-08-04T14:00:00.000Z" },
    { source_key: "policy-source", next_allowed_at: "9999-12-31T23:59:59.000Z" },
  ];
  const sourceRuns = [];
  const db = {
    prepare(sql) {
      return {
        async all() {
          return sql.includes("FROM collector_sources") ? { results: states } : { results: [] };
        },
        bind(...values) {
          return {
            async all() {
              return sql.includes("FROM collector_sources") ? { results: states } : { results: [] };
            },
            async run() {
              if (sql.includes("INSERT INTO source_runs")) sourceRuns.push(values);
              return { meta: { changes: 1 } };
            },
          };
        },
      };
    },
  };
  const sources = ["eligible-source", "recent-source", "backoff-source", "policy-source"]
    .map((key) => ({
      key,
      name: key,
      type: "html",
      enabled: true,
      modes: { htmlFallback: { listingUrls: [`https://${key}.example/jobs`] } },
    }));
  const sent = [];
  const result = await scheduleApprovedSources({
    DB: db,
    SOURCE_COLLECTION_QUEUE: { async send(body) { sent.push(body); } },
  }, {
    requestId: REQUEST_ID,
    runId: RUN_ID,
    nowDate: NOW,
    now: NOW.toISOString(),
    uuid: () => crypto.randomUUID(),
  }, { sources });
  assert.deepEqual(result.queued, ["eligible-source"]);
  assert.equal(sourceRuns.length, 4);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].version, 2);
  assert.equal(sent[0].sourceKey, "eligible-source");
  assert.equal(JSON.stringify(sent[0]).includes("quantum"), false);
  const byKey = Object.fromEntries(sourceRuns.map((values) => [values[3], {
    mode: values[6],
    status: values[7],
  }]));
  assert.deepEqual(byKey["recent-source"], { mode: "recent-cache", status: "skipped" });
  assert.deepEqual(byKey["backoff-source"], { mode: "backoff", status: "skipped" });
  assert.deepEqual(byKey["policy-source"], { mode: "policy-pause", status: "skipped" });
});

class RecoveryDb {
  constructor(requests, runs = [], collections = []) {
    this.requests = new Map(requests.map((row) => [row.id, { ...row }]));
    this.runs = runs.map((row) => ({ jobs_inserted: 0, ...row }));
    this.collections = new Map(collections.map((row) => [row.id, { ...row }]));
  }

  prepare(sql) {
    const database = this;
    return {
      bind(...values) {
        return {
          async all() {
            if (sql.includes("FROM source_search_requests")) {
              const cutoff = values[0];
              return {
                results: [...database.requests.values()].filter((row) =>
                  ["queued", "running"].includes(row.status)
                  && row.requested_at < cutoff),
              };
            }
            if (sql.includes("FROM source_runs")) {
              return {
                results: database.runs.filter((row) => row.collection_run_id === values[0]),
              };
            }
            return { results: [] };
          },
          async run() {
            if (sql.includes("INSERT INTO collection_runs")) {
              database.collections.set(values[0], {
                id: values[0],
                started_at: values[1],
                status: "running",
                sources_attempted: values[2],
              });
            } else if (sql.includes("UPDATE source_search_requests SET collection_run_id")) {
              const requestRow = database.requests.get(values[2]);
              if (requestRow && !requestRow.collection_run_id) requestRow.collection_run_id = values[0];
            } else if (sql.includes("UPDATE collection_runs SET status = 'running'")) {
              const collection = database.collections.get(values[0]);
              if (collection) collection.status = "running";
            } else if (sql.includes("INSERT OR IGNORE INTO source_runs")) {
              if (!database.runs.some((run) =>
                run.collection_run_id === values[1] && run.source_key === values[3])) {
                database.runs.push({
                  id: values[0],
                  collection_run_id: values[1],
                  message_id: values[2],
                  source_key: values[3],
                  source_name: values[4],
                  source_type: values[5],
                  mode_used: "stale-recovery",
                  status: "failed",
                  scheduled_at: values[6],
                  finished_at: values[7],
                  jobs_inserted: 0,
                  error_code: "STALE_ON_DEMAND_SEARCH",
                });
              }
            } else if (sql.includes("UPDATE source_runs SET status = 'failed'")) {
              for (const run of database.runs) {
                if (run.collection_run_id === values[3]
                  && ["queued", "running"].includes(run.status)) {
                  run.status = "failed";
                  run.finished_at = values[0];
                  run.error_code = "STALE_ON_DEMAND_SEARCH";
                }
              }
            }
            return { meta: { changes: 1 } };
          },
        };
      },
    };
  }

  async batch(statements) {
    const results = [];
    for (const statement of statements) results.push(await statement.run());
    return results;
  }
}

function recoverySources() {
  return Array.from({ length: 4 }, (_, index) => ({
    key: `source-${index + 1}`,
    name: `Source ${index + 1}`,
    type: "fixture",
  }));
}

test("stale recovery accounts for zero or partial fan-out and releases active queries", async () => {
  const zeroRunRequest = {
    id: REQUEST_ID,
    query_hash: "zero-run-query",
    status: "queued",
    collection_run_id: null,
    expected_sources: 4,
    requested_at: "2026-08-04T11:00:00.000Z",
  };
  const partialRequestId = "00000000-0000-4000-8000-000000000010";
  const partialRunId = "00000000-0000-4000-8000-000000000011";
  const partialRequest = {
    id: partialRequestId,
    query_hash: "partial-query",
    status: "running",
    collection_run_id: partialRunId,
    expected_sources: 4,
    requested_at: "2026-08-04T11:10:00.000Z",
  };
  const interruptedRequestId = "00000000-0000-4000-8000-000000000014";
  const interruptedRunId = "00000000-0000-4000-8000-000000000015";
  const db = new RecoveryDb([
    zeroRunRequest,
    partialRequest,
    {
      id: interruptedRequestId,
      query_hash: "interrupted-query",
      status: "queued",
      collection_run_id: interruptedRunId,
      expected_sources: 4,
      requested_at: "2026-08-04T11:20:00.000Z",
    },
    {
      id: "00000000-0000-4000-8000-000000000012",
      query_hash: "recent-query",
      status: "running",
      collection_run_id: "00000000-0000-4000-8000-000000000013",
      expected_sources: 4,
      requested_at: "2026-08-04T11:45:00.000Z",
    },
  ], [
    {
      collection_run_id: partialRunId,
      source_key: "source-1",
      status: "success",
      jobs_inserted: 7,
    },
    {
      collection_run_id: partialRunId,
      source_key: "source-2",
      status: "queued",
      jobs_inserted: 0,
    },
    {
      collection_run_id: interruptedRunId,
      source_key: "source-1",
      status: "queued",
      jobs_inserted: 0,
    },
  ], [
    { id: partialRunId, status: "running" },
    { id: interruptedRunId, status: "running" },
  ]);
  const finalizedCollections = [];
  const finalizedSearches = [];
  const result = await recoverStaleSourceSearchRequests(db, NOW, {
    sources: recoverySources(),
    finalizeCollectionRun: async (_db, runId) => finalizedCollections.push(runId),
    finalizeSourceSearchRequest: async (_db, requestId) => {
      finalizedSearches.push(requestId);
      const requestRow = db.requests.get(requestId);
      const runs = db.runs.filter((run) =>
        run.collection_run_id === requestRow.collection_run_id);
      requestRow.status = runs.some((run) => run.status === "success")
        ? "partial"
        : "failed";
    },
  });
  assert.equal(result.recovered, 3);
  assert.equal(result.staleCutoff, "2026-08-04T11:30:00.000Z");
  const recoveredZero = db.requests.get(REQUEST_ID);
  const zeroRuns = db.runs.filter((run) =>
    run.collection_run_id === recoveredZero.collection_run_id);
  assert.equal(zeroRuns.length, 4);
  assert.ok(zeroRuns.every((run) => run.status === "failed"));
  assert.equal(recoveredZero.status, "failed");
  const partialRuns = db.runs.filter((run) => run.collection_run_id === partialRunId);
  assert.equal(partialRuns.length, 4);
  assert.equal(partialRuns.find((run) => run.source_key === "source-1").status, "success");
  assert.equal(partialRuns.find((run) => run.source_key === "source-1").jobs_inserted, 7);
  assert.equal(partialRuns.find((run) => run.source_key === "source-2").error_code, "STALE_ON_DEMAND_SEARCH");
  assert.equal(db.requests.get(partialRequestId).status, "partial");
  const interruptedRuns = db.runs.filter((run) =>
    run.collection_run_id === interruptedRunId);
  assert.equal(interruptedRuns.length, 4);
  assert.ok(interruptedRuns.every((run) => run.status === "failed"));
  assert.equal(db.requests.get(interruptedRequestId).status, "failed");
  assert.equal(db.requests.get("00000000-0000-4000-8000-000000000012").status, "running");
  assert.equal(finalizedCollections.length, 3);
  assert.deepEqual(
    finalizedSearches.sort(),
    [REQUEST_ID, partialRequestId, interruptedRequestId].sort(),
  );
  assert.equal(
    [...db.requests.values()].filter((row) =>
      row.query_hash === "zero-run-query" && ["queued", "running"].includes(row.status)).length,
    0,
  );
});

test("cleanup is bounded to terminal searches older than seven days and rate windows older than 48 hours", async () => {
  const statements = [];
  const db = {
    prepare(sql) {
      return {
        bind(...values) {
          const statement = {
            sql,
            values,
            async execute() { return { meta: { changes: 1 } }; },
          };
          statements.push(statement);
          return statement;
        },
      };
    },
    async batch(batch) {
      return Promise.all(batch.map((statement) => statement.execute()));
    },
  };
  const result = await cleanupSourceSearchData(db, NOW);
  assert.deepEqual(result, { requestsDeleted: 1, rateWindowsDeleted: 1 });
  assert.match(statements[0].sql, /status IN \('success', 'partial', 'no_results', 'failed'\)/);
  assert.equal(statements[0].values[0], "2026-07-28T12:15:00.000Z");
  assert.equal(statements[1].values[0], "2026-08-02T12:15:00.000Z");
  assert.equal(statements.some((statement) => /DELETE FROM jobs|DELETE FROM source_runs|DELETE FROM site_visitors/.test(statement.sql)), false);
});

test("frontend mapping sends only API filters and offer safety excludes fallback and Saved-only emptiness", () => {
  const uiFilters = {
    keyword: "quantum",
    country: "Canada",
    researchArea: "Physics",
    language: "English",
    sourceLanguage: "French",
    deadline: "no-deadline",
  };
  assert.deepEqual(approvedSourceSearchFilters(uiFilters), {
    keyword: "quantum",
    country: "Canada",
    research_area: "Physics",
    language: "English",
    deadline: "none",
  });
  assert.equal(Object.hasOwn(approvedSourceSearchFilters(uiFilters), "sourceLanguage"), false);
  assert.equal(shouldOfferApprovedSourceSearch({
    dataSource: "d1", resultCount: 0, savedOnly: false, filters: uiFilters,
  }), true);
  assert.equal(shouldOfferApprovedSourceSearch({
    dataSource: "fallback", resultCount: 0, savedOnly: false, filters: uiFilters,
  }), false);
  assert.equal(shouldOfferApprovedSourceSearch({
    dataSource: "d1", resultCount: 0, savedOnly: true, filters: uiFilters,
  }), false);
  assert.equal(shouldOfferApprovedSourceSearch({
    dataSource: "d1", resultCount: 0, savedOnly: false, filters: {},
  }), false);
  assert.equal(approvedSourceSearchKey(uiFilters), approvedSourceSearchKey({
    ...uiFilters, keyword: "  QUANTUM  ",
  }));
});

test("frontend panel is explicit, bounded, resumable, abortable, and accessibly announced", async () => {
  const source = await readFile(
    new URL("../../src/components/ApprovedSourceSearch.js", import.meta.url),
    "utf8",
  );
  assert.match(source, /Search approved sources/);
  assert.match(source, /does not search the entire internet/);
  assert.match(source, /POLL_INTERVAL_MS = 2500/);
  assert.match(source, /POLL_TIMEOUT_MS = 90_000/);
  assert.match(source, /sessionStorage/);
  assert.match(source, /AbortController/);
  assert.match(source, /Stop status checks/);
  assert.match(source, /role="status"/);
  assert.match(source, /aria-live="polite"/);
  assert.match(source, /onRefreshJobs/);
});
