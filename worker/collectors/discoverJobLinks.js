import { collectListingSignals } from "./htmlRuntime.js";
import {
  canonicalDetailUrl,
  isApprovedListingUrl,
} from "./sourcePolicy.js";
import { htmlToPlainText } from "./text.js";
import { canonicalizeApprovedUrl } from "./urlSafety.js";

function attribute(tag, name) {
  const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
  return match?.[1] ?? match?.[2] ?? match?.[3] ?? "";
}

function anchors(html) {
  return [...String(html).matchAll(/<a\b[^>]*>[\s\S]*?<\/a\s*>/gi)].map((match) => ({
    href: attribute(match[0], "href"),
    text: htmlToPlainText(match[0], 300),
  }));
}

function fallbackListingSignals(html) {
  const title = html.match(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i)?.[1] ?? "";
  const mainHeading = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1\s*>/i)?.[1] ?? "";
  const articles = [...String(html).matchAll(/<article\b[^>]*>([\s\S]*?)<\/article\s*>/gi)];
  const entryLinks = [];
  const excerpts = [];
  const submittedDates = [];
  for (const article of articles) {
    const heading = article[1].match(/<h[23]\b[^>]*>([\s\S]*?)<\/h[23]\s*>/i)?.[1] ?? "";
    const link = anchors(heading)[0];
    if (!link) continue;
    entryLinks.push(link);
    excerpts.push(htmlToPlainText(article[1], 800));
    const time = article[1].match(/<time\b[^>]*>/i)?.[0] ?? "";
    submittedDates.push(attribute(time, "datetime"));
  }
  const paginationBlock = html.match(/<(?:nav|ul)\b[^>]*class\s*=\s*["'][^"']*pager[^"']*["'][^>]*>[\s\S]*?<\/(?:nav|ul)\s*>/i)?.[0] ?? "";
  return {
    title: htmlToPlainText(title, 300),
    mainHeading: htmlToPlainText(mainHeading, 300),
    entryLinks,
    excerpts,
    submittedDates,
    paginationLinks: anchors(paginationBlock),
  };
}

export async function discoverJobLinks(html, listingUrl, source) {
  const signals = await collectListingSignals(html) ?? fallbackListingSignals(html);
  const seen = new Set();
  const entries = [];
  for (let index = 0; index < signals.entryLinks.length; index += 1) {
    const link = signals.entryLinks[index];
    const url = canonicalDetailUrl(link.href, source, listingUrl);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    entries.push({
      url,
      title: htmlToPlainText(link.text, 300),
      excerpt: htmlToPlainText(signals.excerpts[index], 800),
      submittedAt: signals.submittedDates[index] ?? "",
    });
  }

  const pagination = [];
  for (const link of signals.paginationLinks) {
    const url = canonicalizeApprovedUrl(
      link.href,
      listingUrl,
      source.modes.htmlFallback.allowedHosts,
    );
    if (url && isApprovedListingUrl(url, source) && !pagination.includes(url)) pagination.push(url);
  }
  return {
    pageTitle: htmlToPlainText(signals.title, 300),
    mainHeading: htmlToPlainText(signals.mainHeading, 300),
    entries,
    pagination,
  };
}
