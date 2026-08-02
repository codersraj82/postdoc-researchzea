import assert from "node:assert/strict";
import test from "node:test";

import {
  areEquivalentJobUrls,
  formatJobLocation,
  isDemonstrationJob,
  normalizeComparableUrl,
} from "../../src/lib/jobPresentation.js";
import { normalizeDemoFlag } from "../../worker/collectors/publicJobs.js";

test("D1 demo flags normalize to strict public booleans", () => {
  assert.equal(normalizeDemoFlag(false), false);
  assert.equal(normalizeDemoFlag(0), false);
  assert.equal(normalizeDemoFlag(true), true);
  assert.equal(normalizeDemoFlag(1), true);
  assert.equal(normalizeDemoFlag(undefined), false);
  assert.equal(normalizeDemoFlag("1"), false);
});

test("cards identify demonstrations only from a strict true boolean", () => {
  assert.equal(isDemonstrationJob({ is_demo: true }), true);
  assert.equal(isDemonstrationJob({ is_demo: false }), false);
  assert.equal(isDemonstrationJob({ is_demo: 1 }), false);
  assert.equal(isDemonstrationJob({ is_demo: 0 }), false);
  assert.equal(isDemonstrationJob({}), false);
});

test("location formatting omits empty values and separators", () => {
  assert.equal(formatJobLocation({ city: "Berlin", country: "Germany", language: "English" }), "Berlin, Germany · English");
  assert.equal(formatJobLocation({ city: "", country: "Canada", language: "English" }), "Canada · English");
  assert.equal(formatJobLocation({ city: "Oxford", country: "", language: "English" }), "Oxford · English");
  assert.equal(formatJobLocation({ city: "", country: "", language: "English" }), "English");
  assert.equal(formatJobLocation({ city: " ", country: " ", language: " " }), "");
});

test("application URL comparison ignores fragments, host case, and safe trailing slashes", () => {
  assert.equal(
    normalizeComparableUrl("https://EXAMPLE.edu/jobs/42/#apply"),
    "https://example.edu/jobs/42",
  );
  assert.equal(
    areEquivalentJobUrls(
      "https://EXAMPLE.edu/jobs/42/#apply",
      "https://example.edu/jobs/42",
    ),
    true,
  );
  assert.equal(
    areEquivalentJobUrls(
      "https://example.edu/jobs/42?language=en",
      "https://example.edu/jobs/42?language=fr",
    ),
    false,
  );
  assert.equal(areEquivalentJobUrls("", ""), false);
});
