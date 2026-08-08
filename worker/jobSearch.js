import {
  hasActiveCollectedJobs,
  normalizeDemoFlag,
  publicDatasetCondition,
} from "./collectors/publicJobs.js";
import { getSourceDefinition } from "./collectors/sourceRegistry.js";

export const JOB_SEARCH_LIMITS = Object.freeze({
  keyword: 150,
  country: 100,
  research_area: 150,
  language: 100,
});

export const DEADLINE_OPTIONS = Object.freeze([
  "any",
  "7",
  "30",
  "60",
  "open",
  "none",
]);

const DEADLINE_OPTION_SET = new Set(DEADLINE_OPTIONS);
const SEARCHABLE_COLUMNS = Object.freeze([
  "title",
  "institution",
  "country",
  "city",
  "research_area",
  "language",
  "description",
  "tags_json",
]);

export function normalizeSearchValue(value, maximumLength) {
  return String(value ?? "").trim().slice(0, maximumLength);
}

export function normalizeJobSearchFilters(value = {}) {
  const deadlineValue = normalizeSearchValue(value.deadline, 20).toLowerCase();
  return {
    keyword: normalizeSearchValue(value.keyword, JOB_SEARCH_LIMITS.keyword),
    country: normalizeSearchValue(value.country, JOB_SEARCH_LIMITS.country),
    research_area: normalizeSearchValue(
      value.research_area ?? value.researchArea,
      JOB_SEARCH_LIMITS.research_area,
    ),
    language: normalizeSearchValue(value.language, JOB_SEARCH_LIMITS.language),
    deadline: DEADLINE_OPTION_SET.has(deadlineValue) ? deadlineValue : "any",
  };
}

export function filtersFromSearchParams(searchParams) {
  const keyword = searchParams.has("keyword")
    ? searchParams.get("keyword")
    : searchParams.get("q");
  return normalizeJobSearchFilters({
    keyword,
    country: searchParams.get("country"),
    research_area: searchParams.get("research_area"),
    language: searchParams.get("language"),
    deadline: searchParams.get("deadline"),
  });
}

export function hasMeaningfulJobSearchFilter(filters) {
  const normalized = normalizeJobSearchFilters(filters);
  return Boolean(
    normalized.keyword
    || normalized.country
    || normalized.research_area
    || normalized.language
    || normalized.deadline !== "any",
  );
}

function escapeLikePattern(value) {
  return value.replace(/[\\%_]/g, "\\$&");
}

export function buildJobFilterSql(filters, datasetCondition) {
  const normalized = normalizeJobSearchFilters(filters);
  const conditions = [
    "is_active = 1",
    datasetCondition,
    "(deadline IS NULL OR date(deadline) >= date('now'))",
  ];
  const values = [];

  if (normalized.keyword) {
    const keyword = `%${escapeLikePattern(normalized.keyword.toLowerCase())}%`;
    conditions.push(
      `(${SEARCHABLE_COLUMNS.map((column) => `LOWER(COALESCE(${column}, '')) LIKE ? ESCAPE '\\'`).join(" OR ")})`,
    );
    values.push(...SEARCHABLE_COLUMNS.map(() => keyword));
  }
  if (normalized.country) {
    conditions.push("LOWER(TRIM(country)) = ?");
    values.push(normalized.country.toLowerCase());
  }
  if (normalized.research_area) {
    conditions.push("LOWER(TRIM(research_area)) = ?");
    values.push(normalized.research_area.toLowerCase());
  }
  if (normalized.language) {
    conditions.push("LOWER(language) LIKE ? ESCAPE '\\'");
    values.push(`%${escapeLikePattern(normalized.language.toLowerCase())}%`);
  }
  if (["7", "30", "60"].includes(normalized.deadline)) {
    conditions.push(
      "deadline IS NOT NULL AND date(deadline) BETWEEN date('now') AND date('now', ?)",
    );
    values.push(`+${normalized.deadline} days`);
  } else if (normalized.deadline === "open") {
    conditions.push("deadline IS NOT NULL AND date(deadline) >= date('now')");
  } else if (normalized.deadline === "none") {
    conditions.push("deadline IS NULL");
  }

  return {
    filters: normalized,
    whereClause: `WHERE ${conditions.join(" AND ")}`,
    values,
  };
}

function parseTags(value) {
  try {
    const tags = JSON.parse(value);
    return Array.isArray(tags) ? tags : [];
  } catch {
    return [];
  }
}

export function mapPublicJobRow(row) {
  const source = getSourceDefinition(row.source_key);
  return {
    id: row.id,
    title: row.title,
    institution: row.institution,
    country: row.country,
    city: row.city,
    research_area: row.research_area,
    language: row.language,
    source_language: row.source_language ?? "unknown",
    source_name: row.source_name ?? source?.name ?? null,
    official_source: source?.institutionOwned === true,
    source_count: Number(row.source_count ?? 1),
    last_verified_at: row.last_verified_at ?? null,
    description: row.description,
    apply_url: row.apply_url,
    source_url: row.source_url,
    deadline: row.deadline,
    posted_at: row.posted_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
    employment_type: row.employment_type,
    duration: row.duration,
    tags: parseTags(row.tags_json),
    is_demo: normalizeDemoFlag(row.is_demo),
  };
}

export async function resolvePublicDataset(db) {
  const useCollectedJobs = await hasActiveCollectedJobs(db);
  return {
    useCollectedJobs,
    condition: publicDatasetCondition(useCollectedJobs),
  };
}

export async function countMatchingJobs(db, filters, options = {}) {
  const dataset = options.dataset ?? await resolvePublicDataset(db);
  const built = buildJobFilterSql(filters, dataset.condition);
  const row = await db.prepare(
    `SELECT COUNT(*) AS total FROM jobs ${built.whereClause}`,
  ).bind(...built.values).first();
  return Number(row?.total ?? 0);
}

export async function searchPublicJobs(db, filters, options = {}) {
  const limit = options.limit ?? 50;
  const offset = options.offset ?? 0;
  const dataset = options.dataset ?? await resolvePublicDataset(db);
  const built = buildJobFilterSql(filters, dataset.condition);
  const jobsQuery = `
    SELECT
      id, title, institution, country, city, research_area, language,
      description, apply_url, source_url, deadline, posted_at,
      created_at, updated_at, employment_type, duration, tags_json, is_demo,
      source_language, source_key, source_name, last_verified_at,
      (SELECT COUNT(*) FROM job_sources js
       WHERE js.job_id = jobs.id AND js.observation_state = 'active') AS source_count
    FROM jobs
    ${built.whereClause}
    ORDER BY posted_at DESC, created_at DESC, id DESC
    LIMIT ? OFFSET ?
  `;
  const countQuery = `SELECT COUNT(*) AS total FROM jobs ${built.whereClause}`;
  const [jobsResult, countResult] = await db.batch([
    db.prepare(jobsQuery).bind(...built.values, limit, offset),
    db.prepare(countQuery).bind(...built.values),
  ]);
  const jobs = (jobsResult.results ?? []).map(mapPublicJobRow);
  const total = Number(countResult.results?.[0]?.total ?? 0);
  return {
    filters: built.filters,
    jobs,
    total,
    limit,
    offset,
    hasMore: offset + jobs.length < total,
    dataset,
  };
}
