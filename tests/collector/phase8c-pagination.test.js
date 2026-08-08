import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  canonicalPublicFilterKey,
  normalizePublicFilters,
  publicFiltersFromSearchParams,
  publicFiltersToSearchParams,
  publicFilterUrl,
} from "../../src/lib/jobFilters.js";
import {
  buildJobsApiUrl,
  fetchJobsPage,
  JOBS_PAGE_SIZE,
  JobsApiError,
} from "../../src/lib/jobsApi.js";
import {
  isCurrentPageRequest,
  mergeJobsById,
  nextOffsetFromPage,
  pageLoadedAnnouncement,
  resultCountCopy,
} from "../../src/lib/paginatedJobs.js";
import { shouldOfferApprovedSourceSearch } from "../../src/lib/approvedSourceSearch.js";
import { searchPublicJobs } from "../../worker/jobSearch.js";
import worker from "../../worker/index.js";

function fixtureJob(number, overrides = {}) {
  const id = `fixture-${String(number).padStart(3, "0")}`;
  return {
    id,
    title: `Postdoctoral position ${number}`,
    institution: number % 2 ? "Example Institute" : "Research Laboratory",
    country: number % 3 ? "Germany" : "Canada",
    city: "Berlin",
    research_area: number % 2 ? "Physics" : "Materials Science",
    language: "English",
    description: `Fixture description ${number}`,
    apply_url: `https://example.edu/apply/${id}`,
    source_url: `https://example.edu/jobs/${id}`,
    deadline: null,
    posted_at: "2026-08-01",
    created_at: "2026-08-01T12:00:00.000Z",
    updated_at: "2026-08-01T12:00:00.000Z",
    employment_type: "Full-time",
    duration: "24 months",
    tags_json: JSON.stringify(["Postdoc", String(number)]),
    is_demo: 0,
    source_language: "en",
    source_key: "imechanica-job-channel",
    source_name: "Fixture source",
    last_verified_at: "2026-08-02T12:00:00.000Z",
    source_count: 1,
    ...overrides,
  };
}

class FixtureStatement {
  constructor(db, sql) {
    this.db = db;
    this.sql = sql;
    this.values = [];
  }

  bind(...values) {
    this.values = values;
    this.db.statements.push(this);
    return this;
  }

  async first() {
    if (this.sql.includes("SELECT 1 AS found")) return { found: 1 };
    return null;
  }
}

class FixtureJobsDb {
  constructor(rows) {
    this.rows = rows;
    this.statements = [];
  }

  prepare(sql) {
    return new FixtureStatement(this, sql);
  }

  filteredRows(statement) {
    let rows = [...this.rows];
    let valueIndex = 0;
    if (statement.sql.includes("LOWER(COALESCE(title")) {
      const keyword = String(statement.values[valueIndex]).replaceAll("%", "").toLowerCase();
      rows = rows.filter((row) => [
        row.title,
        row.institution,
        row.country,
        row.city,
        row.research_area,
        row.language,
        row.description,
        row.tags_json,
      ].join(" ").toLowerCase().includes(keyword));
      valueIndex += 8;
    }
    if (statement.sql.includes("LOWER(TRIM(country)) = ?")) {
      const country = statement.values[valueIndex];
      rows = rows.filter((row) => row.country.toLowerCase() === country);
      valueIndex += 1;
    }
    if (statement.sql.includes("LOWER(TRIM(research_area)) = ?")) {
      const area = statement.values[valueIndex];
      rows = rows.filter((row) => row.research_area.toLowerCase() === area);
      valueIndex += 1;
    }
    if (statement.sql.includes("LOWER(language) LIKE ?")) {
      const language = String(statement.values[valueIndex]).replaceAll("%", "");
      rows = rows.filter((row) => row.language.toLowerCase().includes(language));
    }
    return rows.sort((first, second) => (
      second.posted_at.localeCompare(first.posted_at)
      || second.created_at.localeCompare(first.created_at)
      || second.id.localeCompare(first.id)
    ));
  }

  async batch(statements) {
    const [jobsStatement, countStatement] = statements;
    const rows = this.filteredRows(jobsStatement);
    const limit = jobsStatement.values.at(-2);
    const offset = jobsStatement.values.at(-1);
    const total = this.filteredRows(countStatement).length;
    return [
      { results: rows.slice(offset, offset + limit) },
      { results: [{ total }] },
    ];
  }
}

const sixtyFiveJobs = Array.from({ length: 65 }, (_, index) => fixtureJob(index + 1));

async function jobsApi(url, db = new FixtureJobsDb(sixtyFiveJobs)) {
  const response = await worker.fetch(new Request(`https://postdoc.researchzeal.com${url}`), {
    DB: db,
  });
  return { response, payload: await response.json(), db };
}

