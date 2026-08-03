import assert from "node:assert/strict";
import test from "node:test";

import {
  addComparisonJob,
  clearComparisonJobs,
  getComparisonRows,
  reconcileStoredJobIds,
  removeComparisonJob,
} from "../../src/lib/comparison.js";
import { filterJobs } from "../../src/lib/filterJobs.js";
import { getLanguageLabel } from "../../src/lib/languages.js";
import { calculatePreferenceMatch } from "../../src/lib/preferenceMatch.js";

const now = new Date("2026-08-03T12:00:00.000Z");
const completeJob = {
  id: "job-1",
  title: "Materials microscopy researcher",
  institution: "Example University",
  city: "Berlin",
  country: "Germany",
  research_area: "Materials science",
  source_language: "en",
  description: "Electron microscopy for renewable materials.",
  tags: ["microscopy"],
  posted_at: "2026-08-01",
  deadline: "2026-08-20",
  duration: "24 months",
  employment_type: "Full-time",
  source_name: "Example careers",
  official_source: true,
  source_count: 2,
  last_verified_at: "2026-08-03",
  source_url: "https://example.edu/jobs/1",
  apply_url: "https://apply.example.edu/jobs/1?campaign=postdoc",
};

test("comparison selection adds, de-duplicates, caps, removes, and clears IDs", () => {
  assert.deepEqual(addComparisonJob([], "one"), { ids: ["one"], status: "added" });
  assert.deepEqual(addComparisonJob(["one"], "one"), { ids: ["one"], status: "duplicate" });
  assert.deepEqual(addComparisonJob(["one", "two", "three"], "four"), {
    ids: ["one", "two", "three"],
    status: "limit",
  });
  assert.deepEqual(removeComparisonJob(["one", "two"], "one"), ["two"]);
  assert.deepEqual(clearComparisonJobs(), []);
});

test("stored selections are reconciled against current jobs", () => {
  assert.deepEqual(
    reconcileStoredJobIds(["missing", "one", "one"], [{ id: "one" }, { id: "two" }]),
    ["one"],
  );
});

test("comparison rows use Not stated and preserve truthful safe actions", () => {
  const rows = getComparisonRows({
    id: "sparse",
    title: "Sparse job",
    source_url: "https://EXAMPLE.com/job/#details",
    apply_url: "https://example.com/job",
  });
  assert.equal(rows.find((row) => row.key === "city").value, "Not stated");
  assert.equal(rows.find((row) => row.key === "official").value, "Not stated");
  assert.equal(rows.find((row) => row.key === "apply-action").value, "View application details");
  assert.equal(rows.find((row) => row.key === "apply-action").href, "https://example.com/job");

  const unsafeRows = getComparisonRows({ source_url: "javascript:alert(1)" });
  assert.equal(unsafeRows.find((row) => row.key === "source-action").href, null);
});

test("preference keyword weighting awards up to 40 points", () => {
  const result = calculatePreferenceMatch(completeJob, {
    researchKeywords: "materials microscopy missing",
  }, now);
  assert.equal(result.criteria.find((item) => item.key === "research").points, 27);
});

test("country and source-language preference weighting is deterministic", () => {
  const countryOnly = calculatePreferenceMatch(completeJob, { countries: "Germany" }, now);
  assert.equal(countryOnly.criteria.find((item) => item.key === "country").points, 20);
  const combined = calculatePreferenceMatch(completeJob, {
    countries: "Germany",
    sourceLanguages: "English",
  }, now);
  assert.equal(combined.criteria.find((item) => item.key === "country").points, 12);
  assert.equal(combined.criteria.find((item) => item.key === "source-language").points, 8);
});

test("deadline preference awards 15 only for a qualifying stated deadline", () => {
  const match = calculatePreferenceMatch(completeJob, { deadline: "30" }, now);
  assert.equal(match.criteria.find((item) => item.key === "deadline").points, 15);
  const missing = calculatePreferenceMatch({ ...completeJob, deadline: null }, { deadline: "30" }, now);
  assert.equal(missing.criteria.find((item) => item.key === "deadline").points, 0);
});

test("official and direct-application preferences share the 15-point allocation", () => {
  const result = calculatePreferenceMatch(completeJob, {
    requireDirectApplication: true,
    preferOfficialSource: true,
  }, now);
  assert.equal(result.criteria.find((item) => item.key === "direct-application").points, 8);
  assert.equal(result.criteria.find((item) => item.key === "official-source").points, 7);
});

test("listing completeness awards only stated, qualifying facts", () => {
  const complete = calculatePreferenceMatch(completeJob, { minimumDurationMonths: "12" }, now);
  assert.equal(complete.criteria.find((item) => item.key === "completeness").points, 10);
  const sparse = calculatePreferenceMatch({ id: "sparse" }, { minimumDurationMonths: "12" }, now);
  assert.equal(sparse.criteria.find((item) => item.key === "completeness").points, 0);
  assert.deepEqual(sparse.reasons, []);
});

test("preference reasons correspond only to awarded points and empty preferences have no score", () => {
  const mismatch = calculatePreferenceMatch(completeJob, { countries: "Canada" }, now);
  assert.equal(mismatch.reasons.some((reason) => reason.includes("country")), false);
  assert.equal(calculatePreferenceMatch(completeJob, {}, now), null);
});

test("source languages display, filter, and handle unknown values", () => {
  assert.equal(getLanguageLabel("en"), "English");
  assert.equal(getLanguageLabel(""), "Unknown");
  const jobs = [completeJob, { ...completeJob, id: "job-2", source_language: "fr" }];
  assert.deepEqual(
    filterJobs(jobs, { sourceLanguage: "English" }, now).map((job) => job.id),
    ["job-1"],
  );
});

test("existing keyword and country filters remain compatible", () => {
  const jobs = [completeJob, { ...completeJob, id: "job-2", country: "Canada" }];
  assert.deepEqual(
    filterJobs(jobs, { keyword: "microscopy", country: "Germany" }, now)
      .map((job) => job.id),
    ["job-1"],
  );
});
