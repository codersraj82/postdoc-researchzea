import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { classifyPostdoc } from "../../worker/collectors/classifyPostdoc.js";
import { parseRss } from "../../worker/collectors/parseRss.js";

const fixtureRoot = new URL("../fixtures/rss/", import.meta.url);

async function fixture(name) {
  return readFile(new URL(name, fixtureRoot), "utf8");
}

test("RSS parser handles empty, one-item, and multi-item feeds", async () => {
  assert.equal(parseRss(await fixture("empty-feed.xml")).length, 0);
  assert.equal(parseRss(await fixture("one-item.xml")).length, 1);
  assert.equal(parseRss(await fixture("multi-item.xml")).length, 2);
});

test("RSS parser normalizes string, arrays, categories, and missing fields", async () => {
  const [entry] = parseRss(await fixture("valid-postdoc.xml"));
  assert.equal(entry.guid, "fictional-1");
  assert.deepEqual(entry.categories, ["Mechanics"]);
  assert.match(entry.descriptionHtml, /University of Example/);

  const [malformed] = parseRss(await fixture("malformed-item.xml"));
  assert.equal(malformed.link, "");
  assert.equal(malformed.pubDate, "");
});

test("RSS parser rejects invalid XML and prohibited declarations", () => {
  assert.throws(() => parseRss("<rss><channel>"), /invalid/i);
  assert.throws(
    () => parseRss('<!DOCTYPE rss [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><rss/>'),
    /prohibited/i,
  );
});

test("classification accepts explicit postdoc wording", async () => {
  const [entry] = parseRss(await fixture("valid-postdoc.xml"));
  const result = classifyPostdoc(entry);
  assert.equal(result.accepted, true);
  assert.ok(result.matchedTerms.includes("postdoctoral"));
});

test("classification rejects PhD-only and faculty-only items", async () => {
  const [phd] = parseRss(await fixture("phd-only.xml"));
  const [faculty] = parseRss(await fixture("faculty-only.xml"));
  assert.equal(classifyPostdoc(phd).accepted, false);
  assert.equal(classifyPostdoc(faculty).accepted, false);
});

test("classification allows a truthful combined postdoc and PhD listing", () => {
  const result = classifyPostdoc({
    title: "Postdoc and PhD openings in mechanics",
    descriptionHtml: "The postdoctoral opening is a separate funded role.",
  });
  assert.equal(result.accepted, true);
});

test("classification rejects explicitly negated postdoc wording", () => {
  const result = classifyPostdoc({
    title: "No postdoc positions available",
    descriptionHtml: "This notice is informational only.",
  });
  assert.equal(result.accepted, false);
});
