import {
  canonicalizeApprovedUrl,
  isCrawlableDocumentUrl,
} from "./urlSafety.js";

const EXCLUDED_PATHS = [
  "/about",
  "/admin",
  "/comment",
  "/contact",
  "/filter",
  "/search",
  "/taxonomy",
  "/tracker",
  "/user",
];

export function getHtmlPolicy(source) {
  const policy = source?.modes?.htmlFallback;
  if (!source?.enabled || !policy || !policy.allowedHosts?.length) {
    throw new Error("HTML fallback is not enabled for this approved source.");
  }
  return policy;
}

export function isApprovedListingUrl(value, source) {
  const policy = getHtmlPolicy(source);
  const canonical = canonicalizeApprovedUrl(value, policy.listingUrls[0], policy.allowedHosts);
  if (!canonical) return false;
  const url = new URL(canonical);
  if (url.pathname !== policy.allowedListingPath) return false;
  if ([...url.searchParams.keys()].some((key) => key !== "page")) return false;
  const page = url.searchParams.get("page");
  return page === null || /^\d+$/.test(page);
}

export function isApprovedDetailCandidate(value, source, baseUrl) {
  const policy = getHtmlPolicy(source);
  const canonical = canonicalizeApprovedUrl(value, baseUrl, policy.allowedHosts);
  if (!canonical || !isCrawlableDocumentUrl(canonical)) return false;
  const url = new URL(canonical);
  if (url.search || EXCLUDED_PATHS.some((path) => url.pathname === path || url.pathname.startsWith(`${path}/`))) {
    return false;
  }
  if (url.pathname === policy.allowedListingPath || url.pathname.endsWith("/feed")) return false;
  return policy.allowedDetailPatterns.some((pattern) => pattern.test(url.pathname));
}

export function canonicalDetailUrl(value, source, baseUrl) {
  if (!isApprovedDetailCandidate(value, source, baseUrl)) return null;
  return canonicalizeApprovedUrl(
    value,
    baseUrl,
    getHtmlPolicy(source).allowedHosts,
  );
}

export function contentSignalAllowsSearch(value) {
  const signal = typeof value === "string" ? value : value?.get?.("content-signal") ?? "";
  return !/(?:^|[,;\s])search\s*=\s*no(?:$|[,;\s])/i.test(signal);
}
