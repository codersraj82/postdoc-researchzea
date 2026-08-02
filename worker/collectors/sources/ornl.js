import { normalizeJob } from "../normalizeJob.js";
import {
  collectStaticPortalEntries,
  parseStaticPortalDetail,
  parseStaticPortalListing,
} from "../staticPortalAdapter.js";
import { validateCollectedJob } from "../validateCollectedJob.js";

const definition = {
  key: "ornl-postdoctoral-jobs",
  name: "Oak Ridge National Laboratory Postdoctoral Jobs",
  type: "html",
  enabled: true,
  official: true,
  institutionOwned: true,
  priority: 10,
  collectionInterval: "daily",
  defaultLanguage: "English",
  defaultLanguageCode: "en",
  defaultInstitution: "Oak Ridge National Laboratory",
  defaultCountry: "United States",
  defaultCity: "Oak Ridge",
  renderMode: "static",
  robotsPolicy: "required",
  requestDelayMs: 1000,
  timeoutMs: 15_000,
  responseSizeLimit: 2 * 1024 * 1024,
  maximumListingPages: 2,
  maximumDetailPages: 10,
  paginationParameters: Object.freeze(["startrow"]),
  sourceItemPattern: /\/(\d+)\/?$/,
  applicationLinkRules: "official ORNL vacancy or apply action only",
  closedPositionSignals: Object.freeze([
    "position closed",
    "applications closed",
    "no longer accepting applications",
    "job is no longer available",
  ]),
  modes: Object.freeze({
    htmlFallback: Object.freeze({
      robotsUrl: "https://jobs.ornl.gov/robots.txt",
      listingUrls: Object.freeze([
        "https://jobs.ornl.gov/go/Postdoctoral-Jobs/4537100/",
      ]),
      allowedHosts: Object.freeze(["jobs.ornl.gov"]),
      allowedListingPath: "/go/Postdoctoral-Jobs/4537100/",
      allowedDetailPatterns: Object.freeze([/^\/job\/[a-z0-9%._~-]+\/\d+\/?$/i]),
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

export const ornlSource = Object.freeze(definition);

export const ornlAdapter = Object.freeze({
  getSourceDefinition() {
    return ornlSource;
  },
  collectSourceEntries(state, options) {
    return collectStaticPortalEntries(ornlSource, state, options);
  },
  normalizeSourceEntry(entry, now) {
    return normalizeJob(entry, ornlSource, now);
  },
  validateSourceEntry(job) {
    return validateCollectedJob(job);
  },
});
