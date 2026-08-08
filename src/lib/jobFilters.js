export const PUBLIC_FILTER_LIMITS = Object.freeze({
  keyword: 150,
  country: 100,
  research_area: 150,
  language: 100,
});

export const PUBLIC_DEADLINES = Object.freeze(["any", "7", "30", "60", "open", "none"]);

const DEADLINE_SET = new Set(PUBLIC_DEADLINES);

function clean(value, maximumLength) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maximumLength);
}

export function normalizePublicFilters(value = {}) {
  const deadlineInput = clean(value.deadline, 20).toLowerCase();
  const deadline = deadlineInput === "no-deadline" ? "none" : deadlineInput;
  return {
    keyword: clean(value.keyword, PUBLIC_FILTER_LIMITS.keyword),
    country: clean(value.country, PUBLIC_FILTER_LIMITS.country),
    research_area: clean(
      value.research_area ?? value.researchArea,
      PUBLIC_FILTER_LIMITS.research_area,
    ),
    language: clean(value.language, PUBLIC_FILTER_LIMITS.language),
    deadline: DEADLINE_SET.has(deadline) ? deadline : "any",
  };
}

export function publicFiltersFromSearchParams(searchParams) {
  return normalizePublicFilters({
    keyword: searchParams?.get?.("keyword"),
    country: searchParams?.get?.("country"),
    research_area: searchParams?.get?.("research_area"),
    language: searchParams?.get?.("language"),
    deadline: searchParams?.get?.("deadline"),
  });
}

export function publicFiltersToSearchParams(filters) {
  const normalized = normalizePublicFilters(filters);
  const params = new URLSearchParams();
  for (const key of ["keyword", "country", "research_area", "language"]) {
    if (normalized[key]) params.set(key, normalized[key]);
  }
  if (normalized.deadline !== "any") params.set("deadline", normalized.deadline);
  return params;
}

export function publicFiltersToUi(filters, sourceLanguage = "") {
  const normalized = normalizePublicFilters(filters);
  return {
    keyword: normalized.keyword,
    country: normalized.country,
    researchArea: normalized.research_area,
    language: normalized.language,
    sourceLanguage,
    deadline: normalized.deadline === "any"
      ? ""
      : (normalized.deadline === "none" ? "no-deadline" : normalized.deadline),
  };
}

export function canonicalPublicFilterKey(filters) {
  const normalized = normalizePublicFilters(filters);
  return JSON.stringify(Object.fromEntries(
    Object.entries(normalized).map(([key, value]) => [key, value.toLocaleLowerCase()]),
  ));
}

export function publicFilterUrl(pathname, filters) {
  const query = publicFiltersToSearchParams(filters).toString();
  return `${pathname || "/"}${query ? `?${query}` : ""}`;
}
