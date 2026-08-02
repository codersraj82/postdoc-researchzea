import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { classifyPostdoc } from "../../worker/collectors/classifyPostdoc.js";
import { collectSourceEntries } from "../../worker/collectors/collectSourceEntries.js";
import { crawlStaticSource } from "../../worker/collectors/crawlStaticSource.js";
import { fetchStaticPage } from "../../worker/collectors/fetchStaticPage.js";
import { normalizeJob } from "../../worker/collectors/normalizeJob.js";
import { imechanicaSource } from "../../worker/collectors/sources/imechanica.js";
import {
  mergeCollectedJob,
  storeCollectedJobs,
} from "../../worker/collectors/storeCollectedJobs.js";

const htmlRoot = new URL("../fixtures/html/", import.meta.url);
const rssRoot = new URL("../fixtures/rss/", import.meta.url);
const robotsRoot = new URL("../fixtures/robots/", import.meta.url);
const fixture = (root, name) => readFile(new URL(name, root), "utf8");
const now = new Date("2026-08-02T12:00:00.000Z");

function htmlResponse(body, finalUrl, contentSignal = null) {
  return { body, finalUrl, contentSignal, status: 200 };
}

async function fallbackMocks() {
  const listing = await fixture(htmlRoot, "listing-mixed.html");
  const postdoc = await fixture(htmlRoot, "detail-postdoc.html");
  const phd = await fixture(htmlRoot, "detail-phd.html");
  const robots = await fixture(robotsRoot, "allow-all.txt");
  let htmlCalls = 0;
  return {
    get htmlCalls() { return htmlCalls; },
    fetchImpl: async (url) => {
      if (url.endsWith("/feed")) return new Response("missing", { status: 404 });
      if (url.endsWith("/robots.txt")) {
        return new Response(robots, { headers: { "content-type": "text/plain" } });
      }
      throw new Error(`Unexpected fetch ${url}`);
    },
    fetchPage: async (url) => {
      htmlCalls += 1;
      if (url.includes("taxonomy/term/73")) return htmlResponse(listing, url);
      if (url.includes("fictional-postdoctoral-materials")) return htmlResponse(postdoc, url);
      if (url.includes("fictional-phd-mechanics")) return htmlResponse(phd, url);
      throw new Error(`Unexpected page ${url}`);
    },
  };
}

test("RSS 404 activates the bounded HTML fallback", async () => {
  const mocks = await fallbackMocks();
  const result = await collectSourceEntries(imechanicaSource, {}, {
    fetchImpl: mocks.fetchImpl,
    fetchPage: mocks.fetchPage,
    sleep: async () => {},
    maxListingPages: 1,
    maxDetailPages: 2,
  });
  assert.equal(result.mode, "html-fallback");
  assert.equal(result.fallbackReason, "SOURCE_HTTP_ERROR");
  assert.equal(result.entries.length, 2);
  assert.equal(result.entries.filter((entry) => classifyPostdoc(entry).accepted).length, 1);
  assert.equal(mocks.htmlCalls, 3);
});

test("successful RSS does not crawl HTML unnecessarily", async () => {
  const rss = await fixture(rssRoot, "one-item.xml");
  let htmlCalls = 0;
  const result = await collectSourceEntries(imechanicaSource, {}, {
    fetchImpl: async () => new Response(rss, {
      headers: { "content-type": "application/rss+xml" },
    }),
    fetchPage: async () => {
      htmlCalls += 1;
      throw new Error("HTML should not run");
    },
  });
  assert.equal(result.mode, "rss");
  assert.equal(result.entries.length, 1);
  assert.equal(htmlCalls, 0);
});

test("invalid XML activates HTML fallback without weakening XML validation", async () => {
  const mocks = await fallbackMocks();
  const fetchImpl = async (url, options) => {
    if (url.endsWith("/feed")) {
      return new Response("<rss><broken>", { headers: { "content-type": "application/rss+xml" } });
    }
    return mocks.fetchImpl(url, options);
  };
  const result = await collectSourceEntries(imechanicaSource, {}, {
    fetchImpl,
    fetchPage: mocks.fetchPage,
    sleep: async () => {},
    maxListingPages: 1,
    maxDetailPages: 1,
  });
  assert.equal(result.mode, "html-fallback");
  assert.equal(result.fallbackReason, "Error");
});