test("GET /api/jobs preserves its default contract and safe numeric bounds", async () => {
  const defaultResult = await jobsApi("/api/jobs");
  assert.equal(defaultResult.response.status, 200);
  assert.equal(defaultResult.payload.ok, true);
  assert.equal(defaultResult.payload.source, "d1");
  assert.equal(defaultResult.payload.limit, 50);
  assert.equal(defaultResult.payload.offset, 0);
  assert.equal(defaultResult.payload.count, 50);
  assert.equal(defaultResult.payload.total, 65);
  assert.equal(defaultResult.payload.has_more, true);

  const bounded = await jobsApi("/api/jobs?limit=999&offset=999999");
  assert.equal(bounded.payload.limit, 100);
  assert.equal(bounded.payload.offset, 10000);
  assert.equal(bounded.payload.count, 0);
  assert.equal(bounded.payload.has_more, false);

  const malformed = await jobsApi("/api/jobs?limit=twenty&offset=-1");
  assert.equal(malformed.payload.limit, 50);
  assert.equal(malformed.payload.offset, 0);
});

test("20-row API pages expose truthful totals, boundaries, has_more, and empty final pages", async () => {
  const first = await jobsApi("/api/jobs?limit=20&offset=0");
  const second = await jobsApi("/api/jobs?limit=20&offset=20");
  const third = await jobsApi("/api/jobs?limit=20&offset=40");
  const fourth = await jobsApi("/api/jobs?limit=20&offset=60");
  const empty = await jobsApi("/api/jobs?limit=20&offset=65");
  assert.deepEqual(
    [first.payload.count, second.payload.count, third.payload.count, fourth.payload.count, empty.payload.count],
    [20, 20, 20, 5, 0],
  );
  assert.deepEqual(
    [first.payload.has_more, third.payload.has_more, fourth.payload.has_more, empty.payload.has_more],
    [true, true, false, false],
  );
  assert.equal(first.payload.total, 65);
});

test("identical timestamps use id DESC for stable, gap-free page boundaries", async () => {
  const db = new FixtureJobsDb(sixtyFiveJobs);
  const first = await searchPublicJobs(db, {}, {
    dataset: { condition: "1 = 1", useCollectedJobs: true }, limit: 20, offset: 0,
  });
  const second = await searchPublicJobs(db, {}, {
    dataset: { condition: "1 = 1", useCollectedJobs: true }, limit: 20, offset: 20,
  });
  const repeated = await searchPublicJobs(db, {}, {
    dataset: { condition: "1 = 1", useCollectedJobs: true }, limit: 20, offset: 0,
  });
  assert.deepEqual(first.jobs.map((job) => job.id), repeated.jobs.map((job) => job.id));
  assert.equal(first.jobs[0].id, "fixture-065");
  assert.equal(first.jobs.at(-1).id, "fixture-046");
  assert.equal(second.jobs[0].id, "fixture-045");
  assert.equal(new Set([...first.jobs, ...second.jobs].map((job) => job.id)).size, 40);
  assert.match(db.statements.find((statement) => statement.sql.includes("ORDER BY")).sql,
    /ORDER BY posted_at DESC, created_at DESC, id DESC/);
});

test("server filters share parameter binding and return filtered totals without SQL injection", async () => {
  const filtered = await jobsApi("/api/jobs?limit=20&offset=0&country=Canada&research_area=Materials%20Science");
  assert.equal(filtered.payload.total, 10);
  assert.equal(filtered.payload.count, 10);
  assert.equal(filtered.payload.has_more, false);
  assert.equal(filtered.payload.jobs.every((job) => job.country === "Canada"), true);

  const attack = "%' OR 1=1; DROP TABLE jobs; --";
  const db = new FixtureJobsDb(sixtyFiveJobs);
  await jobsApi(`/api/jobs?keyword=${encodeURIComponent(attack)}`, db);
  const query = db.statements.find((statement) => statement.sql.includes("ORDER BY"));
  assert.equal(query.sql.includes(attack), false);
  assert.match(query.sql, /LIKE \? ESCAPE/);
  assert.equal(query.values.length, 10);
});

test("URL filters normalize, bound, encode, omit defaults, and ignore unsupported parameters", () => {
  const params = new URLSearchParams("keyword=%3Cscript%3Ealert(1)%3C%2Fscript%3E&country=New+Zealand&deadline=tomorrow&offset=40&saved=one");
  const filters = publicFiltersFromSearchParams(params);
  assert.equal(filters.keyword, "<script>alert(1)</script>");
  assert.equal(filters.country, "New Zealand");
  assert.equal(filters.deadline, "any");
  assert.deepEqual([...publicFiltersToSearchParams(filters).keys()], ["keyword", "country"]);
  assert.equal(publicFilterUrl("/", filters), "/?keyword=%3Cscript%3Ealert%281%29%3C%2Fscript%3E&country=New+Zealand");
  assert.equal(publicFilterUrl("/", {}), "/");
  assert.equal(publicFilterUrl("/", { deadline: "any" }).includes("deadline"), false);
  assert.equal(normalizePublicFilters({ keyword: "x".repeat(200) }).keyword.length, 150);
  assert.equal(canonicalPublicFilterKey({ keyword: "  Quantum  " }), canonicalPublicFilterKey({ keyword: "quantum" }));
});

