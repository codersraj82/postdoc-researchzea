import { SourceFetchError } from "../fetchSource.js";
import { normalizeJob } from "../normalizeJob.js";
import { createRequestPacer, isRobotsAllowed, loadRobotsPolicy } from "../robots.js";
import { contentSignalAllowsSearch } from "../sourcePolicy.js";
import { htmlToPlainText } from "../text.js";
import { canonicalizeApprovedUrl } from "../urlSafety.js";
import { validateCollectedJob } from "../validateCollectedJob.js";

const API_ROOT = "https://embl.wd103.myworkdayjobs.com/wday/cxs/embl/EMBL";
const PUBLIC_ROOT = "https://embl.wd103.myworkdayjobs.com/EMBL";
const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);

const definition = {
  key: "embl-postdoctoral-jobs",
  name: "European Molecular Biology Laboratory Jobs",
  type: "api",
  enabled: true,
  official: true,
  institutionOwned: true,
  priority: 10,
  collectionInterval: "daily",
  defaultLanguage: "English",
  defaultLanguageCode: "en",
  defaultInstitution: "European Molecular Biology Laboratory",
  defaultCountry: null,
  renderMode: "public-json-api",
  robotsPolicy: "required",
  requestDelayMs: 1000,
  timeoutMs: 15_000,
  responseSizeLimit: 2 * 1024 * 1024,
  maximumListingPages: 1,
  maximumDetailPages: 8,
  applicationLinkRules: "official EMBL Workday vacancy URL only",
  closedPositionSignals: Object.freeze([
    "position closed",
    "applications closed",
    "no longer accepting applications",
    "job is no longer available",
  ]),
  modes: Object.freeze({
    htmlFallback: Object.freeze({
      robotsUrl: "https://embl.wd103.myworkdayjobs.com/robots.txt",
      listingUrls: Object.freeze([PUBLIC_ROOT]),
      allowedHosts: Object.freeze(["embl.wd103.myworkdayjobs.com"]),
      allowedListingPath: "/EMBL",
      allowedDetailPatterns: Object.freeze([/^\/EMBL\/job\/[a-z0-9%._~/-]+$/i]),
      maxListingPages: 1,
      maxDetailPages: 8,
      maximumBytes: 2 * 1024 * 1024,
      timeoutMs: 15_000,
      maximumRedirects: 3,
      minimumDelayMs: 1000,
    }),
  }),
};

export const emblSource = Object.freeze(definition);

function locationFor(value) {
  const text = String(value ?? "").trim();
  const mappings = [
    ["Hinxton", "United Kingdom"],
    ["Cambridge", "United Kingdom"],
    ["Heidelberg", "Germany"],
    ["Hamburg", "Germany"],
    ["Grenoble", "France"],
    ["Barcelona", "Spain"],
    ["Rome", "Italy"],
  ];
  const match = mappings.find(([city]) => text.toLowerCase().includes(city.toLowerCase()));
  return {
    city: match?.[0] ?? text.split(",", 1)[0].trim(),
    country: match?.[1] ?? "",
  };
}

export function parseEmblListing(payload) {
  const postings = Array.isArray(payload?.jobPostings) ? payload.jobPostings : [];
  const entries = postings
    .filter((posting) => typeof posting?.externalPath === "string")
    .map((posting) => ({
      title: String(posting.title ?? "").trim(),
      externalPath: posting.externalPath,
      sourceItemId: String(posting.bulletFields?.[0] ?? posting.externalPath).trim(),
      location: String(posting.locationsText ?? "").trim(),
      postedOn: String(posting.postedOn ?? "").trim(),
    }));
  return [...new Map(entries.map((entry) => [entry.sourceItemId, entry])).values()];
}

export function parseEmblDetail(payload, listing = {}) {
  const posting = payload?.jobPostingInfo ?? {};
  const externalPath = listing.externalPath || `/job/${posting.jobPostingId ?? ""}`;
  const sourceUrl = canonicalizeApprovedUrl(
    posting.externalUrl || `${PUBLIC_ROOT}${externalPath}`,
    PUBLIC_ROOT,
    emblSource.modes.htmlFallback.allowedHosts,
  );
  const location = locationFor(posting.location || listing.location);
  const descriptionHtml = String(posting.jobDescription ?? "");
  const text = htmlToPlainText(descriptionHtml, 20_000).toLowerCase();
  const closedByText = emblSource.closedPositionSignals.some((signal) =>
    text.includes(signal.toLowerCase()),
  );
  return {
    title: String(posting.title ?? listing.title ?? "").trim(),
    descriptionHtml,
    link: sourceUrl,
    applyUrl: sourceUrl,
    guid: String(posting.jobReqId ?? listing.sourceItemId ?? externalPath).trim(),
    sourceItemId: String(posting.jobReqId ?? listing.sourceItemId ?? externalPath).trim(),
    pubDate: String(posting.startDate ?? "").trim(),
    deadline: String(posting.endDate ?? "").trim(),
    categories: ["Life Sciences"],
    institution: emblSource.defaultInstitution,
    country: location.country,
    city: location.city,
    employmentType: String(posting.timeType ?? "").trim(),
    duration: "",
    sourceLanguage: "en",
    sourceType: "api",
    closed: posting.posted === false || posting.canApply === false || closedByText,
  };
}

