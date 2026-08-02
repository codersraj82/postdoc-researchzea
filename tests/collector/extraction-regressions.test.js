import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { extractPageSignals } from "../../worker/collectors/extractPageSignals.js";
import { appendTextChunk } from "../../worker/collectors/htmlRuntime.js";
import {
  extractDeadline,
  extractDuration,
  extractInstitution,
  extractLocation,
  normalizeJob,
} from "../../worker/collectors/normalizeJob.js";
import {
  extractMainContentAnchors,
  isUsableApplicationUrl,
  selectApplicationUrl,
} from "../../worker/collectors/selectApplicationUrl.js";
import { imechanicaSource } from "../../worker/collectors/sources/imechanica.js";

const fixtureRoot = new URL("../fixtures/html/", import.meta.url);
const readFixture = (name) => readFile(new URL(name, fixtureRoot), "utf8");
const listingUrl = imechanicaSource.modes.htmlFallback.listingUrls[0];
const now = new Date("2026-08-02T12:00:00.000Z");

async function applicationFromFixture(name, sourceUrl) {
  const html = await readFixture(name);
  const entry = await extractPageSignals(html, sourceUrl, { listingUrl });
  return { entry, html };
}

test("application selection ranks explicit and official links and rejects listing links", async () => {
  const oxford = await applicationFromFixture(
    "detail-application-oxford.html",
    "https://imechanica.org/fictional-oxford-postdoc",
  );
  assert.equal(oxford.entry.applyUrl, "https://eng.ox.ac.uk/jobs/job-detail?vacancyID=12345");
  assert.equal(oxford.entry.applicationSelectionReason, "official_vacancy_link");

  const recruitment = await applicationFromFixture(
    "detail-application-recruitment.html",
    "https://imechanica.org/fictional-aarhus-postdoc",
  );
  assert.equal(recruitment.entry.applyUrl, "https://au.career.example/recruitment/vacancy/42");
  assert.equal(recruitment.entry.applicationSelectionReason, "explicit_apply_link");
  assert.notEqual(recruitment.entry.applyUrl, listingUrl);
});

test("email-only applications fall back to the individual source detail", async () => {
  const sourceUrl = "https://imechanica.org/fictional-email-only-postdoc";
  const { entry } = await applicationFromFixture("detail-application-email-only.html", sourceUrl);
  assert.equal(entry.applyUrl, sourceUrl);
  assert.equal(entry.applicationSelectionReason, "source_detail_fallback");
});

test("only a main-content application link survives unsafe and boilerplate alternatives", async () => {
  const sourceUrl = "https://imechanica.org/fictional-filtered-postdoc";
  const { entry, html } = await applicationFromFixture("detail-application-filtering.html", sourceUrl);
  assert.equal(entry.applyUrl, "https://careers.example.edu/vacancies/77");
  const anchors = extractMainContentAnchors(html);
  assert.ok(anchors.every((anchor) => anchor.isMainContent && !anchor.isExcludedRegion));
  assert.ok(anchors.some((anchor) => anchor.href.includes("taxonomy")));
  assert.equal(isUsableApplicationUrl(listingUrl, { sourceUrl, listingUrl }), false);
  assert.equal(isUsableApplicationUrl("javascript:alert(1)", { sourceUrl, listingUrl }), false);
});

test("application ranking rejects taxonomy, pagination, navigation, profiles, assets, and context-free sites", () => {
  const sourceUrl = "https://imechanica.org/fictional-multiple-links";
  const anchors = [
    { href: listingUrl, text: "Jobs", isMainContent: true },
    { href: `${listingUrl}?page=2`, text: "Next", isMainContent: true },
    { href: "/user/4", text: "Profile", isMainContent: true },
    { href: "https://lab.example/", text: "Laboratory website", isMainContent: true },
    { href: "https://example.edu/ad.pdf", text: "Advertisement", isMainContent: true },
    { href: "https://careers.example.edu/jobs/9", text: "Apply now", isMainContent: false, isExcludedRegion: true },
    { href: "https://careers.example.edu/jobs/10", text: "Submit application", isMainContent: true },
  ];
  assert.deepEqual(selectApplicationUrl({ anchors, sourceUrl, listingUrl, mainText: "" }), {
    url: "https://careers.example.edu/jobs/10",
    selectionReason: "explicit_apply_link",
  });
});

