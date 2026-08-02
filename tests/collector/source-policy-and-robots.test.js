import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { runApprovedBrowserAction } from "../../worker/collectors/browserSourceAdapter.js";
import { discoverJobLinks } from "../../worker/collectors/discoverJobLinks.js";
import { fetchStaticPage } from "../../worker/collectors/fetchStaticPage.js";
import {
  isRobotsAllowed,
  loadRobotsPolicy,
  parseRobotsTxt,
} from "../../worker/collectors/robots.js";
import {
  canonicalDetailUrl,
  contentSignalAllowsSearch,
  isApprovedDetailCandidate,
  isApprovedListingUrl,
} from "../../worker/collectors/sourcePolicy.js";
import { imechanicaSource } from "../../worker/collectors/sources/imechanica.js";

const htmlRoot = new URL("../fixtures/html/", import.meta.url);
const robotsRoot = new URL("../fixtures/robots/", import.meta.url);
const readHtml = (name) => readFile(new URL(name, htmlRoot), "utf8");
const readRobots = (name) => readFile(new URL(name, robotsRoot), "utf8");

test("registry uses the corrected canonical RSS URL and removes the obsolete path", () => {
  assert.equal(
    imechanicaSource.modes.rss.url,
    "https://imechanica.org/taxonomy/term/73/feed",
  );
  assert.doesNotMatch(JSON.stringify(imechanicaSource), /taxonomy\/term\/73\/0\/feed/);
  assert.deepEqual(imechanicaSource.modes.rss.allowedHosts, ["imechanica.org"]);
});

test("source policy enforces listing, same-host detail, and path restrictions", () => {
  assert.equal(isApprovedListingUrl("https://imechanica.org/taxonomy/term/73?page=1", imechanicaSource), true);
  assert.equal(isApprovedListingUrl("https://imechanica.org/taxonomy/term/74", imechanicaSource), false);
  assert.equal(isApprovedDetailCandidate("/fictional-postdoc", imechanicaSource, imechanicaSource.modes.htmlFallback.listingUrls[0]), true);
  assert.equal(isApprovedDetailCandidate("/user/42", imechanicaSource, imechanicaSource.modes.htmlFallback.listingUrls[0]), false);
  assert.equal(isApprovedDetailCandidate("https://evil.example/postdoc", imechanicaSource), false);
  assert.equal(
    canonicalDetailUrl("/fictional-postdoc#comments", imechanicaSource, "https://imechanica.org/taxonomy/term/73"),
    "https://imechanica.org/fictional-postdoc",
  );
});

test("redirects to an unapproved hostname are rejected", async () => {
  await assert.rejects(
    fetchStaticPage(
      "https://imechanica.org/taxonomy/term/73",
      imechanicaSource.modes.htmlFallback,
      {
        fetchImpl: async () => new Response(null, {
          status: 302,
          headers: { location: "https://evil.example/listing" },
        }),
      },
    ),
    /approved HTTPS host/i,
  );
});

test("Content-Signal search=no is rejected", () => {
  assert.equal(contentSignalAllowsSearch("ai-train=no, search=no"), false);
  assert.equal(contentSignalAllowsSearch("search=yes"), true);
  assert.equal(contentSignalAllowsSearch(null), true);
});

test("robots parser uses ResearchZealBot rules before wildcard rules", async () => {
  const specific = parseRobotsTxt(await readRobots("specific-agent.txt"));
  assert.equal(specific.evaluatedGroup, "researchzealbot");
  assert.equal(isRobotsAllowed(specific, "https://imechanica.org/taxonomy/term/73"), true);
  assert.equal(isRobotsAllowed(specific, "https://imechanica.org/unapproved"), false);

  const wildcard = parseRobotsTxt(await readRobots("wildcard-agent.txt"));
  assert.equal(wildcard.evaluatedGroup, "*");
  assert.equal(isRobotsAllowed(wildcard, "https://imechanica.org/user/4"), false);
});

test("robots allow, disallow, allow-exception, detail, and crawl-delay rules work", async () => {
  assert.equal(isRobotsAllowed(parseRobotsTxt(await readRobots("allow-all.txt")), "https://imechanica.org/anything"), true);
  assert.equal(isRobotsAllowed(parseRobotsTxt(await readRobots("disallow-listing.txt")), "https://imechanica.org/taxonomy/term/73"), false);
  assert.equal(isRobotsAllowed(parseRobotsTxt(await readRobots("disallow-detail.txt")), "https://imechanica.org/fictional-private-postdoc"), false);
  assert.equal(isRobotsAllowed(parseRobotsTxt(await readRobots("allow-exception.txt")), "https://imechanica.org/taxonomy/term/73"), true);
  assert.equal(parseRobotsTxt(await readRobots("crawl-delay.txt")).crawlDelaySeconds, 2);
});

test("robots load fails closed when the response is missing", async () => {
  await assert.rejects(
    loadRobotsPolicy(imechanicaSource, {
      fetchImpl: async () => new Response("missing", { status: 404 }),
    }),
    /could not be evaluated/i,
  );
});

test("listing discovery keeps only visible same-host entry headings", async () => {
  const result = await discoverJobLinks(
    await readHtml("listing-mixed.html"),
    "https://imechanica.org/taxonomy/term/73",
    imechanicaSource,
  );
  assert.deepEqual(
    result.entries.map((entry) => entry.url),
    [
      "https://imechanica.org/fictional-postdoctoral-materials",
      "https://imechanica.org/fictional-phd-mechanics",
    ],
  );
  assert.deepEqual(result.pagination, ["https://imechanica.org/taxonomy/term/73?page=1"]);
  assert.equal(result.entries.some((entry) => entry.url.includes("login")), false);
  assert.equal(result.entries.some((entry) => entry.url.includes("evil.example")), false);
});

test("Browser Run adapter remains disabled without an approved browser mode", async () => {
  let calls = 0;
  await assert.rejects(
    runApprovedBrowserAction(imechanicaSource, "https://imechanica.org/fictional-postdoc", async () => {
      calls += 1;
    }),
    /No approved Browser Run mode/i,
  );
  assert.equal(calls, 0);
});
