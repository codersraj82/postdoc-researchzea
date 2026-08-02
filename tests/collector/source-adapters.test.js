import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { classifyPostdoc } from "../../worker/collectors/classifyPostdoc.js";
import { createContentHash } from "../../worker/collectors/hashing.js";
import { getEnabledSources, getSourceAdapter } from "../../worker/collectors/sourceRegistry.js";
import { berkeleyLabSource } from "../../worker/collectors/sources/berkeleyLab.js";
import {
  emblAdapter,
  parseEmblDetail,
  parseEmblListing,
} from "../../worker/collectors/sources/embl.js";
import { ornlSource } from "../../worker/collectors/sources/ornl.js";

const root = new URL("../fixtures/sources/", import.meta.url);
const now = new Date("2026-08-02T12:00:00.000Z");
const textFixture = (source, file) => readFile(new URL(`${source}/${file}`, root), "utf8");
const jsonFixture = async (source, file) => JSON.parse(await textFixture(source, file));

test("registry enables exactly iMechanica plus three reviewed adapters", () => {
  const enabled = getEnabledSources();
  assert.deepEqual(
    enabled.map((source) => source.key),
    [
      "imechanica-job-channel",
      "ornl-postdoctoral-jobs",
      "berkeley-lab-postdoctoral",
      "embl-postdoctoral-jobs",
    ],
  );
  for (const source of enabled) {
    const adapter = getSourceAdapter(source.key);
    assert.equal(adapter.getSourceDefinition(), source);
    assert.equal(typeof adapter.collectSourceEntries, "function");
    assert.equal(typeof adapter.normalizeSourceEntry, "function");
    assert.equal(typeof adapter.validateSourceEntry, "function");
  }
});

for (const [fixtureName, source] of [
  ["ornl", ornlSource],
  ["berkeley-lab", berkeleyLabSource],
]) {
  test(`${source.key} listing enforces host, relative URLs, pagination, and duplicate removal`, async () => {
    const listingUrl = source.modes.htmlFallback.listingUrls[0];
    const parsed = source.parseListing(await textFixture(fixtureName, "listing.html"), listingUrl);
    assert.equal(parsed.entries.length, 2);
    assert.equal(parsed.entries.every((entry) => new URL(entry.url).hostname === new URL(listingUrl).hostname), true);
    assert.equal(parsed.pagination.length, 1);
  });

  test(`${source.key} detail fixtures classify valid, non-postdoc, closed, and changed records`, async () => {
    const baseUrl = source.key.startsWith("ornl")
      ? "https://jobs.ornl.gov/job/Oak-Ridge-Fictional-Postdoctoral-Research-Associate-TN-37830/1001/"
      : "https://jobs.lbl.gov/jobs/fictional-postdoctoral-researcher-7001";
    const valid = await source.parseDetail(await textFixture(fixtureName, "detail-valid.html"), baseUrl, "");
    const nonPostdoc = await source.parseDetail(
      await textFixture(fixtureName, "detail-nonpostdoc.html"),
      baseUrl.replace(/1001|7001/, "1002"),
      "",
    );
    const closed = await source.parseDetail(
      await textFixture(fixtureName, "detail-closed.html"),
      baseUrl.replace(/1001|7001/, "1003"),
      "",
    );
    const missing = await source.parseDetail(
      await textFixture(fixtureName, "detail-missing.html"),
      baseUrl.replace(/1001|7001/, "1004"),
      "",
    );
    const changed = await source.parseDetail(
      await textFixture(fixtureName, "detail-changed.html"),
      baseUrl,
      "",
    );
    assert.equal(classifyPostdoc(valid).accepted, true);
    assert.equal(classifyPostdoc(nonPostdoc).accepted, false);
    assert.equal(closed.closed, true);
    assert.equal(missing.deadline, undefined);
    assert.equal(valid.sourceLanguage, "en");
    assert.match(valid.applyUrl, /^https:/);
    const adapter = getSourceAdapter(source.key);
    const normalized = await adapter.normalizeSourceEntry(valid, now);
    const normalizedChanged = await adapter.normalizeSourceEntry(changed, now);
    assert.notEqual(await createContentHash(normalized), await createContentHash(normalizedChanged));
    assert.equal(normalized.institution, source.defaultInstitution);
    assert.equal(normalized.country, "United States");
    assert.equal(normalized.source_language, "en");
    assert.equal(adapter.validateSourceEntry(normalized).valid, true);
  });
}

test("EMBL fixtures preserve API identity, language, direct details, closure, and changes", async () => {
  const listing = parseEmblListing(await jsonFixture("embl", "listing.json"));
  assert.equal(listing.length, 2);
  assert.equal(listing[0].sourceItemId, "JR9001");

  const valid = parseEmblDetail(await jsonFixture("embl", "detail-valid.json"), listing[0]);
  const missing = parseEmblDetail(await jsonFixture("embl", "detail-missing.json"));
  const nonPostdoc = parseEmblDetail(await jsonFixture("embl", "detail-nonpostdoc.json"));
  const closed = parseEmblDetail(await jsonFixture("embl", "detail-closed.json"));
  const changed = parseEmblDetail(await jsonFixture("embl", "detail-changed.json"), listing[0]);
  assert.equal(classifyPostdoc(valid).accepted, true);
  assert.equal(classifyPostdoc(nonPostdoc).accepted, false);
  assert.equal(closed.closed, true);
  assert.equal(missing.deadline, "");
  assert.equal(valid.sourceLanguage, "en");
  assert.equal(valid.applyUrl, valid.link);
  const normalized = await emblAdapter.normalizeSourceEntry(valid, now);
  const normalizedChanged = await emblAdapter.normalizeSourceEntry(changed, now);
  assert.notEqual(await createContentHash(normalized), await createContentHash(normalizedChanged));
  assert.equal(normalized.source_item_id, "JR9001");
  assert.equal(normalized.original_description.includes("fictional postdoctoral"), true);
  assert.equal(emblAdapter.validateSourceEntry(normalized).valid, true);
});
