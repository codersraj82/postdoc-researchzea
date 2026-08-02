import { classifyPostdoc } from "./classifyPostdoc.js";
import { extractJobPostingJsonLd } from "./extractJobPostingJsonLd.js";
import { collectDetailSignals } from "./htmlRuntime.js";
import {
  extractMainContentAnchors,
  extractMainContentHtml,
  selectApplicationUrl,
} from "./selectApplicationUrl.js";
import { htmlToPlainText } from "./text.js";

function attribute(tag, name) {
  const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
  return match?.[1] ?? match?.[2] ?? match?.[3] ?? "";
}

function fallbackSignals(html) {
  const title = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1\s*>/i)?.[1] ?? "";
  const article = extractMainContentHtml(html);
  const metaTag = html.match(/<meta\b[^>]*name\s*=\s*["']description["'][^>]*>/i)?.[0] ?? "";
  const timeTag = html.match(/<time\b[^>]*>/i)?.[0] ?? "";
  return {
    title: htmlToPlainText(title, 300),
    body: htmlToPlainText(article, 20_000),
    metaDescriptions: [attribute(metaTag, "content")].filter(Boolean),
    publishedDates: [attribute(timeTag, "datetime")].filter(Boolean),
    anchors: extractMainContentAnchors(html),
  };
}

function selectFromVisible(posting, visible, detailUrl, listingUrl) {
  const anchors = [...(visible.anchors ?? [])];
  if (posting?.url && posting.url !== detailUrl) {
    anchors.push({
      href: posting.url,
      text: "Official job advertisement",
      parentText: "Official job advertisement",
      nearbyText: "",
      headingText: "",
      isMainContent: true,
      isExcludedRegion: false,
    });
  }
  return selectApplicationUrl({
    anchors,
    sourceUrl: detailUrl,
    listingUrl,
    mainText: visible.body,
  });
}

function entryFromPosting(posting, visible, detailUrl, listingUrl) {
  const application = selectFromVisible(posting, visible, detailUrl, listingUrl);
  return {
    title: posting.title,
    descriptionHtml: posting.description,
    link: detailUrl,
    guid: posting.identifier,
    pubDate: posting.datePosted || visible.publishedDates[0] || "",
    categories: [],
    applyUrl: application.url,
    applicationSelectionReason: application.selectionReason,
    institution: posting.institution,
    country: posting.country,
    city: posting.city,
    deadline: posting.deadline,
    employmentType: posting.employmentType,
    sourceType: "html",
  };
}

export async function extractPageSignals(html, detailUrl, { listingUrl } = {}) {
  const visible = await collectDetailSignals(html) ?? fallbackSignals(html);
  visible.anchors = extractMainContentAnchors(html);
  const postings = await extractJobPostingJsonLd(html);
  for (const posting of postings) {
    const entry = entryFromPosting(posting, visible, detailUrl, listingUrl);
    if (classifyPostdoc(entry).accepted) return entry;
  }

  const application = selectFromVisible(null, visible, detailUrl, listingUrl);

  return {
    title: visible.title,
    descriptionHtml: visible.body || visible.metaDescriptions[0] || "",
    link: detailUrl,
    guid: detailUrl,
    pubDate: visible.publishedDates[0] ?? "",
    categories: [],
    applyUrl: application.url,
    applicationSelectionReason: application.selectionReason,
    sourceType: "html",
  };
}
