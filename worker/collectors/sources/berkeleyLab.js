import { normalizeJob } from "../normalizeJob.js";
import {
  collectStaticPortalEntries,
  parseStaticPortalDetail,
  parseStaticPortalListing,
} from "../staticPortalAdapter.js";
import { validateCollectedJob } from "../validateCollectedJob.js";

const definition = {
  key: "berkeley-lab-postdoctoral",
  name: "Berkeley Lab Postdoctoral Opportunities",
  type: "html",
  enabled: true,
  official: true,
  institutionOwned: true,
  priority: 10,
  collectionInterval: "every_48_hours",
  defaultLanguage: "English",
  defaultLanguageCode: "en",
  defaultInstitution: "Lawrence Berkeley National Laboratory",
  defaultCountry: "United States",
  defaultCity: "Berkeley",
  renderMode: "static",
  robotsPolicy: "required",
  requestDelayMs: 1000,
  timeoutMs: 15_000,
  responseSizeLimit: 2 * 1024 * 1024,
  maximumListingPages: 2,
  maximumDetailPages: 10,
  paginationParameters: Object.freeze(["page"]),
  sourceItemPattern: /-(\d+)\/?$/,
  applicationLinkRules: "official LBL vacancy detail with its first-party Apply action",
  closedPositionSignals: Object.freeze([
    "position closed",
    "applications closed",
    "no longer accepting applications",
    "job is no longer available",
  ]),
  modes: Object.freeze({
    htmlFallback: Object.freeze({
      robotsUrl: "https://jobs.lbl.gov/robots.txt",
      listingUrls: Object.freeze([
        "https://jobs.lbl.gov/landingpages/postdoctoral-fellow-opportunities-at-lbl-12",
      ]),
      allowedHosts: Object.freeze(["jobs.lbl.gov"]),
      allowedListingPath: "/landingpages/postdoctoral-fellow-opportunities-at-lbl-12",
      allowedDetailPatterns: Object.freeze([/^\/jobs\/[a-z0-9%._~-]+-\d+\/?$/i]),
      maxListingPages: 2,
      maxDetailPages: 10,
      maximumBytes: 2 * 1024 * 1024,
      timeoutMs: 15_000,
      maximumRedirects: 3,
      minimumDelayMs: 1000,
    }),
  }),
};

definition.parseListing = (html, url) => parseStaticPortalListing(html, url, definition);
definition.parseDetail = (html, url, title) => parseStaticPortalDetail(html, url, definition, title);

export const berkeleyLabSource = Object.freeze(definition);

export const berkeleyLabAdapter = Object.freeze({
  getSourceDefinition() {
    return berkeleyLabSource;
  },
  collectSourceEntries(state, options) {
    return collectStaticPortalEntries(berkeleyLabSource, state, options);
  },
  normalizeSourceEntry(entry, now) {
    return normalizeJob(entry, berkeleyLabSource, now);
  },
  validateSourceEntry(job) {
    return validateCollectedJob(job);
  },
});
