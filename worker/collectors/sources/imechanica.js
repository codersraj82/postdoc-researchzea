export const imechanicaSource = Object.freeze({
  key: "imechanica-job-channel",
  name: "iMechanica Job Channel",
  type: "hybrid",
  enabled: true,
  defaultLanguage: "English",
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