test("pagination, detail count, and total request budget remain bounded", async () => {
  const robots = await fixture(robotsRoot, "allow-all.txt");
  const first = await fixture(htmlRoot, "listing-mixed.html");
  const second = await fixture(htmlRoot, "listing-page-2.html");
  const detail = await fixture(htmlRoot, "detail-postdoc.html");
  const requested = [];
  const result = await crawlStaticSource(imechanicaSource, {
    fetchImpl: async () => new Response(robots, { headers: { "content-type": "text/plain" } }),
    fetchPage: async (url) => {
      requested.push(url);
      if (url.includes("page=1")) return htmlResponse(second, url);
      if (url.includes("taxonomy/term/73")) return htmlResponse(first, url);
      return htmlResponse(detail, url);
    },
    sleep: async () => {},
    maxListingPages: 2,
    maxDetailPages: 1,
  });
  assert.equal(result.stats.listingPages, 2);
  assert.equal(result.stats.detailPages, 1);
  assert.equal(result.stats.requests, 4);
  assert.equal(requested.length, 3);
});

test("Content-Signal search=no stops HTML fallback", async () => {
  const robots = await fixture(robotsRoot, "allow-all.txt");
  await assert.rejects(
    crawlStaticSource(imechanicaSource, {
      fetchImpl: async () => new Response(robots, { headers: { "content-type": "text/plain" } }),
      fetchPage: async (url) => htmlResponse("<html></html>", url, "search=no"),
      sleep: async () => {},
      maxListingPages: 1,
      maxDetailPages: 0,
    }),
    /prohibits search indexing/i,
  );
});

test("HTML response size and timeout limits are enforced", async () => {
  const policy = imechanicaSource.modes.htmlFallback;
  await assert.rejects(
    fetchStaticPage(policy.listingUrls[0], policy, {
      fetchImpl: async () => new Response("small", {
        headers: {
          "content-type": "text/html",
          "content-length": String(policy.maximumBytes + 1),
        },
      }),
    }),
    /size limit/i,
  );

  const hangingFetch = (_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
  });
  await assert.rejects(
    fetchStaticPage(policy.listingUrls[0], policy, {
      fetchImpl: hangingFetch,
      timeoutMs: 5,
    }),
    /timed out/i,
  );
});

test("failure of RSS and HTML fallback is isolated as a sanitized hybrid failure", async () => {
  await assert.rejects(
    collectSourceEntries(imechanicaSource, {}, {
      fetchImpl: async (url) => new Response("missing", {
        status: url.endsWith("/feed") ? 404 : 503,
      }),
      sleep: async () => {},
    }),
    /Approved RSS and HTML fallback failed/i,
  );
});

function memoryRepository(seedRows = []) {
  const rows = new Map(seedRows.map((row) => [row.id, { ...row }]));
  const collected = () => [...rows.values()].filter((row) => row.origin_type === "collected" && Number(row.is_demo) === 0);
  return {
    rows,
    async findByIdentity(sourceKey, itemId) {
      return collected().find((row) => row.source_key === sourceKey && row.source_item_id === itemId) ?? null;
    },
    async findByCanonicalUrl(sourceKey, canonicalUrl) {
      return collected().find((row) => row.source_key === sourceKey && row.canonical_url === canonicalUrl) ?? null;
    },
    async findBySourceUrl(sourceUrl) {
      return collected().find((row) => row.source_url === sourceUrl) ?? null;
    },
    async insert(job) {
      rows.set(job.id, { ...job });
    },
    async touch(id, job) {
      rows.set(id, { ...rows.get(id), last_seen_at: job.last_seen_at, last_verified_at: job.last_verified_at });
    },
    async update(id, job) {
      rows.set(id, { ...rows.get(id), ...job, id, first_seen_at: rows.get(id).first_seen_at });
    },
  };
}

async function normalizedObservation(url, sourceType, description, title = "Postdoc in Mechanics") {
  return normalizeJob({
    title,
    descriptionHtml: description,
    link: url,
    guid: `${sourceType}-guid`,
    pubDate: "2026-07-01",
    categories: [],
    sourceType,
  }, imechanicaSource, now);
}

test("RSS first then HTML updates one canonical record", async () => {
  const repository = memoryRepository();
  const rss = await normalizedObservation("https://imechanica.org/shared-postdoc", "rss", "A postdoctoral opening.");
  const html = await normalizedObservation("https://imechanica.org/shared-postdoc", "html", "Current postdoctoral detail-page content at Example Institute.");
  assert.deepEqual(await storeCollectedJobs([rss], repository), { inserted: 1, updated: 0, unchanged: 0, duplicatesMerged: 0 });
  const result = await storeCollectedJobs([html], repository);
  assert.equal(result.inserted, 0);
  assert.equal(repository.rows.size, 1);
  assert.match([...repository.rows.values()][0].description, /Current postdoctoral detail-page/);
});

