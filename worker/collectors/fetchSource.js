const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;
const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);
const XML_CONTENT_TYPES = [
  "application/atom+xml",
  "application/rss+xml",
  "application/xml",
  "text/xml",
];

export class SourceFetchError extends Error {
  constructor(message, { retryable = false, code = "SOURCE_FETCH_FAILED", retryAfterMs = null } = {}) {
    super(message);
    this.name = "SourceFetchError";
    this.retryable = retryable;
    this.code = code;
    this.retryAfterMs = retryAfterMs;
  }
}

function isApprovedUrl(value, source) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && source.allowedHosts.includes(url.hostname.toLowerCase());
  } catch {
    return false;
  }
}

function retryDelay(retryAfter) {
  if (!retryAfter) return 250;
  const seconds = Number(retryAfter);
  if (Number.isFinite(seconds)) return Math.min(Math.max(seconds * 1000, 0), 2000);
  const date = new Date(retryAfter).getTime();
  return Number.isFinite(date) ? Math.min(Math.max(date - Date.now(), 0), 2000) : 250;
}

async function readBoundedBody(response, maximumBytes) {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maximumBytes) {
    throw new SourceFetchError("Source response exceeds the size limit.", {
      code: "SOURCE_TOO_LARGE",
    });
  }

  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maximumBytes) {
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

  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(body);
}

async function fetchOnce(source, state, options) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), options.timeoutMs);
  const headers = {
    Accept: "application/rss+xml, application/xml;q=0.9, text/xml;q=0.8, text/plain;q=0.5",
    "User-Agent": "PostdocResearchZealCollector/1.0 (+https://postdoc.researchzeal.com)",
  };
  if (state?.etag) headers["If-None-Match"] = state.etag;
  if (state?.last_modified) headers["If-Modified-Since"] = state.last_modified;

  let url = source.url;
  try {
    for (let redirects = 0; redirects <= 3; redirects += 1) {
      if (!isApprovedUrl(url, source)) {
        throw new SourceFetchError("Source URL is not in the approved HTTPS registry.", {
          code: "SOURCE_NOT_APPROVED",
        });
      }
      const response = await options.fetchImpl(url, {
        method: "GET",
        headers,
        credentials: "omit",
        redirect: "manual",
        signal: controller.signal,
      });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get("location");
        if (!location || redirects === 3) {
          throw new SourceFetchError("Source returned an unusable redirect.");
        }
        url = new URL(location, url).toString();
        continue;
      }
      if (response.status === 304) {
        return { unchanged: true, status: 304, body: null, etag: state?.etag ?? null, lastModified: state?.last_modified ?? null };
      }
      if (!response.ok) {
        throw new SourceFetchError(`Source returned HTTP ${response.status}.`, {
          retryable: RETRYABLE_STATUS.has(response.status),
          code: "SOURCE_HTTP_ERROR",
          retryAfterMs: retryDelay(response.headers.get("retry-after")),
        });
      }

      const contentType = response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() ?? "";
      const allowedType = XML_CONTENT_TYPES.includes(contentType) || (source.allowTextPlain && contentType === "text/plain");
      if (!allowedType) {
        throw new SourceFetchError("Source returned an unsupported content type.", {
          code: "SOURCE_CONTENT_TYPE",
        });
      }

      return {
        unchanged: false,
        status: response.status,
        body: await readBoundedBody(response, options.maximumBytes),
        etag: response.headers.get("etag"),
        lastModified: response.headers.get("last-modified"),
      };
    }
    throw new SourceFetchError("Source redirect limit exceeded.");
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

export async function fetchSource(source, state = {}, options = {}) {
  const rssMode = source?.modes?.rss;
  const requestSource = rssMode
    ? {
        ...source,
        ...rssMode,
        enabled: source.enabled,
      }
    : source;
  if (!requestSource?.enabled || !isApprovedUrl(requestSource.url, requestSource)) {
    throw new SourceFetchError("Source is not enabled in the approved registry.", {
      code: "SOURCE_NOT_APPROVED",
    });
  }
  const settings = {
    fetchImpl: options.fetchImpl ?? fetch,
    sleep: options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))),
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    maximumBytes: options.maximumBytes ?? DEFAULT_MAX_BYTES,
  };

  let firstError;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await fetchOnce(requestSource, state, settings);
    } catch (error) {
      if (attempt === 1 || !error.retryable) throw error;
      firstError = error;
      await settings.sleep(error.retryAfterMs ?? 250);
    }
  }
  throw firstError;
}

export { DEFAULT_MAX_BYTES, DEFAULT_TIMEOUT_MS };
