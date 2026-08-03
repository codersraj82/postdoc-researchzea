import { hasDirectApplication } from "./comparison.js";
import { normalizeLanguageCode } from "./languages.js";

export const EMPTY_PREFERENCES = Object.freeze({
  researchKeywords: "",
  countries: "",
  sourceLanguages: "",
  deadline: "",
  minimumDurationMonths: "",
  requireDirectApplication: false,
  preferOfficialSource: false,
});

function normalizedText(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function normalizedTokens(value) {
  return [...new Set(normalizedText(value).split(/\s+/).filter((token) => token.length > 1))];
}

export function normalizedList(value) {
  return [...new Set(
    String(value ?? "")
      .split(/[,;\n]+/)
      .map(normalizedText)
      .filter(Boolean),
  )];
}

export function normalizePreferences(value) {
  const preferences = value && typeof value === "object" ? value : {};
  return {
    researchKeywords: String(preferences.researchKeywords ?? "").slice(0, 300),
    countries: String(preferences.countries ?? "").slice(0, 300),
    sourceLanguages: String(preferences.sourceLanguages ?? "").slice(0, 200),
    deadline: ["open", "30", "60"].includes(preferences.deadline)
      ? preferences.deadline
      : "",
    minimumDurationMonths: /^\d{1,3}$/.test(String(preferences.minimumDurationMonths ?? ""))
      ? String(Math.min(Number(preferences.minimumDurationMonths), 120))
      : "",
    requireDirectApplication: preferences.requireDirectApplication === true,
    preferOfficialSource: preferences.preferOfficialSource === true,
  };
}

export function hasPreferences(value) {
  const preferences = normalizePreferences(value);
  return Boolean(
    preferences.researchKeywords.trim()
    || preferences.countries.trim()
    || preferences.sourceLanguages.trim()
    || preferences.deadline
    || preferences.minimumDurationMonths
    || preferences.requireDirectApplication
    || preferences.preferOfficialSource,
  );
}

export function parseDurationMonths(value) {
  const text = normalizedText(value);
  const years = text.match(/(\d+(?:\.\d+)?)\s*years?/);
  if (years) return Math.round(Number(years[1]) * 12);
  const months = text.match(/(\d+(?:\.\d+)?)\s*months?/);
  return months ? Math.round(Number(months[1])) : null;
}

function daysUntil(deadline, now) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(deadline ?? ""))) return null;
  const today = new Date(now);
  today.setUTCHours(0, 0, 0, 0);
  const deadlineDate = new Date(`${deadline}T00:00:00.000Z`);
  const days = Math.floor((deadlineDate.getTime() - today.getTime()) / 86_400_000);
  return Number.isFinite(days) ? days : null;
}

function addCriterion(criteria, key, points, maximum, reason) {
  criteria.push({ key, points, maximum, reason: points > 0 ? reason : null });
}

export function calculatePreferenceMatch(job, value, now = new Date()) {
  const preferences = normalizePreferences(value);
  if (!hasPreferences(preferences)) return null;
  const criteria = [];

  const researchTokens = normalizedTokens(preferences.researchKeywords);
  if (researchTokens.length) {
    const searchable = normalizedText([
      job?.title,
      job?.research_area,
      job?.description,
      ...(Array.isArray(job?.tags) ? job.tags : []),
    ].join(" "));
    const matched = researchTokens.filter((token) => searchable.includes(token));
    const points = Math.round(40 * matched.length / researchTokens.length);
    addCriterion(
      criteria,
      "research",
      points,
      40,
      `Research terms matched: ${matched.join(", ")} (+${points})`,
    );
  }

  const countries = normalizedList(preferences.countries);
  const languages = normalizedList(preferences.sourceLanguages).map(normalizeLanguageCode);
  const countryMaximum = countries.length && languages.length ? 12 : countries.length ? 20 : 0;
  const languageMaximum = countries.length && languages.length ? 8 : languages.length ? 20 : 0;
  const countryMatches = countries.includes(normalizedText(job?.country));
  const languageMatches = languages.includes(normalizeLanguageCode(job?.source_language));
  if (countryMaximum) {
    addCriterion(
      criteria,
      "country",
      countryMatches ? countryMaximum : 0,
      countryMaximum,
      `Preferred country matched: ${job.country} (+${countryMaximum})`,
    );
  }
  if (languageMaximum) {
    addCriterion(
      criteria,
      "source-language",
      languageMatches ? languageMaximum : 0,
      languageMaximum,
      `Preferred source language matched (+${languageMaximum})`,
    );
  }

  if (preferences.deadline) {
    const days = daysUntil(job?.deadline, now);
    const matches = days !== null && days >= 0 && (
      preferences.deadline === "open"
      || (preferences.deadline === "30" && days <= 30)
      || (preferences.deadline === "60" && days <= 60)
    );
    addCriterion(
      criteria,
      "deadline",
      matches ? 15 : 0,
      15,
      `Deadline preference matched (+15)`,
    );
  }

  const directMaximum = preferences.requireDirectApplication
    ? (preferences.preferOfficialSource ? 8 : 15)
    : 0;
  const officialMaximum = preferences.preferOfficialSource
    ? (preferences.requireDirectApplication ? 7 : 15)
    : 0;
  if (directMaximum) {
    addCriterion(
      criteria,
      "direct-application",
      hasDirectApplication(job) ? directMaximum : 0,
      directMaximum,
      `Separate direct application is available (+${directMaximum})`,
    );
  }
  if (officialMaximum) {
    addCriterion(
      criteria,
      "official-source",
      job?.official_source === true ? officialMaximum : 0,
      officialMaximum,
      `Institution-owned official source (+${officialMaximum})`,
    );
  }

  const duration = parseDurationMonths(job?.duration);
  const minimumDuration = Number(preferences.minimumDurationMonths || 0);
  const durationComplete = duration !== null && (!minimumDuration || duration >= minimumDuration);
  const completeness = [
    durationComplete,
    Boolean(job?.employment_type),
    daysUntil(job?.deadline, now) !== null,
    Boolean(job?.country && job?.city),
    normalizeLanguageCode(job?.source_language) !== "unknown",
  ];
  const completeCount = completeness.filter(Boolean).length;
  const completenessPoints = completeCount * 2;
  addCriterion(
    criteria,
    "completeness",
    completenessPoints,
    10,
    `${completeCount} of 5 comparison details are stated (+${completenessPoints})`,
  );

  return {
    score: Math.min(100, criteria.reduce((total, criterion) => total + criterion.points, 0)),
    reasons: criteria.map((criterion) => criterion.reason).filter(Boolean),
    criteria,
  };
}
