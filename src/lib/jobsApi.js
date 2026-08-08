import { normalizePublicFilters } from "./jobFilters.js";

export const JOBS_PAGE_SIZE = 20;

const requiredStringFields = [
  "id",
  "title",
  "institution",
  "country",
  "research_area",
  "language",
  "description",
  "apply_url",
  "posted_at",
];

export class JobsApiError extends Error {
  constructor(message, options = {}) {
    super(message, options);
    this.name = "JobsApiError";
  }
}

function isJobRecord(job) {
  return job !== null
    && typeof job === "object"
    && requiredStringFields.every(
      (field) => typeof job[field] === "string" && job[field].trim().length > 0,
    )
    && Array.isArray(job.tags)
    && typeof job.is_demo === "boolean";
}

function isNonNegativeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

export function buildJobsApiUrl({ filters = {}, limit = JOBS_PAGE_SIZE, offset = 0 } = {}) {
  const normalized = normalizePublicFilters(filters);
  const params = new URLSearchParams({
    limit: String(limit),
    offset: String(offset),
  });
  for (const key of ["keyword", "country", "research_area", "language"]) {
    if (normalized[key]) params.set(key, normalized[key]);
  }
  if (normalized.deadline !== "any") params.set("deadline", normalized.deadline);
  return `/api/jobs?${params.toString()}`;
}

export function normalizeJobsPagePayload(payload) {
  if (
    payload === null
    || typeof payload !== "object"
    || payload.ok !== true
    || payload.source !== "d1"
    || !Array.isArray(payload.jobs)
    || !payload.jobs.every(isJobRecord)
    || !isNonNegativeInteger(payload.count)
    || !isNonNegativeInteger(payload.total)
    || !Number.isSafeInteger(payload.limit)
    || payload.limit < 1
    || !isNonNegativeInteger(payload.offset)
    || typeof payload.has_more !== "boolean"
    || payload.count !== payload.jobs.length
  ) {
    throw new JobsApiError("The jobs API returned an invalid response.");
  }
  return {
    jobs: payload.jobs,
    count: payload.count,
    total: payload.total,
    limit: payload.limit,
    offset: payload.offset,
    hasMore: payload.has_more,
    source: "d1",
    filters: normalizePublicFilters(payload.filters),
  };
}

export async function fetchJobsPage({
  filters = {},
  limit = JOBS_PAGE_SIZE,
  offset = 0,
  signal,
  fetchImpl = fetch,
} = {}) {
  const response = await fetchImpl(buildJobsApiUrl({ filters, limit, offset }), {
    method: "GET",
    headers: { Accept: "application/json" },
    cache: "no-store",
    signal,
  });
  if (!response.ok) {
    throw new JobsApiError("The positions database is temporarily unavailable.");
  }
  let payload;
  try {
    payload = await response.json();
  } catch (error) {
    throw new JobsApiError("The jobs API returned unreadable data.", { cause: error });
  }
  return normalizeJobsPagePayload(payload);
}
