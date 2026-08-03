const LANGUAGE_LABELS = Object.freeze({
  de: "German",
  en: "English",
  es: "Spanish",
  fr: "French",
  it: "Italian",
  nl: "Dutch",
  pt: "Portuguese",
  sv: "Swedish",
  unknown: "Unknown",
});

const LANGUAGE_CODES = Object.freeze(
  Object.fromEntries(
    Object.entries(LANGUAGE_LABELS).map(([code, label]) => [label.toLowerCase(), code]),
  ),
);

export function normalizeLanguageCode(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized || normalized === "unknown") return "unknown";
  if (LANGUAGE_LABELS[normalized]) return normalized;
  return LANGUAGE_CODES[normalized] ?? normalized.slice(0, 12);
}

export function getLanguageLabel(value) {
  const code = normalizeLanguageCode(value);
  return LANGUAGE_LABELS[code] ?? code.toUpperCase();
}

export function getSourceLanguageOptions(jobs) {
  const codes = [...new Set(
    (Array.isArray(jobs) ? jobs : []).map((job) =>
      normalizeLanguageCode(job?.source_language),
    ),
  )];
  return codes
    .map((value) => ({ value, label: getLanguageLabel(value) }))
    .sort((first, second) => first.label.localeCompare(second.label));
}

export function matchesSourceLanguage(job, expected) {
  if (!expected) return true;
  return normalizeLanguageCode(job?.source_language) === normalizeLanguageCode(expected);
}
