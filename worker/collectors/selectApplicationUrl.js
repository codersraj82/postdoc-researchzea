import {
  canonicalizeUrl,
  decodeHtmlEntities,
  htmlToPlainText,
} from "./text.js";

const EXCLUDED_PROTOCOLS = /^(?:blob|data|file|javascript|mailto|tel):/i;
const EXCLUDED_PATHS = [
  /^\/$/,
  /^\/(?:taxonomy|tag|tags|user|users|profile|login|logout|register|search)(?:\/|$)/i,
  /^\/comment(?:\/|$)/i,
];
const SOCIAL_HOSTS = /(?:^|\.)(?:facebook|instagram|linkedin|tiktok|twitter|x)\.com$/i;
const ASSET_PATH = /\.(?:avif|bmp|css|csv|docx?|gif|ico|jpe?g|js|json|png|pptx?|svg|webp|xlsx?|xml|zip)(?:$|\/)/i;
const TRACKING_SIGNAL = /(?:analytics|doubleclick|pixel|tracking?)(?:\.|\/|$)/i;
const EXPLICIT_APPLICATION = /\b(?:apply(?:\s+now|\s+for\s+(?:this\s+)?position)?|application\s+details?|submit\s+(?:an\s+|your\s+)?application|applications?\s+must\s+be\s+submitted|recruitment\s+system)\b/i;
const OFFICIAL_VACANCY = /\b(?:vacancy\s+details?|job\s+details?|official\s+job\s+advertisement|official\s+vacancy|recruitment)\b/i;
const OFFICIAL_URL = /(?:career|jobs?|recruit|vacanc|work-at-|application)/i;
const GENERAL_SITE = /\b(?:group|home(?:page)?|laboratory|lab|project|website)\b/i;

function attribute(tag, name) {
  const match = String(tag).match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
  return decodeHtmlEntities(match?.[1] ?? match?.[2] ?? match?.[3] ?? "");
}

