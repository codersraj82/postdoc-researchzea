export const SOURCE_SEARCH_SESSION_KEY = "rz_approved_source_search_v1";

function clean(value) {
  return String(value ?? "").trim();
}

export function approvedSourceSearchFilters(filters = {}) {
  const deadline = clean(filters.deadline);
  return {
    keyword: clean(filters.keyword),
    country: clean(filters.country),
    research_area: clean(filters.researchArea ?? filters.research_area),
    language: clean(filters.language),
    deadline: deadline === "no-deadline" ? "none" : (deadline || "any"),
  };
}

export function hasApprovedSourceSearchFilter(filters) {
  const current = approvedSourceSearchFilters(filters);
  return Boolean(
    current.keyword
    || current.country
    || current.research_area
    || current.language
    || current.deadline !== "any",
  );
}

export function approvedSourceSearchKey(filters) {
  const current = approvedSourceSearchFilters(filters);
  return JSON.stringify(Object.fromEntries(
    Object.entries(current).map(([key, value]) => [
      key,
      value.normalize("NFKC").replace(/\s+/g, " ").toLocaleLowerCase(),
    ]),
  ));
}

export function shouldOfferApprovedSourceSearch({
  dataSource,
  total,
  savedOnly,
  filters,
  initialLoading = false,
  initialError = null,
  loadingMore = false,
}) {
  return dataSource === "d1"
    && total === 0
    && savedOnly !== true
    && initialLoading !== true
    && !initialError
    && loadingMore !== true
    && hasApprovedSourceSearchFilter(filters);
}
