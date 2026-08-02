import {
  SourcePolicyError,
  validateApprovedRedirect,
} from "./urlSafety.js";

const HTML_TYPES = new Set(["application/xhtml+xml", "text/html"]);
const ROBOTS_TYPES = new Set(["text/plain", "text/robots", "text/html"]);
const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);

async function readBoundedBody(response, maximumBytes) {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maximumBytes) {
    throw new SourcePolicyError("HTML response exceeds the size limit.", "HTML_TOO_LARGE");
  }
  if (!response.body) return "";

  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximumBytes) {
        await reader.cancel();
        throw new SourcePolicyError("HTML response exceeds the size limit.", "HTML_TOO_LARGE");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(body);
}

export async function fetchStaticPage(url, policy, options = {}) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const kind = options.kind ?? "html";
  const maximumBytes = options.maximumBytes ?? policy.maximumBytes;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), options.timeoutMs ?? policy.timeoutMs);
  let currentUrl = url;

  try {
    for (let redirects = 0; redirects <= policy.maximumRedirects; redirects += 1) {
      const response = await fetchImpl(currentUrl, {
        method: "GET",
        headers: {
          Accept: kind === "robots"
            ? "text/plain"
            : "text/html, application/xhtml+xml;q=0.9",
          "User-Agent": "ResearchZealBot/1.0 (+https://postdoc.researchzeal.com)",
        },
        credentials: "omit",
        redirect: "manual",
        signal: controller.signal,
      });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get("location");
        if (!location || redirects === policy.maximumRedirects) {
          throw new SourcePolicyError("HTML source returned an unusable redirect.", "HTML_REDIRECT_FAILED");
        }
        currentUrl = validateApprovedRedirect(location, currentUrl, policy.allowedHosts);
        continue;
      }
      if (!response.ok) {
        throw new SourcePolicyError(
          `HTML source returned HTTP ${response.status}.`,
          "HTML_HTTP_ERROR",
          { retryable: RETRYABLE_STATUS.has(response.status), status: response.status },
        );
      }

      const type = response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() ?? "";
      const allowedTypes = kind === "robots" ? ROBOTS_TYPES : HTML_TYPES;
      if (!allowedTypes.has(type)) {
        throw new SourcePolicyError("HTML source returned an unsupported content type.", "HTML_CONTENT_TYPE");
      }
      return {
        body: await readBoundedBody(response, maximumBytes),
        contentSignal: response.headers.get("content-signal"),
        finalUrl: currentUrl,
        status: response.status,
      };
    }
    throw new SourcePolicyError("HTML source redirect limit exceeded.", "HTML_REDIRECT_FAILED");
  } catch (error) {
    if (error instanceof SourcePolicyError) throw error;
    if (error?.name === "AbortError") {
      throw new SourcePolicyError(
        "HTML source request timed out.",
        "HTML_TIMEOUT",
        { retryable: true },
      );
    }
    throw new SourcePolicyError(
      "HTML source network request failed.",
      "HTML_NETWORK_ERROR",
      { retryable: true },
    );
  } finally {
    clearTimeout(timeoutId);
  }
}
