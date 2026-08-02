import { createContentHash, sha256 } from "./hashing.js";
import {
  extractMainContentAnchors,
  isUsableApplicationUrl,
  selectApplicationUrl,
} from "./selectApplicationUrl.js";
import {
  canonicalizeUrl,
  htmlToPlainText,
} from "./text.js";

const COUNTRIES = [
  "United States",
  "United Kingdom",
  "United Arab Emirates",
  "South Korea",
  "New Zealand",
  "Saudi Arabia",
  "South Africa",
  "Czech Republic",
  "The Netherlands",
  "Netherlands",
  "Switzerland",
  "Australia",
  "Singapore",
  "Germany",
  "France",
  "Canada",
  "China",
  "Japan",
  "India",
  "Spain",
  "Italy",
  "Sweden",
  "Norway",
  "Denmark",
  "Finland",
  "Belgium",
  "Austria",
  "Ireland",
  "Israel",
  "Portugal",
  "Poland",
  "Brazil",
  "Mexico",
  "Taiwan",
  "Hong Kong",
];

const RESEARCH_AREAS = [
  ["Artificial Intelligence", /\b(artificial intelligence|machine learning|deep learning|neural network|computer vision|natural language processing)\b/i],
  ["Computer Science", /\b(computer science|software|algorithm|cybersecurity|informatics|computing|data science)\b/i],
  ["Materials Science", /\b(materials? science|nanomaterial|polymer|composite|metallurgy|semiconductor)\b/i],
  ["Engineering", /\b(engineering|mechanics|robotics|aerospace|civil engineer|electrical engineer|mechanical engineer)\b/i],
  ["Medicine and Health", /\b(medicine|medical|clinical|health|oncology|neuroscience|epidemiology|pharmacology)\b/i],
  ["Environmental Science", /\b(environment|climate|ecology|sustainability|geoscience|oceanography)\b/i],
  ["Biology", /\b(biology|biological|genomics|genetics|microbiology|biochemistry|molecular biology)\b/i],
  ["Chemistry", /\b(chemistry|chemical|catalysis|spectroscopy)\b/i],
  ["Physics", /\b(physics|quantum|photonics|astrophysics|condensed matter)\b/i],
  ["Mathematics", /\b(mathematics|mathematical|statistics|probability)\b/i],
  ["Economics", /\b(economics|econometrics|economic policy)\b/i],
  ["Social Sciences", /\b(social science|sociology|psychology|political science|anthropology|education research)\b/i],
];

const MONTH_NAMES = "January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec";
const DATE_FRAGMENT = `(?:\\d{4}-\\d{2}-\\d{2}|\\d{1,2}[\\s./-]+(?:${MONTH_NAMES})[\\s,./-]+\\d{4}|(?:${MONTH_NAMES})[\\s./-]+\\d{1,2}(?:st|nd|rd|th)?[\\s,./-]+\\d{4})`;

function isoDate(value, { now, futureToleranceMs = 0 } = {}) {
  if (!value) return null;
  const input = String(value).trim();
  let parsed = new Date(input);
  let iso = Number.isFinite(parsed.getTime()) ? parsed.toISOString().slice(0, 10) : null;
  const numericDate = input.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (numericDate && (!iso || iso !== `${numericDate[1]}-${numericDate[2]}-${numericDate[3]}`)) return null;

  const monthLookup = new Map(
    ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"]
      .map((month, index) => [month, index]),
  );
  const namedDate = input.match(
    /(?:(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)|(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\s+(\d{1,2}))(?:st|nd|rd|th)?[,\s]+(\d{4})/i,
  );
  if (namedDate) {
    const monthText = namedDate[2] ?? input.match(new RegExp(MONTH_NAMES, "i"))?.[0];
    const day = Number(namedDate[1] ?? namedDate[3]);
    const year = Number(namedDate[4]);
    const month = monthLookup.get(monthText.slice(0, 3).toLowerCase());
    const check = new Date(Date.UTC(year, month, day));
    if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month || check.getUTCDate() !== day) return null;
    iso = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    parsed = check;
  }
  if (!iso || !Number.isFinite(parsed.getTime())) return null;
  if (now && parsed.getTime() > now.getTime() + futureToleranceMs) return null;
  return iso;
}

