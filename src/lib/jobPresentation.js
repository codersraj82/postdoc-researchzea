function cleanPart(value) {
  return typeof value === "string" ? value.trim() : "";
}

export function isDemonstrationJob(job) {
  return job?.is_demo === true;
}

export function formatJobLocation(job) {
  const place = [cleanPart(job?.city), cleanPart(job?.country)]
    .filter(Boolean)
    .join(", ");
  return [place, cleanPart(job?.language)].filter(Boolean).join(" · ");
}

export function normalizeComparableUrl(value) {
  try {
    const url = new URL(String(value ?? "").trim());
    if (!url.hostname || !["http:", "https:"].includes(url.protocol)) return null;
    url.hash = "";
    if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, "");
    return url.toString();
  } catch {
    return null;
  }
}

export function areEquivalentJobUrls(left, right) {
  const normalizedLeft = normalizeComparableUrl(left);
  const normalizedRight = normalizeComparableUrl(right);
  return Boolean(normalizedLeft && normalizedRight && normalizedLeft === normalizedRight);
}