test("jobs API utility requests explicit pages and distinguishes zero success from failures", async () => {
  const calls = [];
  const page = await fetchJobsPage({
    filters: { keyword: "quantum & materials", deadline: "any" },
    signal: new AbortController().signal,
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return new Response(JSON.stringify({
        ok: true, source: "d1", count: 0, total: 0, limit: 20, offset: 0,
        has_more: false, filters: { keyword: "quantum & materials", deadline: "any" }, jobs: [],
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    },
  });
  assert.equal(page.total, 0);
  assert.equal(page.source, "d1");
  assert.equal(calls[0].url, "/api/jobs?limit=20&offset=0&keyword=quantum+%26+materials");
  assert.equal(calls[0].options.cache, "no-store");
  assert.equal(calls[0].options.headers.Accept, "application/json");
  assert.equal(buildJobsApiUrl({ limit: JOBS_PAGE_SIZE, offset: 20 }), "/api/jobs?limit=20&offset=20");

  await assert.rejects(() => fetchJobsPage({
    fetchImpl: async () => new Response("unavailable", { status: 503 }),
  }), JobsApiError);
});

test("page merging appends new IDs, updates duplicates in place, and advances by consumed rows", () => {
  const existing = [{ id: "one", title: "One" }, { id: "two", title: "Old" }];
  const merged = mergeJobsById(existing, [
    { id: "two", title: "Updated", country: "Germany" },
    { id: "three", title: "Three" },
  ]);
  assert.deepEqual(merged.map((job) => job.id), ["one", "two", "three"]);
  assert.deepEqual(merged[1], { id: "two", title: "Updated", country: "Germany" });
  assert.equal(nextOffsetFromPage({ offset: 20, count: 20, jobs: [{ id: "duplicate" }] }), 40);
});

test("result and announcement copy distinguishes partial, complete, singular, zero, and fallback states", () => {
  assert.equal(resultCountCopy({ displayed: 20, total: 145 }), "Showing 20 of 145 matching positions.");
  assert.equal(resultCountCopy({ displayed: 26, total: 26 }), "All 26 matching positions are loaded.");
  assert.equal(resultCountCopy({ displayed: 1, total: 1 }), "1 matching position.");
  assert.equal(resultCountCopy({ displayed: 0, total: 0 }), "");
  assert.equal(resultCountCopy({ displayed: 4, total: 4, source: "fallback" }), "4 sample positions shown.");
  assert.equal(pageLoadedAnnouncement({ added: 20, displayed: 40, total: 145 }),
    "20 more positions loaded. Showing 40 of 145.");
});

test("generation and canonical-query gates reject every stale race scenario", () => {
  const current = {
    currentGeneration: 4,
    requestGeneration: 4,
    currentQueryKey: "biology",
    requestQueryKey: "biology",
  };
  assert.equal(isCurrentPageRequest(current), true);
  assert.equal(isCurrentPageRequest({ ...current, requestGeneration: 3 }), false);
  assert.equal(isCurrentPageRequest({ ...current, requestQueryKey: "physics" }), false);
  assert.equal(isCurrentPageRequest({ ...current, aborted: true }), false);
  // Covers old initial, old Load More, filter change, Back/Forward, refresh, and unmount invalidation.
});

test("approved-source visibility requires a successful settled D1 zero-result first page", () => {
  const base = { dataSource: "d1", total: 0, savedOnly: false, filters: { keyword: "rare" } };
  assert.equal(shouldOfferApprovedSourceSearch(base), true);
  assert.equal(shouldOfferApprovedSourceSearch({ ...base, initialLoading: true }), false);
  assert.equal(shouldOfferApprovedSourceSearch({ ...base, initialError: "unavailable" }), false);
  assert.equal(shouldOfferApprovedSourceSearch({ ...base, dataSource: "fallback" }), false);
  assert.equal(shouldOfferApprovedSourceSearch({ ...base, savedOnly: true }), false);
  assert.equal(shouldOfferApprovedSourceSearch({ ...base, loadingMore: true }), false);
  assert.equal(shouldOfferApprovedSourceSearch({ ...base, total: 1 }), false);
});

test("frontend wiring preserves accessible controls, local persistence, cancellation, and URL-only public filters", async () => {
  const [search, results] = await Promise.all([
    readFile(new URL("../../src/components/PostdocSearch.js", import.meta.url), "utf8"),
    readFile(new URL("../../src/components/JobResults.js", import.meta.url), "utf8"),
  ]);
  assert.match(search, /new AbortController\(\)/);
  assert.match(search, /loadMoreControllerRef\.current\?\.abort\(\)/);
  assert.match(search, /rz_compare_job_ids_v1/);
  assert.match(search, /rz_saved_job_ids_v1/);
  assert.match(search, /rz_job_preferences_v1/);
  assert.match(search, /router\[method\]\(nextUrl, \{ scroll: false \}\)/);
  assert.doesNotMatch(search, /params\.set\(["']offset/);
  assert.match(results, /disabled=\{loadingMore\}/);
  assert.match(results, /aria-busy/);
  assert.match(results, /aria-live="polite"/);
  assert.match(results, /Retry loading more/);
  assert.match(results, /Load more positions/);
});