export function extractDeadline(text, now) {
  void now;
  const pattern = new RegExp(
    `(?:application\\s+deadline|post\\s+closing\\s+date|closing\\s+date|applications?\\s+close|applications?\\s+must\\s+be\\s+received\\s+no\\s+later\\s+than|last\\s+date\\s+for\\s+applications|apply\\s+by|deadline)\\s*(?::|is|on|-)?\\s*(?:no\\s+later\\s+than\\s+)?(${DATE_FRAGMENT})`,
    "i",
  );
  const match = String(text ?? "").match(pattern);
  return match ? isoDate(match[1]) : null;
}

export function extractDuration(text) {
  const value = String(text ?? "");
  const cueFirst = value.match(
    /\b(?:duration\s*:|term\s+is|initially\s+(?:available|offered)\s+for|(?:position|appointment|post|role)s?\s+(?:is|are)\s+(?:initially\s+)?(?:tentatively\s+)?(?:available\s+|offered\s+)?(?:for\s+)?|fixed[- ]term(?:\s+postdoc)?(?:\s+position)?\s+(?:is\s+)?for|tentatively\s+for)\s*(one|two|three|four|five|\d{1,2})\s*[- ]?(months?|years?)\b/i,
  );
  const valueFirst = value.match(
    /\b(one|two|three|four|five|\d{1,2})\s*[- ](month|year)(?:[- ](?:fixed[- ]term\s+)?(?:postdoc(?:toral)?(?:\s+research\s+associate)?\s+)?(?:appointment|position|term|role))\b/i,
  );
  const match = cueFirst ?? valueFirst;
  if (!match) return "";
  const numbers = { one: 1, two: 2, three: 3, four: 4, five: 5 };
  const amount = numbers[match[1].toLowerCase()] ?? Number(match[1]);
  const unit = match[2].toLowerCase().startsWith("month") ? "month" : "year";
  return `${amount} ${unit}${amount === 1 ? "" : "s"}`;
}

export function classifyResearchArea(text) {
  return RESEARCH_AREAS.find(([, pattern]) => pattern.test(String(text ?? "")))?.[0] ?? "Other / Multidisciplinary";
}

