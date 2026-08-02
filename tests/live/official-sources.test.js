import assert from "node:assert/strict";
import test from "node:test";

import { classifyPostdoc } from "../../worker/collectors/classifyPostdoc.js";
import { berkeleyLabAdapter } from "../../worker/collectors/sources/berkeleyLab.js";
import { emblAdapter } from "../../worker/collectors/sources/embl.js";
import { ornlAdapter } from "../../worker/collectors/sources/ornl.js";

test("three reviewed official adapters each extract a valid postdoctoral record", async () => {
  for (const adapter of [ornlAdapter, berkeleyLabAdapter, emblAdapter]) {
    const source = adapter.getSourceDefinition();
    const result = await adapter.collectSourceEntries({}, {
      maxListingPages: 1,
      maxDetailPages: 1,
    });
    assert.equal(result.policyResult.robots, "allowed", source.key);
    assert.ok(result.stats.requests <= 3, source.key);
    const accepted = result.entries.find((entry) => !entry.closed && classifyPostdoc(entry).accepted);
    assert.ok(accepted, `${source.key} did not return a valid postdoctoral record`);
    const normalized = await adapter.normalizeSourceEntry(accepted, new Date());
    assert.equal(adapter.validateSourceEntry(normalized).valid, true, source.key);
    assert.match(normalized.source_url, /^https:/, source.key);
    assert.match(normalized.apply_url, /^https:/, source.key);
  }
});
