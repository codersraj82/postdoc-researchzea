import { collectSourceEntries as collectHybridEntries } from "../collectSourceEntries.js";
import { normalizeJob } from "../normalizeJob.js";
import { validateCollectedJob } from "../validateCollectedJob.js";

export const imechanicaSource = Object.freeze({
  key: "imechanica-job-channel",
  name: "iMechanica Job Channel",
  type: "hybrid",
  enabled: true,
  official: false,
  institutionOwned: false,
  priority: 50,
  collectionInterval: "twice_daily",
  defaultLanguage: "English",
  defaultLanguageCode: "en",
  defaultCountry: null,
  renderMode: "static",
  robotsPolicy: "required-for-html-fallback",
  requestDelayMs: 1000,
  timeoutMs: 15_000,
  responseSizeLimit: 2 * 1024 * 1024,
  maximumListingPages: 2,
  maximumDetailPages: 10,
  applicationLinkRules: "approved main-content application or vacancy URL",
  closedPositionSignals: Object.freeze([
    "position closed",
    "applications closed",
    "no longer accepting applications",
    "vacancy filled",
  ]),
  modes: Object.freeze({
    rss: Object.freeze({
      url: "https://imechanica.org/taxonomy/term/73/feed",
      allowedHosts: Object.freeze(["imechanica.org"]),
      allowTextPlain: true,
    }),
    htmlFallback: Object.freeze({
      robotsUrl: "https://imechanica.org/robots.txt",
      listingUrls: Object.freeze(["https://imechanica.org/taxonomy/term/73"]),
      allowedHosts: Object.freeze(["imechanica.org"]),
      allowedListingPath: "/taxonomy/term/73",
      allowedDetailPatterns: Object.freeze([
        /^\/[a-z0-9][a-z0-9-]{2,180}\/?$/i,
        /^\/node\/\d+\/?$/i,
      ]),
      maxListingPages: 2,
      maxDetailPages: 10,
      maximumBytes: 2 * 1024 * 1024,
      timeoutMs: 15_000,
      maximumRedirects: 3,
      minimumDelayMs: 1000,
    }),
  }),
});

export const imechanicaAdapter = Object.freeze({
  getSourceDefinition() {
    return imechanicaSource;
  },
  collectSourceEntries(state, options) {
    return collectHybridEntries(imechanicaSource, state, options);
  },
  normalizeSourceEntry(entry, now) {
    return normalizeJob(entry, imechanicaSource, now);
  },
  validateSourceEntry(job) {
    return validateCollectedJob(job);
  },
});
