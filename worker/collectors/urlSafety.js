import { canonicalizeUrl } from "./text.js";

const ASSET_EXTENSION = /\.(?:7z|avi|css|csv|docx?|eot|gif|gz|ico|jpe?g|js|json|m4a|mov|mp3|mp4|mpeg|pdf|png|pptx?|rar|rss|svg|tar|tgz|ttf|wav|webm|webp|woff2?|xlsx?|xml|zip)$/i;

export class SourcePolicyError extends Error {
  constructor(message, code = "SOURCE_POLICY_FAILED", options = {}) {
    super(message);
    this.name = "SourcePolicyError";
    this.code = code;
    this.retryable = options.retryable === true;
    this.status = options.status ?? null;
  }
}

export function canonicalizeApprovedUrl(value, baseUrl, allowedHosts) {
  const canonical = canonicalizeUrl(value, baseUrl);
  if (!canonical) return null;
  const url = new URL(canonical);
  if (url.protocol !== "https:" || !allowedHosts.includes(url.hostname.toLowerCase())) {
    return null;
  }
  url.hostname = url.hostname.toLowerCase();
  if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, "");
  return url.toString();
}

export function validateApprovedRedirect(location, currentUrl, allowedHosts) {
  const redirected = canonicalizeApprovedUrl(location, currentUrl, allowedHosts);
  if (!redirected) {
    throw new SourcePolicyError(
      "Source redirect left the approved HTTPS host.",
      "SOURCE_REDIRECT_REJECTED",
    );
  }
  return redirected;
}

export function isCrawlableDocumentUrl(value) {
  try {
    const url = new URL(value);
    return !ASSET_EXTENSION.test(url.pathname);
  } catch {
    return false;
  }
}
