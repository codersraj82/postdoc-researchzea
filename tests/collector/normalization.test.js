import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { createContentHash } from "../../worker/collectors/hashing.js";
import {
  classifyResearchArea,
  createSourceItemId,
  extractDeadline,
  extractDuration,
  normalizeJob,
} from "../../worker/collectors/normalizeJob.js";
import { parseRss } from "../../worker/collectors/parseRss.js";
import { imechanicaSource } from "../../worker/collectors/sources/imechanica.js";
import {
  extractMainContentAnchors,
  selectApplicationUrl,
} from "../../worker/collectors/selectApplicationUrl.js";
import {
  canonicalizeUrl,
  htmlToPlainText,
  safeHttpUrl,
} from "../../worker/collectors/text.js";
import { validateCollectedJob } from "../../worker/collectors/validateCollectedJob.js";

const fixtureRoot = new URL("../fixtures/rss/", import.meta.url);
const now = new Date("2026-08-02T12:00:00.000Z");

async function entry(name) {
  const xml = await readFile(new URL(name, fixtureRoot), "utf8");
  return parseRss(xml)[0];
}

test("HTML conversion removes executable and embedded markup and limits text", async () => {
  const unsafe = await entry("unsafe-description.xml");
  const text = htmlToPlainText(unsafe.descriptionHtml);
  assert.equal(text, "A short postdoc summary & safe text. Apply");
  assert.ok(text.length <= 1200);
  assert.doesNotMatch(text, /alert|display|secret|pixel/i);
});

test("URL helpers accept HTTP(S), reject unsafe schemes, and strip tracking", () => {
  assert.ok(safeHttpUrl("https://example.edu/jobs/1"));
  assert.equal(safeHttpUrl("javascript:alert(1)"), null);
  assert.equal(safeHttpUrl("mailto:jobs@example.edu"), null);
  assert.equal(
    canonicalizeUrl("https://example.edu/job?utm_source=rss&id=4#apply"),
    "https://example.edu/job?id=4",
  );
});

test("application URL is explicit when reliable and otherwise uses source", async () => {
  const apply = await entry("postdoc-apply.xml");
  assert.equal(
    selectApplicationUrl({
      anchors: extractMainContentAnchors(apply.descriptionHtml),
      sourceUrl: apply.link,
      listingUrl: imechanicaSource.modes.htmlFallback.listingUrls[0],
      mainText: htmlToPlainText(apply.descriptionHtml),
    }).url,
    "https://careers.example.edu/jobs/42",
  );
  const fallback = await entry("postdoc-source-fallback.xml");
  assert.equal(selectApplicationUrl({
    anchors: extractMainContentAnchors(fallback.descriptionHtml),
    sourceUrl: fallback.link,
    listingUrl: imechanicaSource.modes.htmlFallback.listingUrls[0],
    mainText: htmlToPlainText(fallback.descriptionHtml),
  }).url, fallback.link);
});

test("deadline extraction requires a deadline phrase", () => {
  assert.equal(extractDeadline("Applications close: September 30, 2026", now), "2026-09-30");
  assert.equal(extractDeadline("The seminar is September 30, 2026", now), null);
  assert.equal(extractDeadline("Deadline: February 30, 2026", now), null);
});

test("duration and research mapping are deterministic", () => {
  assert.equal(extractDuration("The term is 24 months."), "24 months");
  assert.equal(extractDuration("This is a two-year position."), "2 years");
  assert.equal(classifyResearchArea("deep learning and computer vision"), "Artificial Intelligence");
  assert.equal(classifyResearchArea("an unusual interdisciplinary topic"), "Other / Multidisciplinary");
});

test("normalization creates a valid collected record without inventing fields", async () => {
  const job = await normalizeJob(await entry("postdoc-deadline.xml"), imechanicaSource, now);
  assert.equal(job.deadline, "2026-09-30");
  assert.equal(job.duration, "24 months");
  assert.equal(job.institution, "See original source");
  assert.equal(job.country, "Not specified");
  assert.equal(job.is_demo, 0);
  assert.equal(job.origin_type, "collected");
  assert.equal(job.collection_state, "active");
  assert.equal(validateCollectedJob(job).valid, true);
});

test("malformed normalized items fail validation", async () => {
  const job = await normalizeJob(await entry("malformed-item.xml"), imechanicaSource, now);
  assert.equal(validateCollectedJob(job).valid, false);
});

test("source item fallback and content hashes are stable and content-sensitive", async () => {
  const item = { title: "Postdoc", pubDate: "2026-01-01" };
  assert.equal(await createSourceItemId(item, null), await createSourceItemId(item, null));
  const base = { title: "Postdoc", country: "Canada", tags: ["Physics"] };
  assert.equal(await createContentHash(base), await createContentHash({ ...base }));
  assert.notEqual(await createContentHash(base), await createContentHash({ ...base, country: "Japan" }));
});

test("changed fixture retains source identity while changing content hash", async () => {
  const original = await normalizeJob(await entry("duplicate-items.xml"), imechanicaSource, now);
  const changed = await normalizeJob(await entry("changed-item.xml"), imechanicaSource, now);
  assert.equal(original.source_item_id, changed.source_item_id);
  assert.notEqual(original.content_hash, changed.content_hash);
});