function insideExcludedRegion(prefix) {
  const openings = [...prefix.matchAll(/<(nav|footer|aside|form)\b[^>]*>/gi)];
  const closings = [...prefix.matchAll(/<\/(nav|footer|aside|form)\s*>/gi)];
  const latestOpening = openings.at(-1);
  const latestClosing = closings.at(-1);
  if (latestOpening && (!latestClosing || latestOpening.index > latestClosing.index)) return true;
  const commentOpening = [...prefix.matchAll(/<[^>]+(?:id|class)\s*=\s*["'][^"']*comments?[^"']*["'][^>]*>/gi)].at(-1);
  return Boolean(commentOpening && (!latestClosing || commentOpening.index > latestClosing.index));
}

function nearestHeading(prefix) {
  const headings = [...prefix.matchAll(/<h[2-6]\b[^>]*>([\s\S]*?)<\/h[2-6]\s*>/gi)];
  return htmlToPlainText(headings.at(-1)?.[1] ?? "", 200);
}

function parentText(content, start, end) {
  const before = content.slice(0, start);
  const opening = [...before.matchAll(/<(p|li|div|section|blockquote)\b[^>]*>/gi)].at(-1);
  if (!opening) return "";
  const tag = opening[1];
  const closeIndex = content.slice(end).search(new RegExp(`<\\/${tag}\\s*>`, "i"));
  if (closeIndex < 0) return "";
  return htmlToPlainText(content.slice(opening.index, end + closeIndex), 500);
}

export function extractMainContentHtml(html) {
  const documentHtml = String(html ?? "");
  const openingPattern = /<([a-z][\w:-]*)\b[^>]*class\s*=\s*["'][^"']*\bfield--name-body\b[^"']*["'][^>]*>/i;
  const opening = openingPattern.exec(documentHtml);
  if (opening) {
    const tagName = opening[1];
    const tokenPattern = new RegExp(`<\\/?${tagName}\\b[^>]*>`, "gi");
    tokenPattern.lastIndex = opening.index + opening[0].length;
    let depth = 1;
    let token;
    while ((token = tokenPattern.exec(documentHtml)) !== null) {
      if (new RegExp(`^<\\/${tagName}\\b`, "i").test(token[0])) depth -= 1;
      else if (!/\/\s*>$/.test(token[0])) depth += 1;
      if (depth === 0) return documentHtml.slice(opening.index + opening[0].length, token.index);
    }
    return documentHtml.slice(opening.index + opening[0].length);
  }
  return documentHtml.match(/<article\b[^>]*>([\s\S]*?)<\/article\s*>/i)?.[1]
    ?? documentHtml.match(/<main\b[^>]*>([\s\S]*?)<\/main\s*>/i)?.[1]
    ?? documentHtml;
}

export function extractMainContentAnchors(html) {
  const article = extractMainContentHtml(html);
  const anchors = [];
  const pattern = /<a\b[^>]*>[\s\S]*?<\/a\s*>/gi;
  let match;
  while ((match = pattern.exec(article)) !== null) {
    const tag = match[0];
    const href = attribute(tag, "href");
    const text = htmlToPlainText(tag, 300);
    const prefix = article.slice(0, match.index);
    const excluded = insideExcludedRegion(prefix);
    const nearby = htmlToPlainText(
      article.slice(Math.max(0, match.index - 260), Math.min(article.length, pattern.lastIndex + 260)),
      700,
    );
    anchors.push({
      href,
      text,
      parentText: parentText(article, match.index, pattern.lastIndex),
      nearbyText: nearby,
      headingText: nearestHeading(prefix),
      isMainContent: !excluded,
      isExcludedRegion: excluded,
    });
  }
  return anchors;
}

function isRegisteredListing(candidate, listingUrl) {
  const url = new URL(candidate);
  if (/^\/taxonomy\/term\/73\/?$/i.test(url.pathname)) return true;
  const listing = canonicalizeUrl(listingUrl);
  if (!listing) return false;
  const expected = new URL(listing);
  return url.hostname === expected.hostname && url.pathname.replace(/\/+$/, "") === expected.pathname.replace(/\/+$/, "");
}

export function isUsableApplicationUrl(value, { sourceUrl, listingUrl } = {}) {
  if (!value || EXCLUDED_PROTOCOLS.test(String(value).trim())) return false;
  const candidate = canonicalizeUrl(value, sourceUrl);
  if (!candidate) return false;
  const url = new URL(candidate);
  if (url.protocol !== "https:" || url.username || url.password) return false;
  if (isRegisteredListing(candidate, listingUrl)) return false;
  if (EXCLUDED_PATHS.some((pattern) => pattern.test(url.pathname))) return false;
  if (url.searchParams.has("page") && url.pathname.includes("taxonomy")) return false;
  if (/(?:^|[#/])comment(?:-|\/|$)/i.test(`${url.pathname}${url.hash}`)) return false;
  if (SOCIAL_HOSTS.test(url.hostname) || ASSET_PATH.test(url.pathname) || TRACKING_SIGNAL.test(`${url.hostname}${url.pathname}`)) return false;
  return true;
}

function rankedCandidate(anchor, sourceUrl, listingUrl) {
  if (!anchor?.isMainContent || anchor.isExcludedRegion) return null;
  const candidate = canonicalizeUrl(anchor.href, sourceUrl);
  if (!isUsableApplicationUrl(candidate, { sourceUrl, listingUrl })) return null;
  if (candidate === canonicalizeUrl(sourceUrl)) return null;

  const url = new URL(candidate);
  const source = new URL(sourceUrl);
  const directContext = [anchor.text, anchor.parentText, anchor.headingText]
    .filter(Boolean)
    .join(" ");
  const context = [directContext, anchor.nearbyText]
    .filter(Boolean)
    .join(" ");
  const explicit = EXPLICIT_APPLICATION.test(context);
  const official = OFFICIAL_VACANCY.test(context) || OFFICIAL_URL.test(`${url.hostname}${url.pathname}`);
  const rootLike = url.pathname === "/" || url.pathname.split("/").filter(Boolean).length < 2;
  const generalSite = GENERAL_SITE.test(anchor.text) || rootLike;
  if (generalSite && !/\b(?:apply(?:\s+for\s+(?:this\s+)?position|\s+now)?|submit\s+(?:an\s+|your\s+)?application|applications?\s+must\s+be\s+submitted)\b/i.test(directContext)) {
    return null;
  }
  const pdf = /\.pdf$/i.test(url.pathname);
  if (pdf && !/\b(?:apply|submit)\b/i.test(context)) return null;
  if (!explicit && !official) return null;

  let score = explicit ? 300 : 200;
  if (url.hostname !== source.hostname) score += 30;
  if (OFFICIAL_URL.test(`${url.hostname}${url.pathname}`)) score += 25;
  if (/\bapply(?:\s+now|\s+for\s+(?:this\s+)?position)?\b/i.test(anchor.text)) score += 40;
  if (/\b(?:submit|recruitment system)\b/i.test(context)) score += 20;
  if (pdf) score -= 50;
  return {
    url: candidate,
    selectionReason: explicit ? "explicit_apply_link" : "official_vacancy_link",
    score,
  };
}

export function selectApplicationUrl({ anchors = [], sourceUrl, listingUrl, mainText = "" }) {
  const source = canonicalizeUrl(sourceUrl);
  if (!source) return { url: null, selectionReason: "source_detail_fallback" };
  const candidates = anchors
    .map((anchor) => rankedCandidate({ ...anchor, nearbyText: anchor.nearbyText || mainText }, source, listingUrl))
    .filter(Boolean)
    .sort((left, right) => right.score - left.score || left.url.localeCompare(right.url));
  if (!candidates[0]) return { url: source, selectionReason: "source_detail_fallback" };
  return {
    url: candidates[0].url,
    selectionReason: candidates[0].selectionReason,
  };
}
