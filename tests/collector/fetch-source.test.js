import assert from "node:assert/strict";
import test from "node:test";

import { DEFAULT_MAX_BYTES, fetchSource } from "../../worker/collectors/fetchSource.js";
import { imechanicaSource } from "../../worker/collectors/sources/imechanica.js";

test("conditional fetch treats HTTP 304 as successful and unchanged", async () => {
  let requestHeaders;
  const result = await fetchSource(
    imechanicaSource,
    { etag: '"abc"', last_modified: "Wed, 01 Jul 2026 10:00:00 GMT" },
    {
      fetchImpl: async (_url, options) => {
        requestHeaders = options.headers;
        return new Response(null, { status: 304 });
      },
    },
  );
  assert.equal(result.unchanged, true);
  assert.equal(requestHeaders["If-None-Match"], '"abc"');
  assert.ok(requestHeaders["If-Modified-Since"]);
});

test("fetch timeout aborts and retries only once", async () => {
  let attempts = 0;
  const fetchImpl = (_url, options) => new Promise((_resolve, reject) => {
    attempts += 1;
    options.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
  });
  await assert.rejects(
    fetchSource(imechanicaSource, {}, { fetchImpl, timeoutMs: 5, sleep: async () => {} }),
    /timed out/i,
  );
  assert.equal(attempts, 2);
});

test("fetch rejects an oversized response before parsing", async () => {
  const fetchImpl = async () => new Response("small", {
    headers: {
      "content-type": "application/rss+xml",
      "content-length": String(DEFAULT_MAX_BYTES + 1),
    },
  });
  await assert.rejects(fetchSource(imechanicaSource, {}, { fetchImpl }), /size limit/i);
});

test("fetch rejects unapproved source URLs and unsupported content types", async () => {
  await assert.rejects(
    fetchSource({
      ...imechanicaSource,
      modes: {
        ...imechanicaSource.modes,
        rss: {
          ...imechanicaSource.modes.rss,
          url: "https://unapproved.example/feed",
        },
      },
    }),
    /approved registry/i,
  );
  await assert.rejects(
    fetchSource(imechanicaSource, {}, {
      fetchImpl: async () => new Response("<rss/>", { headers: { "content-type": "text/html" } }),
    }),
    /content type/i,
  );
});

test("fetch accepts application/rss+xml from the corrected source", async () => {
  const result = await fetchSource(imechanicaSource, {}, {
    fetchImpl: async () => new Response("<rss version=\"2.0\"><channel/></rss>", {
      headers: { "content-type": "application/rss+xml; charset=utf-8" },
    }),
  });
  assert.equal(result.status, 200);
  assert.match(result.body, /<rss/);
});
