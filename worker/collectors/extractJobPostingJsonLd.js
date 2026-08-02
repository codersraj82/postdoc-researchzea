import { collectJsonLdScripts } from "./htmlRuntime.js";
import { htmlToPlainText, safeHttpUrl } from "./text.js";

function fallbackScripts(html) {
  return [...String(html).matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script\s*>/gi)]
    .map((match) => match[1]);
}

function nodes(value) {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!value || typeof value !== "object") return [];
  return [value, ...nodes(value["@graph"] ?? [])];
}

function isJobPosting(value) {
  const types = Array.isArray(value?.["@type"]) ? value["@type"] : [value?.["@type"]];
  return types.some((type) => String(type).toLowerCase() === "jobposting");
}

function stringValue(value, maximum = 500) {
  if (typeof value === "string" || typeof value === "number") {
    return String(value).replace(/\s+/g, " ").trim().slice(0, maximum);
  }
  return "";
}

function organizationName(value) {
  return stringValue(typeof value === "object" ? value?.name : value, 200);
}

function location(value) {
  const locationValue = Array.isArray(value) ? value[0] : value;
  const address = locationValue?.address ?? locationValue;
  const countryValue = address?.addressCountry;
  return {
    city: stringValue(address?.addressLocality, 100),
    country: stringValue(
      typeof countryValue === "object" ? countryValue?.name : countryValue,
      100,
    ),
  };
}

export async function extractJobPostingJsonLd(html) {
  const scripts = await collectJsonLdScripts(html) ?? fallbackScripts(html);
  const postings = [];
  for (const script of scripts) {
    if (!script.trim() || script.length > 256 * 1024) continue;
    try {
      const parsed = JSON.parse(script);
      for (const candidate of nodes(parsed).filter(isJobPosting)) {
        const title = stringValue(candidate.title, 300);
        const description = htmlToPlainText(candidate.description, 1200);
        if (!title || !description) continue;
        const place = location(candidate.jobLocation);
        postings.push({
          title,
          description,
          datePosted: stringValue(candidate.datePosted, 100),
          deadline: stringValue(candidate.validThrough, 100),
          institution: organizationName(candidate.hiringOrganization),
          city: place.city,
          country: place.country,
          url: safeHttpUrl(candidate.url)?.toString() ?? "",
          identifier: stringValue(
            typeof candidate.identifier === "object"
              ? candidate.identifier?.value
              : candidate.identifier,
            200,
          ),
          employmentType: stringValue(candidate.employmentType, 100),
        });
      }
    } catch {
      // Invalid or unrelated JSON-LD is ignored.
    }
  }
  return postings;
}
