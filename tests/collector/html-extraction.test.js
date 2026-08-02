import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { classifyPostdoc } from "../../worker/collectors/classifyPostdoc.js";
import { extractJobPostingJsonLd } from "../../worker/collectors/extractJobPostingJsonLd.js";
import { extractPageSignals } from "../../worker/collectors/extractPageSignals.js";
import { normalizeJob } from "../../worker/collectors/normalizeJob.js";
import { imechanicaSource } from "../../worker/collectors/sources/imechanica.js";
import { validateCollectedJob } from "../../worker/collectors/validateCollectedJob.js";

const fixtureRoot = new URL("../fixtures/html/", import.meta.url);
const readFixture = (name) => readFile(new URL(name, fixtureRoot), "utf8");
const now = new Date("2026-08-02T12:00:00.000Z");

test("direct JobPosting JSON-LD is extracted and validated", async () => {
  const postings = await extractJobPostingJsonLd(await readFixture("detail-jsonld.html"));
  assert.equal(postings.length, 1);
  assert.equal(postings[0].title, "Postdoctoral Research Associate in Robotics");
  assert.equal(postings[0].institution, "Example Robotics Institute");
  assert.equal(postings[0].country, "Canada");
  assert.equal(postings[0].city, "Toronto");
});

test("JobPosting inside @graph is extracted", async () => {
  const postings = await extractJobPostingJsonLd(await readFixture("detail-jsonld-graph.html"));
  assert.equal(postings.length, 1);
  assert.equal(postings[0].title, "Postdoctoral Fellow in Biology");
});

test("invalid JSON-LD is ignored and visible content remains usable", async () => {
  const html = await readFixture("detail-invalid-jsonld.html");
  assert.deepEqual(await extractJobPostingJsonLd(html), []);
  const entry = await extractPageSignals(html, "https://imechanica.org/fictional-physics-postdoc");
  assert.equal(entry.title, "Postdoc in Physics");
  assert.equal(classifyPostdoc(entry).accepted, true);
});

test("visible detail extraction removes unrelated page boilerplate", async () => {
  const entry = await extractPageSignals(
    await readFixture("detail-postdoc.html"),
    "https://imechanica.org/fictional-postdoctoral-materials",
  );
  assert.equal(entry.title, "Postdoctoral Fellow in Materials Engineering");
  assert.match(entry.descriptionHtml, /Example Institute/);
  assert.doesNotMatch(entry.descriptionHtml, /Unrelated footer/);
  assert.equal(entry.applyUrl, "https://careers.example.edu/jobs/41");
});

test("HTML postdoc normalizes with explicit deadline, location, duration, and safe URL", async () => {
  const entry = await extractPageSignals(
    await readFixture("detail-postdoc.html"),
    "https://imechanica.org/fictional-postdoctoral-materials",
  );
  const job = await normalizeJob(entry, imechanicaSource, now);
  assert.equal(classifyPostdoc(entry).accepted, true);
  assert.equal(job.deadline, "2026-09-30");
  assert.equal(job.duration, "24 months");
  assert.equal(job.country, "United Kingdom");
  assert.equal(job.city, "Bristol");
  assert.equal(job.source_type, "html");
  assert.equal(validateCollectedJob(job).valid, true);
});

test("PhD-only and faculty-only HTML details are rejected", async () => {
  const phd = await extractPageSignals(
    await readFixture("detail-phd.html"),
    "https://imechanica.org/fictional-phd-mechanics",
  );
  const faculty = await extractPageSignals(
    await readFixture("detail-faculty.html"),
    "https://imechanica.org/fictional-faculty",
  );
  assert.equal(classifyPostdoc(phd).accepted, false);
  assert.equal(classifyPostdoc(faculty).accepted, false);
});

test("deadline remains null when absent and unsafe application falls back to source", async () => {
  const noDeadline = await extractPageSignals(
    await readFixture("detail-no-deadline.html"),
    "https://imechanica.org/fictional-chemistry-postdoc",
  );
  const noDeadlineJob = await normalizeJob(noDeadline, imechanicaSource, now);
  assert.equal(noDeadlineJob.deadline, null);

  const unsafe = await extractPageSignals(
    await readFixture("detail-unsafe-application.html"),
    "https://imechanica.org/fictional-math-postdoc",
  );
  const unsafeJob = await normalizeJob(unsafe, imechanicaSource, now);
  assert.equal(unsafeJob.apply_url, unsafeJob.source_url);
});

test("HTML description remains bounded and missing institution uses truthful default", async () => {
  const oversized = await extractPageSignals(
    await readFixture("detail-oversized.html"),
    "https://imechanica.org/fictional-long-postdoc",
  );
  const oversizedJob = await normalizeJob(oversized, imechanicaSource, now);
  assert.ok(oversizedJob.description.length <= 1200);

  const missing = await extractPageSignals(
    await readFixture("detail-missing-institution.html"),
    "https://imechanica.org/fictional-environment-postdoc",
  );
  const missingJob = await normalizeJob(missing, imechanicaSource, now);
  assert.equal(missingJob.institution, "See original source");
});

test("expired HTML vacancy retains its factual deadline for lifecycle expiry", async () => {
  const entry = await extractPageSignals(
    await readFixture("detail-expired.html"),
    "https://imechanica.org/fictional-expired-postdoc",
  );
  const job = await normalizeJob(entry, imechanicaSource, now);
  assert.equal(job.deadline, "2026-01-31");
});

test("RSS and HTML observations use the same canonical source identity", async () => {
  const rss = await normalizeJob({
    title: "Postdoc in Mathematics",
    descriptionHtml: "A postdoctoral mathematics opening.",
    link: "https://www.imechanica.org/fictional-shared-postdoc#details",
    guid: "legacy-guid",
    pubDate: "2026-07-01",
    categories: [],
    sourceType: "rss",
  }, imechanicaSource, now);
  const htmlEntry = await extractPageSignals(
    await readFixture("detail-same-as-rss.html"),
    "https://imechanica.org/fictional-shared-postdoc",
  );
  const html = await normalizeJob(htmlEntry, imechanicaSource, now);
  assert.equal(rss.canonical_url, html.canonical_url);
  assert.equal(rss.source_item_id, html.source_item_id);
  assert.equal(rss.id, html.id);
});
