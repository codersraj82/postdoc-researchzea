import { discoverJobLinks } from "./discoverJobLinks.js";
import { extractPageSignals } from "./extractPageSignals.js";
import { fetchStaticPage } from "./fetchStaticPage.js";
import {
  createRequestPacer,
  isRobotsAllowed,
  loadRobotsPolicy,
} from "./robots.js";
import {
  contentSignalAllowsSearch,
  getHtmlPolicy,
} from "./sourcePolicy.js";
import { SourcePolicyError } from "./urlSafety.js";

const POSTDOC_TITLE = /\b(postdoc|post-doc|postdoctoral|post-doctoral|post doctoral)\b/i;

export async function crawlStaticSource(source, options = {}) {
  const policy = getHtmlPolicy(source);
  const maximumListingPages = Math.min(
    options.maxListingPages ?? policy.maxListingPages,
    policy.maxListingPages,
  );
  const maximumDetailPages = Math.min(
    options.maxDetailPages ?? policy.maxDetailPages,
    policy.maxDetailPages,
  );
  const fetchPage = options.fetchPage ?? fetchStaticPage;
  const pace = createRequestPacer(
    policy.minimumDelayMs,
    options.sleep,
  );
  let requests = 0;
  const requestBudget = 1 + maximumListingPages + maximumDetailPages;

  await pace();
  const robots = await loadRobotsPolicy(source, {
    fetchImpl: options.fetchImpl,
  });
  requests += 1;
  const policyResult = {
    robots: "allowed",
    evaluatedGroup: robots.evaluatedGroup,
    crawlDelayMs: robots.crawlDelayMs,
    contentSignal: "allowed",
  };
  const delayedPace = createRequestPacer(robots.crawlDelayMs, options.sleep);
  await delayedPace();

  const listingQueue = [...policy.listingUrls];
  const visitedListings = new Set();
  const discovered = new Map();
  while (listingQueue.length && visitedListings.size < maximumListingPages) {
    const listingUrl = listingQueue.shift();
    if (visitedListings.has(listingUrl)) continue;
    if (!isRobotsAllowed(robots, listingUrl)) {
      throw new SourcePolicyError("Robots policy disallows the approved listing page.", "ROBOTS_DISALLOWED");
    }
    if (requests >= requestBudget) throw new SourcePolicyError("HTML request budget exceeded.", "HTML_BUDGET_EXCEEDED");
    await delayedPace();
    const response = await fetchPage(listingUrl, policy, {
      fetchImpl: options.fetchImpl,
      kind: "html",
    });
    requests += 1;
    if (!contentSignalAllowsSearch(response.contentSignal)) {
      throw new SourcePolicyError("Source policy prohibits search indexing.", "CONTENT_SIGNAL_SEARCH_NO");
    }
    visitedListings.add(response.finalUrl);
    const listing = await discoverJobLinks(response.body, response.finalUrl, source);
    for (const entry of listing.entries) {
      if (!discovered.has(entry.url)) discovered.set(entry.url, entry);
    }
    for (const pageUrl of listing.pagination) {
      if (listingQueue.length + visitedListings.size >= maximumListingPages) break;
      if (!visitedListings.has(pageUrl) && !listingQueue.includes(pageUrl)) listingQueue.push(pageUrl);
    }
  }

  const candidates = [...discovered.values()]
    .sort((left, right) => Number(POSTDOC_TITLE.test(right.title)) - Number(POSTDOC_TITLE.test(left.title)))
    .slice(0, maximumDetailPages);
  const entries = [];
  const skipped = [];
  for (const candidate of candidates) {
    if (!isRobotsAllowed(robots, candidate.url)) {
      skipped.push({ url: candidate.url, reason: "robots" });
      continue;
    }
    if (requests >= requestBudget) break;
    try {
      await delayedPace();
      const response = await fetchPage(candidate.url, policy, {
        fetchImpl: options.fetchImpl,
        kind: "html",
      });
      requests += 1;
      if (!contentSignalAllowsSearch(response.contentSignal)) {
        skipped.push({ url: candidate.url, reason: "content-signal" });
        continue;
      }
      const entry = await extractPageSignals(response.body, response.finalUrl, {
        listingUrl: policy.listingUrls[0],
      });
      entries.push({
        ...entry,
        title: entry.title || candidate.title,
        pubDate: entry.pubDate || candidate.submittedAt,
      });
    } catch (error) {
      skipped.push({
        url: candidate.url,
        reason: error?.code ?? "detail-failed",
      });
    }
  }

  return {
    entries,
    mode: "html-fallback",
    policyResult,
    stats: {
      requests,
      listingPages: visitedListings.size,
      detailPages: entries.length,
      linksDiscovered: discovered.size,
      skipped: skipped.length,
    },
  };
}
