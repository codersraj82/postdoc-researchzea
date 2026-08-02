import assert from "node:assert/strict";
import test from "node:test";

import { classifyPostdoc } from "../../worker/collectors/classifyPostdoc.js";
import { crawlStaticSource } from "../../worker/collectors/crawlStaticSource.js";
import { fetchSource } from "../../worker/collectors/fetchSource.js";
import { parseRss } from "../../worker/collectors/parseRss.js";
import { imechanicaSource } from "../../worker/collectors/sources/imechanica.js";

test("approved iMechanica RSS and bounded HTML surfaces remain usable", async () => {
  const response = await fetchSource(imechanicaSource);
  assert.equal(response.unchanged, false);
  const rssEntries = parseRss(response.body);
  assert.ok(rssEntries.length > 0);
  assert.ok(rssEntries.some((entry) => classifyPostdoc(entry).accepted));
  assert.ok(rssEntries.some((entry) => /\bph\.?d\.?\b/i.test(entry.title) && !classifyPostdoc(entry).accepted));

  const fallback = await crawlStaticSource(imechanicaSource, {
    maxListingPages: 1,
    maxDetailPages: 2,
  });
  assert.equal(fallback.policyResult.robots, "allowed");
  assert.ok(fallback.stats.requests <= 4);
  assert.ok(fallback.entries.some((entry) => classifyPostdoc(entry).accepted));
});