async function readBoundedJson(response, maximumBytes) {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maximumBytes) {
    throw new SourceFetchError("Source response exceeds the size limit.", {
      code: "SOURCE_TOO_LARGE",
    });
  }
  const reader = response.body?.getReader();
  if (!reader) return {};
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximumBytes) {
        await reader.cancel();
        throw new SourceFetchError("Source response exceeds the size limit.", {
          code: "SOURCE_TOO_LARGE",
        });
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new SourceFetchError("Source returned invalid JSON.", {
      code: "SOURCE_SCHEMA_INVALID",
    });
  }
}

async function fetchJson(url, options = {}) {
  const approved = canonicalizeApprovedUrl(
    url,
    API_ROOT,
    emblSource.modes.htmlFallback.allowedHosts,
  );
  if (!approved || !new URL(approved).pathname.startsWith("/wday/cxs/embl/EMBL/")) {
    throw new SourceFetchError("EMBL API URL is outside the approved path.", {
      code: "SOURCE_NOT_APPROVED",
    });
  }
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), options.timeoutMs ?? emblSource.timeoutMs);
  try {
    const response = await (options.fetchImpl ?? fetch)(approved, {
      method: options.method ?? "GET",
      body: options.body,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "User-Agent": "ResearchZealBot/1.0 (+https://postdoc.researchzeal.com)",
      },
      credentials: "omit",
      redirect: "manual",
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new SourceFetchError(`Source returned HTTP ${response.status}.`, {
        retryable: RETRYABLE_STATUS.has(response.status),
        code: "SOURCE_HTTP_ERROR",
      });
    }
    if (!contentSignalAllowsSearch(response.headers.get("content-signal"))) {
      throw new SourceFetchError("Source policy prohibits search indexing.", {
        code: "CONTENT_SIGNAL_SEARCH_NO",
      });
    }
    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    if (!contentType.includes("application/json")) {
      throw new SourceFetchError("Source returned an unsupported content type.", {
        code: "SOURCE_CONTENT_TYPE",
      });
    }
    return readBoundedJson(response, emblSource.responseSizeLimit);
  } catch (error) {
    if (error instanceof SourceFetchError) throw error;
    if (error?.name === "AbortError") {
      throw new SourceFetchError("Source request timed out.", {
        retryable: true,
        code: "SOURCE_TIMEOUT",
      });
    }
    throw new SourceFetchError("Source network request failed.", {
      retryable: true,
      code: "SOURCE_NETWORK_ERROR",
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

async function collectEmblEntries(state = {}, options = {}) {
  void state;
  const robots = await loadRobotsPolicy(emblSource, { fetchImpl: options.fetchImpl });
  const listingApi = `${API_ROOT}/jobs`;
  if (!isRobotsAllowed(robots, listingApi)) {
    throw new SourceFetchError("Robots policy disallows the approved EMBL API path.", {
      code: "ROBOTS_DISALLOWED",
    });
  }
  const pace = createRequestPacer(robots.crawlDelayMs, options.sleep);
  await pace();
  const maximumDetailPages = Math.min(
    options.maxDetailPages ?? emblSource.maximumDetailPages,
    emblSource.maximumDetailPages,
  );
  const listingPayload = await fetchJson(listingApi, {
    fetchImpl: options.fetchImpl,
    method: "POST",
    body: JSON.stringify({
      appliedFacets: {},
      limit: maximumDetailPages,
      offset: 0,
      searchText: "postdoc",
    }),
  });
  const listings = parseEmblListing(listingPayload).slice(0, maximumDetailPages);
  const entries = [];
  let pagesSucceeded = 2;
  for (const listing of listings) {
    const detailApi = `${API_ROOT}${listing.externalPath}`;
    if (!isRobotsAllowed(robots, detailApi)) continue;
    await pace();
    const detailPayload = await fetchJson(detailApi, { fetchImpl: options.fetchImpl });
    pagesSucceeded += 1;
    entries.push(parseEmblDetail(detailPayload, listing));
  }
  return {
    entries,
    mode: "public-json-api",
    unchanged: false,
    etag: null,
    lastModified: null,
    policyResult: {
      robots: "allowed",
      evaluatedGroup: robots.evaluatedGroup,
      crawlDelayMs: robots.crawlDelayMs,
      contentSignal: "allowed",
    },
    stats: {
      requests: 2 + listings.length,
      pagesSucceeded,
      listingPages: 1,
      detailPages: entries.length,
      linksDiscovered: listings.length,
      skipped: listings.length - entries.length,
    },
  };
}

export const emblAdapter = Object.freeze({
  getSourceDefinition() {
    return emblSource;
  },
  collectSourceEntries(state, options) {
    return collectEmblEntries(state, options);
  },
  normalizeSourceEntry(entry, now) {
    return normalizeJob(entry, emblSource, now);
  },
  validateSourceEntry(job) {
    return validateCollectedJob(job);
  },
});
