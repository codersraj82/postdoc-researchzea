import { crawlStaticSource } from "./crawlStaticSource.js";
import { fetchSource } from "./fetchSource.js";
import { parseRss } from "./parseRss.js";

function errorCode(error) {
  return String(error?.code ?? error?.name ?? "SOURCE_FAILED").slice(0, 80);
}

export async function collectSourceEntries(source, state, options = {}) {
  try {
    const response = await fetchSource(source, state, {
      fetchImpl: options.fetchImpl,
      sleep: options.sleep,
      timeoutMs: options.timeoutMs,
      maximumBytes: options.maximumBytes,
    });
    if (response.unchanged) {
      return {
        entries: [],
        mode: "rss-unchanged",
        unchanged: true,
        etag: response.etag,
        lastModified: response.lastModified,
        policyResult: null,
      };
    }
    return {
      entries: parseRss(response.body).map((entry) => ({ ...entry, sourceType: "rss" })),
      mode: "rss",
      unchanged: false,
      etag: response.etag,
      lastModified: response.lastModified,
      policyResult: null,
    };
  } catch (rssError) {
    try {
      const fallback = await crawlStaticSource(source, {
        fetchImpl: options.fetchImpl,
        fetchPage: options.fetchPage,
        sleep: options.sleep,
        maxListingPages: options.maxListingPages,
        maxDetailPages: options.maxDetailPages,
      });
      return {
        ...fallback,
        unchanged: false,
        etag: null,
        lastModified: null,
        fallbackReason: errorCode(rssError),
      };
    } catch (htmlError) {
      const error = new Error(
        `Approved RSS and HTML fallback failed (${errorCode(rssError)}; ${errorCode(htmlError)}).`,
      );
      error.code = "HYBRID_SOURCE_FAILED";
      throw error;
    }
  }
}