export function normalizeInstitution(value) {
  const input = String(value ?? "")
    .replace(/\s+/g, " ")
    .replace(/^["'\s]+|["'\s]+$/g, "")
    .replace(/^the\s+/i, "")
    .replace(/[’']s$/i, "")
    .trim();
  if (!input || /^see original source$/i.test(input)) return "";
  if (/\bUCL\s*[-–—]\s*University\s+College\s+London\b/i.test(input)) return "UCL – University College London";
  if (/\bUniversity\s+of\s+Oxford\b/i.test(input)) return "University of Oxford";
  if (/\bJohns\s+Hopkins\s*University\b/i.test(input)) return "Johns Hopkins University";
  if (/\bMcGill\s+University\b/i.test(input)) return "McGill University";
  if (/\bAarhus\s+University\b/i.test(input)) return "Aarhus University";
  return input
    .replace(/\s+(?:to\s+work|seeks|invites|is\s+looking|for\s+the|on\s+the|within\s+the)\b[\s\S]*$/i, "")
    .replace(/\s*[,:;(].*$/, "")
    .replace(/[.;]+$/, "")
    .trim()
    .slice(0, 200);
}

export function extractInstitution(text) {
  const input = String(text ?? "").replace(/\s+/g, " ");
  const known = [
    /\bUCL\s*[-–—]\s*University\s+College\s+London\b/i,
    /\bUniversity\s+of\s+Oxford\b/i,
    /\bJohns\s+Hopkins\s*University\b/i,
    /\bMcGill\s+University\b/i,
    /\bAarhus\s+University\b/i,
  ];
  for (const pattern of known) {
    const match = input.match(pattern);
    if (match) return normalizeInstitution(match[0]);
  }
  const generic = input.match(
    /\b(?:at|from|with)\s+(?:the\s+)?((?:University\s+of\s+[A-Z][\p{L}'’.-]*(?:\s+[A-Z][\p{L}'’.-]*){0,5})|(?:[A-Z][\p{L}&'’.-]*(?:\s+[A-Z][\p{L}&'’.-]*){0,7}\s+(?:University|Institute|Laboratory)))\b/u,
  );
  return normalizeInstitution(generic?.[1]) || "See original source";
}

function normalizeCountry(value) {
  const input = String(value ?? "").trim();
  if (!input || /^not specified$/i.test(input)) return "";
  if (/^(?:USA|U\.?S\.?(?:A\.?)?|United States(?: of America)?)$/i.test(input)) return "United States";
  if (/^(?:UK|U\.?K\.?|United Kingdom|Great Britain)$/i.test(input)) return "United Kingdom";
  if (/^The Netherlands$/i.test(input)) return "Netherlands";
  return COUNTRIES.find((country) => country.toLowerCase() === input.toLowerCase()) ?? input.slice(0, 100);
}

const INSTITUTION_COUNTRIES = new Map([
  ["McGill University", "Canada"],
  ["University of Oxford", "United Kingdom"],
  ["Johns Hopkins University", "United States"],
  ["Aarhus University", "Denmark"],
  ["UCL – University College London", "United Kingdom"],
]);

const DOMAIN_COUNTRIES = new Map([
  ["mcgill.ca", "Canada"],
  ["ox.ac.uk", "United Kingdom"],
  ["jhu.edu", "United States"],
  ["ucl.ac.uk", "United Kingdom"],
  ["au.dk", "Denmark"],
]);

function mappedDomainCountry(applyUrl) {
  const canonical = canonicalizeUrl(applyUrl);
  if (!canonical) return "";
  const hostname = new URL(canonical).hostname.toLowerCase();
  for (const [domain, country] of DOMAIN_COUNTRIES) {
    if (hostname === domain || hostname.endsWith(`.${domain}`)) return country;
  }
  return "";
}

export function extractLocation(text, { institution = "", applyUrl = "" } = {}) {
  const input = String(text ?? "");
  const variants = [
    ["United States", /\b(?:United States(?: of America)?|USA)\b|\bU\.S\.(?:A\.)?/i],
    ["United Kingdom", /\b(?:United Kingdom|UK|Great Britain)\b|\bU\.K\./i],
    ...COUNTRIES.filter((name) => !["United States", "United Kingdom", "The Netherlands"].includes(name))
      .map((name) => [normalizeCountry(name), new RegExp(`\\b${name.replace(/\s+/g, "\\s+")}\\b`, "i")]),
  ];
  const explicit = variants.find(([, pattern]) => pattern.test(input))?.[0] ?? "";
  const maryland = /\bBaltimore\s*,\s*Maryland\b/i.test(input);
  const oxford = /\bcentral\s+Oxford\b/i.test(input) && normalizeInstitution(institution) === "University of Oxford";
  const mapped = INSTITUTION_COUNTRIES.get(normalizeInstitution(institution)) || mappedDomainCountry(applyUrl);
  const country = explicit || (maryland ? "United States" : "") || (oxford ? "United Kingdom" : "") || mapped;
  if (!country) return { country: "Not specified", city: "" };

  const locationPattern = new RegExp(
    `\\b(?:location|based in)\\s*:\\s*([A-Z][A-Za-z.' -]{1,60}),\\s*${country.replace(/\s+/g, "\\s+")}\\b`,
    "i",
  );
  const match = input.match(locationPattern);
  const city = match?.[1]?.trim()
    || (maryland ? "Baltimore" : "")
    || (oxford ? "Oxford" : "")
    || (/\bAarhus\s*,\s*Denmark\b/i.test(input) ? "Aarhus" : "");
  return { country, city: city.slice(0, 100) };
}

function buildTags(categories, text, researchArea) {
  const candidates = [...(categories ?? []), researchArea, "Postdoctoral"];
  const keywords = ["AI", "Robotics", "Mechanics", "Biology", "Chemistry", "Physics", "Mathematics"];
  for (const keyword of keywords) {
    if (new RegExp(`\\b${keyword}\\b`, "i").test(text)) candidates.push(keyword);
  }
  const seen = new Set();
  return candidates
    .map((tag) => String(tag).replace(/\s+/g, " ").trim().slice(0, 50))
    .filter((tag) => tag && !seen.has(tag.toLowerCase()) && seen.add(tag.toLowerCase()))
    .slice(0, 10);
}

function normalizeTitle(value) {
  return String(value ?? "")
    .replace(/^iMechanica\s*(?:Job Channel)?\s*[:|–—-]\s*/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
}

export async function createSourceItemId(entry, sourceUrl) {
  if (sourceUrl) return sourceUrl.slice(0, 500);
  const explicit = String(entry?.guid ?? "").trim();
  if (explicit) return explicit.slice(0, 500);
  return sha256(`${entry?.title ?? ""}\n${entry?.pubDate ?? ""}`);
}

function canonicalSourceUrl(value, source) {
  const canonical = canonicalizeUrl(value);
  if (!canonical) return null;
  const url = new URL(canonical);
  const approvedHosts = new Set([
    ...(source?.modes?.rss?.allowedHosts ?? []),
    ...(source?.modes?.htmlFallback?.allowedHosts ?? []),
  ]);
  if (url.hostname === "www.imechanica.org" && approvedHosts.has("imechanica.org")) {
    url.hostname = "imechanica.org";
  }
  if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, "");
  return url.toString();
}

export async function normalizeJob(entry, source, now = new Date()) {
  const title = normalizeTitle(entry.title);
  const sourceUrl = canonicalSourceUrl(entry.link, source);
  const description = htmlToPlainText(entry.descriptionHtml);
  const metadataText = htmlToPlainText(entry.descriptionHtml, 20_000);
  const combinedText = `${title}. ${metadataText}`;
  const postedAt = isoDate(entry.pubDate, {
    now,
    futureToleranceMs: 48 * 60 * 60 * 1000,
  });
  const sourceItemId = await createSourceItemId(entry, sourceUrl);
  const explicitInstitution = normalizeInstitution(entry.institution);
  const titleInstitution = extractInstitution(title);
  const institution = explicitInstitution
    || (titleInstitution !== "See original source" ? titleInstitution : extractInstitution(metadataText));
  const listingUrl = source?.modes?.htmlFallback?.listingUrls?.[0];
  const selectedApplication = selectApplicationUrl({
    anchors: extractMainContentAnchors(entry.descriptionHtml),
    sourceUrl,
    listingUrl,
    mainText: metadataText,
  });
  const applyUrl = isUsableApplicationUrl(entry.applyUrl, { sourceUrl, listingUrl })
    ? canonicalizeUrl(entry.applyUrl, sourceUrl)
    : selectedApplication.url;
  const location = extractLocation(combinedText, { institution, applyUrl });
  const researchArea = classifyResearchArea(combinedText);
  const timestamp = now.toISOString();

  const job = {
    id: `collected-${(await sha256(`${source.key}\n${sourceItemId}`)).slice(0, 32)}`,
    title,
    institution,
    country: normalizeCountry(entry.country)
      || location.country,
    city: String(entry.city ?? "").trim().slice(0, 100)
      || location.city,
    research_area: researchArea,
    language: source.defaultLanguage,
    description,
    apply_url: applyUrl,
    source_url: sourceUrl,
    deadline: isoDate(entry.deadline) || extractDeadline(combinedText, now),
    posted_at: postedAt,
    employment_type: "Postdoctoral position",
    duration: extractDuration(String(entry.duration ?? ""))
      || extractDuration(combinedText),
    tags: buildTags(entry.categories, combinedText, researchArea),
    is_active: 1,
    is_demo: 0,
    origin_type: "collected",
    source_key: source.key,
    source_name: source.name,
    source_item_id: sourceItemId,
    source_type: entry.sourceType === "html" ? "html" : "rss",
    canonical_url: sourceUrl,
    expiry_reason: null,
    first_seen_at: timestamp,
    last_seen_at: timestamp,
    last_verified_at: timestamp,
    collection_state: "active",
    created_at: timestamp,
    updated_at: timestamp,
  };
  job.content_hash = await createContentHash(job);
  return job;
}

export { isoDate };