test("HTML text chunks preserve word boundaries and punctuation", () => {
  const target = {};
  const chunks = [
    { text: "Postdoctoral", lastInTextNode: true },
    { text: "Research", lastInTextNode: true },
    { text: "Associate", lastInTextNode: true },
    { text: " at ", lastInTextNode: true },
    { text: "Johns Hopkins", lastInTextNode: true },
    { text: "University", lastInTextNode: true },
    { text: ",", lastInTextNode: true },
    { text: "Baltimore", lastInTextNode: true },
  ];
  for (const chunk of chunks) appendTextChunk(target, "body", chunk);
  assert.equal(target.body, "Postdoctoral Research Associate at Johns Hopkins University, Baltimore");

  const splitNode = {};
  appendTextChunk(splitNode, "body", { text: "Postdoc", lastInTextNode: false });
  appendTextChunk(splitNode, "body", { text: "toral", lastInTextNode: true });
  assert.equal(splitNode.body, "Postdoctoral");
});

test("institution extraction is bounded, normalized, and handles adjacent-element text", async () => {
  assert.equal(extractInstitution("A fellow at McGill University."), "McGill University");
  assert.equal(extractInstitution("at the University of Oxford to work on a grant"), "University of Oxford");
  assert.equal(extractInstitution("at Johns HopkinsUniversity seeks researchers"), "Johns Hopkins University");
  assert.equal(extractInstitution("Department of Food Science at Aarhus University, invites applications"), "Aarhus University");
  assert.equal(extractInstitution("Postdoc at UCL - University College London"), "UCL – University College London");

  const { entry } = await applicationFromFixture(
    "detail-application-filtering.html",
    "https://imechanica.org/fictional-filtered-postdoc",
  );
  const job = await normalizeJob(entry, imechanicaSource, now);
  assert.equal(job.institution, "Johns Hopkins University");
});

test("country extraction uses explicit evidence and only approved mappings", () => {
  assert.deepEqual(extractLocation("The position is in Aarhus, Denmark."), { country: "Denmark", city: "Aarhus" });
  assert.deepEqual(extractLocation("Work will be based in Baltimore, Maryland."), { country: "United States", city: "Baltimore" });
  assert.equal(extractLocation("Work in central Oxford.", { institution: "University of Oxford" }).country, "United Kingdom");
  assert.equal(extractLocation("Research opening.", { applyUrl: "https://jobs.mcgill.ca/vacancy/2" }).country, "Canada");
  assert.deepEqual(extractLocation("An opening at Arbitrary University."), { country: "Not specified", city: "" });
});

test("deadline extraction stays tied to deadline wording", () => {
  assert.equal(extractDeadline("All applications must be received no later than 3 August 2026", now), "2026-08-03");
  assert.equal(extractDeadline("Post closing date: 8 June 2026", now), "2026-06-08");
  assert.equal(extractDeadline("Start date: 3 August 2026", now), null);
  assert.equal(extractDeadline("Review begins immediately; project date 2026-08-03", now), null);
});

test("duration extraction normalizes explicit position terms and ignores extension-only wording", () => {
  assert.equal(extractDuration("The role is initially available for one year."), "1 year");
  assert.equal(extractDuration("A one-year Postdoctoral Research Associate position is available."), "1 year");
  assert.equal(extractDuration("This is a two-year position."), "2 years");
  assert.equal(extractDuration("Duration: 24 months."), "24 months");
  assert.equal(extractDuration("The position is fixed-term for 18 months."), "18 months");
  assert.equal(extractDuration("There may be an extension for one year."), "");
});

test("UCL metadata fixture keeps the deadline distinct from start date and chooses the vacancy", async () => {
  const sourceUrl = "https://imechanica.org/fictional-ucl-postdoc";
  const { entry } = await applicationFromFixture("detail-metadata-ucl.html", sourceUrl);
  const job = await normalizeJob(entry, imechanicaSource, now);
  assert.equal(job.institution, "UCL – University College London");
  assert.equal(job.country, "United Kingdom");
  assert.equal(job.deadline, "2026-06-08");
  assert.equal(job.duration, "24 months");
  assert.equal(job.apply_url, "https://www.ucl.ac.uk/work-at-ucl/search-ucl-jobs/details?jobId=42");
});