test("HTML first then RSS remains one record and preserves HTML content", async () => {
  const repository = memoryRepository();
  const html = await normalizedObservation("https://imechanica.org/shared-postdoc", "html", "Detailed postdoctoral HTML content.");
  const rss = await normalizedObservation("https://imechanica.org/shared-postdoc", "rss", "Short postdoctoral RSS excerpt.");
  await storeCollectedJobs([html], repository);
  const result = await storeCollectedJobs([rss], repository);
  assert.equal(result.inserted, 0);
  assert.equal(repository.rows.size, 1);
  assert.match([...repository.rows.values()][0].description, /Detailed postdoctoral HTML/);
});

test("same title with different canonical URLs stays separate", async () => {
  const repository = memoryRepository();
  const first = await normalizedObservation("https://imechanica.org/postdoc-one", "html", "First postdoctoral opening.");
  const second = await normalizedObservation("https://imechanica.org/postdoc-two", "html", "Second postdoctoral opening.");
  const result = await storeCollectedJobs([first, second], repository);
  assert.deepEqual(result, { inserted: 2, updated: 0, unchanged: 0, duplicatesMerged: 0 });
  assert.equal(repository.rows.size, 2);
});

test("changed HTML updates the same ID while seed/demo rows remain untouched", async () => {
  const demo = { id: "demo-job-001", origin_type: "seed", is_demo: 1, title: "Demo unchanged" };
  const repository = memoryRepository([demo]);
  const original = await normalizedObservation("https://imechanica.org/changed-postdoc", "html", "Original postdoctoral detail.");
  const changed = await normalizedObservation("https://imechanica.org/changed-postdoc", "html", "Changed postdoctoral detail.");
  await storeCollectedJobs([original], repository);
  const originalId = original.id;
  const result = await storeCollectedJobs([changed], repository);
  assert.equal(result.updated, 1);
  assert.ok(repository.rows.has(originalId));
  assert.equal(repository.rows.get("demo-job-001").title, "Demo unchanged");
});

test("weak HTML enrichment cannot overwrite stronger RSS metadata", async () => {
  const url = "https://imechanica.org/enrichment-postdoc";
  const rss = {
    ...await normalizedObservation(url, "rss", "A detailed postdoctoral RSS opening."),
    institution: "McGill University",
    country: "Canada",
    deadline: "2026-09-30",
    duration: "1 year",
    apply_url: "https://jobs.mcgill.ca/vacancies/42",
    first_seen_at: "2026-07-01T00:00:00.000Z",
  };
  const html = {
    ...await normalizedObservation(url, "html", "A current postdoctoral HTML opening."),
    institution: "See original source",
    country: "Not specified",
    deadline: null,
    duration: "",
    apply_url: "https://imechanica.org/taxonomy/term/73",
    first_seen_at: "2026-08-02T12:00:00.000Z",
  };
  const merged = await mergeCollectedJob(rss, html);
  assert.equal(merged.id, rss.id);
  assert.equal(merged.first_seen_at, rss.first_seen_at);
  assert.equal(merged.institution, "McGill University");
  assert.equal(merged.country, "Canada");
  assert.equal(merged.deadline, "2026-09-30");
  assert.equal(merged.duration, "1 year");
  assert.equal(merged.apply_url, "https://jobs.mcgill.ca/vacancies/42");
});

test("weak RSS enrichment cannot overwrite stronger HTML metadata", async () => {
  const url = "https://imechanica.org/reverse-enrichment-postdoc";
  const html = {
    ...await normalizedObservation(url, "html", "Detailed postdoctoral HTML content."),
    institution: "Aarhus University",
    country: "Denmark",
    deadline: "2026-08-03",
    duration: "2 years",
    apply_url: "https://au.career.example/recruitment/vacancy/42",
  };
  const rss = {
    ...await normalizedObservation(url, "rss", "Short postdoctoral RSS excerpt."),
    institution: "See original source",
    country: "Not specified",
    deadline: null,
    duration: "",
    apply_url: url,
  };
  const merged = await mergeCollectedJob(html, rss);
  assert.equal(merged.institution, "Aarhus University");
  assert.equal(merged.country, "Denmark");
  assert.equal(merged.deadline, "2026-08-03");
  assert.equal(merged.duration, "2 years");
  assert.equal(merged.apply_url, "https://au.career.example/recruitment/vacancy/42");
  assert.match(merged.description, /Detailed postdoctoral HTML/);
});
