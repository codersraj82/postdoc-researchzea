import { extractPageSignals } from "./extractPageSignals.js";
import { fetchStaticPage } from "./fetchStaticPage.js";
import { createRequestPacer, isRobotsAllowed, loadRobotsPolicy } from "./robots.js";
import { contentSignalAllowsSearch, getHtmlPolicy } from "./sourcePolicy.js";
import { htmlToPlainText } from "./text.js";
import { canonicalizeApprovedUrl, SourcePolicyError } from "./urlSafety.js";

function attribute(tag, name) {
  const match = String(tag).match(
    new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"),
  );
  return match?.[1] ?? match?.[2] ?? match?.[3] ?? "";
}

function anchors(html) {
  return [...String(html).matchAll(/<a\b[^>]*>[\s\S]*?<\/a\s*>/gi)].map((match) => ({
    href: attribute(match[0], "href"),
    text: htmlToPlainText(match[0], 400),
  }));
}

function matchesAny(pathname, patterns = []) {
  return patterns.some((pattern) => pattern.test(pathname));
}

export function parseStaticPortalListing(html, listingUrl, source) {
  const policy = getHtmlPolicy(source);
  const entries = new Map();
  const pagination = new Set();

  for (const link of anchors(html)) {
    const canonical = canonicalizeApprovedUrl(link.href, listingUrl, policy.allowedHosts);
    if (!canonical) continue;
    const url = new URL(canonical);
    if (matchesAny(url.pathname, policy.allowedDetailPatterns)) {
      const title = htmlToPlainText(link.text, 300);
      if (title && !entries.has(canonical)) entries.set(canonical, { url: canonical, title });
      continue;
    }
    if (
      url.pathname.replace(/\/+$/, "") === new URL(policy.listingUrls[0]).pathname.replace(/\/+$/, "")
      && source.paginationParameters?.some((name) => url.searchParams.has(name))
    ) {
      pagination.add(canonical);
    }
  }

  return { entries: [...entries.values()], pagination: [...pagination] };
}

function languageCode(html, source) {
  const language = String(html).match(/<html\b[^>]*\blang\s*=\s*["']([^"']+)/i)?.[1];
  return language?.split("-", 1)[0].toLowerCase() || source.defaultLanguageCode || "unknown";
}

function sourceItemId(url, source) {
  const path = new URL(url).pathname;
  const match = source.sourceItemPattern?.exec(path);
  return match?.[1] ?? path;
}

function isClosed(html, source) {
  const text = htmlToPlainText(html, 20_000);
  return (source.closedPositionSignals ?? []).some((signal) =>
    text.toLowerCase().includes(signal.toLowerCase()),
  );
}

export async function parseStaticPortalDetail(html, detailUrl, source, listingTitle = "") {
  const entry = await extractPageSignals(html, detailUrl, {
    listingUrl: source.modes.htmlFallback.listingUrls[0],
  });
  return {
    ...entry,
    title: entry.title || listingTitle,
    guid: sourceItemId(detailUrl, source),
    sourceItemId: sourceItemId(detailUrl, source),
    sourceLanguage: languageCode(html, source),
    institution: entry.institution || source.defaultInstitution || "",
    country: entry.country || source.defaultCountry || "",
    city: entry.city || source.defaultCity || "",
    sourceType: "html",
    closed: isClosed(html, source),
  };
}

export async function collectStaticPortalEntries(source, state = {}, options = {}) {
  void state;
  const policy = getHtmlPolicy(source);
  const fetchPage = options.fetchPage ?? fetchStaticPage;
  const maximumListingPages = Math.min(
    options.maxListingPages ?? source.maximumListingPages,
    source.maximumListingPages,
  );
  const maximumDetailPages = Math.min(
    options.maxDetailPages ?? source.maximumDetailPages,
    source.maximumDetailPages,
  );
  const robots = await loadRobotsPolicy(source, { fetchImpl: options.fetchImpl });
  const policyResult = {
    robots: "allowed",
    evaluatedGroup: robots.evaluatedGroup,
    crawlDelayMs: robots.crawlDelayMs,
    contentSignal: "allowed",
  };
  const delayedPace = createRequestPacer(robots.crawlDelayMs, options.sleep);
  const listingQueue = [...policy.listingUrls];
  const visitedListings = new Set();
  const discovered = new Map();
  let requests = 1;
  let succeeded = 1;

  while (listingQueue.length && visitedListings.size < maximumListingPages) {
    const listingUrl = listingQueue.shift();
    if (visitedListings.has(listingUrl)) continue;
    if (!isRobotsAllowed(robots, listingUrl)) {
      throw new SourcePolicyError(
        "Robots policy disallows the approved listing page.",
        "ROBOTS_DISALLOWED",
      );
    }
    await delayedPace();
    const response = await fetchPage(listingUrl, policy, {
      fetchImpl: options.fetchImpl,
      kind: "html",
    });
    requests += 1;
    succeeded += 1;
    if (!contentSignalAllowsSearch(response.contentSignal)) {
      throw new SourcePolicyError(
        "Source policy prohibits search indexing.",
        "CONTENT_SIGNAL_SEARCH_NO",
      );
    }
    visitedListings.add(response.finalUrl);
    const parsed = source.parseListing(response.body, response.finalUrl);
    for (const item of parsed.entries) {
      if (!discovered.has(item.url)) discovered.set(item.url, item);
    }
    for (const pageUrl of parsed.pagination) {
      if (listingQueue.length + visitedListings.size >= maximumListingPages) break;
      if (!visitedListings.has(pageUrl)) listingQueue.push(pageUrl);
    }
  }

  const entries = [];
  const skipped = [];
  const candidates = [...discovered.values()]
    .sort((left, right) => Number(/postdoc/i.test(right.title)) - Number(/postdoc/i.test(left.title)))
    .slice(0, maximumDetailPages);
  for (const candidate of candidates) {
    if (!isRobotsAllowed(robots, candidate.url)) {
      skipped.push({ sourceItemId: sourceItemId(candidate.url, source), reason: "robots" });
      continue;
    }
    try {
      await delayedPace();
      const response = await fetchPage(candidate.url, policy, {
        fetchImpl: options.fetchImpl,
        kind: "html",
      });
      requests += 1;
      succeeded += 1;
      if (!contentSignalAllowsSearch(response.contentSignal)) {
        skipped.push({ sourceItemId: sourceItemId(candidate.url, source), reason: "content-signal" });
        continue;
      }
      entries.push(await source.parseDetail(response.body, response.finalUrl, candidate.title));
    } catch (error) {
      if (error?.retryable) throw error;
      skipped.push({
        sourceItemId: sourceItemId(candidate.url, source),
        reason: String(error?.code ?? "detail-failed").slice(0, 80),
      });
    }
  }
  return {
    entries,
    mode: "static-html",
    unchanged: false,
    etag: null,
    lastModified: null,
    policyResult,
    stats: {
      requests,
      pagesSucceeded: succeeded,
      listingPages: visitedListings.size,
      detailPages: entries.length,
      linksDiscovered: discovered.size,
      skipped: skipped.length,
    },
  };
}
