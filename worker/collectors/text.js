const DESCRIPTION_LIMIT = 1200;
const BLOCKED_PROTOCOLS = new Set(["data:", "file:", "javascript:", "mailto:", "tel:"]);
const TRACKING_PARAMETERS = [
  "fbclid",
  "gclid",
  "mc_cid",
  "mc_eid",
  "ref",
  "source",
];

const NAMED_ENTITIES = {
  amp: "&",
  apos: "'",
  gt: ">",
  hellip: "…",
  ldquo: "“",
  lsquo: "‘",
  lt: "<",
  nbsp: " ",
  quot: '"',
  rdquo: "”",
  rsquo: "’",
};

export function decodeHtmlEntities(value) {
  return String(value ?? "").replace(
    /&(#x[0-9a-f]+|#\d+|[a-z]+);/gi,
    (entity, key) => {
      if (key.startsWith("#x") || key.startsWith("#X")) {
        const codePoint = Number.parseInt(key.slice(2), 16);
        return Number.isSafeInteger(codePoint) && codePoint <= 0x10ffff
          ? String.fromCodePoint(codePoint)
          : entity;
      }

      if (key.startsWith("#")) {
        const codePoint = Number.parseInt(key.slice(1), 10);
        return Number.isSafeInteger(codePoint) && codePoint <= 0x10ffff
          ? String.fromCodePoint(codePoint)
          : entity;
      }

      return NAMED_ENTITIES[key.toLowerCase()] ?? entity;
    },
  );
}

export function htmlToPlainText(html, maximumLength = DESCRIPTION_LIMIT) {
  const withoutUnsafeBlocks = decodeHtmlEntities(String(html ?? ""))
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(
      /<(script|style|form|iframe|object|embed|svg|canvas|video|audio)[^>]*>[\s\S]*?<\/\1\s*>/gi,
      " ",
    )
    .replace(/<(img|input|link|meta|source|track)[^>]*>/gi, " ")
    .replace(/<\/?(?:p|div|br|li|tr|h[1-6]|section|article|blockquote)[^>]*>/gi, " ")
    .replace(/<[^>]+>/g, " ");

  return decodeHtmlEntities(withoutUnsafeBlocks)
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maximumLength)
    .trim();
}

export function safeHttpUrl(value, baseUrl) {
  try {
    const url = baseUrl ? new URL(value, baseUrl) : new URL(value);
    if (BLOCKED_PROTOCOLS.has(url.protocol) || !["http:", "https:"].includes(url.protocol)) {
      return null;
    }
    if (url.username || url.password) {
      return null;
    }
    return url;
  } catch {
    return null;
  }
}

export function canonicalizeUrl(value, baseUrl) {
  const url = safeHttpUrl(value, baseUrl);
  if (!url) {
    return null;
  }

  url.hash = "";
  for (const parameter of [...url.searchParams.keys()]) {
    if (parameter.toLowerCase().startsWith("utm_") || TRACKING_PARAMETERS.includes(parameter.toLowerCase())) {
      url.searchParams.delete(parameter);
    }
  }
  if ((url.protocol === "https:" && url.port === "443") || (url.protocol === "http:" && url.port === "80")) {
    url.port = "";
  }
  if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, "");

  return url.toString();
}

export { DESCRIPTION_LIMIT };
