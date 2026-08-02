import assert from "node:assert/strict";
import test from "node:test";

import { classifyPostdoc } from "../../worker/collectors/classifyPostdoc.js";
import { imechanicaAdapter } from "../../worker/collectors/sources/imechanica.js";

test("approved iMechanica adapter remains usable with one bounded live collection", async () => {
  const result = await imechanicaAdapter.collectSourceEntries({}, {
    maxListingPages: 1,
    maxDetailPages: 1,
  });
  assert.ok(result.entries.length > 0);
  assert.ok(result.entries.some((entry) => classifyPostdoc(entry).accepted));
});
