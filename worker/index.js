import { consumeSourceQueue } from "./collectors/consumeSourceQueue.js";
import {
  hasActiveCollectedJobs,
  normalizeDemoFlag,
  publicDatasetCondition,
} from "./collectors/publicJobs.js";
import { scheduleDueSources } from "./collectors/scheduleSources.js";
import { getSourceDefinition } from "./collectors/sourceRegistry.js";
import { handleVisitRequest } from "./visitors.js";

const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};

const INPUT_LIMITS = {
  keyword: 150,
  country: 100,
  researchArea: 150,
  language: 100,
};

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;
const DEFAULT_OFFSET = 0;
const MAX_OFFSET = 10000;
const DEADLINE_OPTIONS = new Set(["any", "7", "30", "60", "open", "none"]);

function jsonResponse(payload, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...JSON_HEADERS,
      ...extraHeaders,
    },
  });
}

function errorResponse(status, code, message, extraHeaders = {}) {
  return jsonResponse(
    {
      ok: false,
      error: { code, message },
    },
    status,
    extraHeaders,
  );
}

function normalizeInput(value, maximumLength) {
  return String(value ?? "").trim().slice(0, maximumLength);
}

function parseInteger(value, fallback, minimum, maximum) {
  if (value === null || !/^\d+$/.test(value.trim())) {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    return fallback;
  }

  return Math.min(Math.max(parsed, minimum), maximum);
}

function parseTags(value) {
  try {
    const tags = JSON.parse(value);
    return Array.isArray(tags) ? tags : [];
  } catch {
    return [];
  }
}

function mapJobRow(row) {
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

function escapeLikePattern(value) {
  return value.replace(/[\\%_]/g, "\\$&");
}

function getFilters(searchParams) {
  const keywordValue = searchParams.has("keyword")
    ? searchParams.get("keyword")
    : searchParams.get("q");
  const deadlineValue = normalizeInput(searchParams.get("deadline"), 20).toLowerCase();

  return {
    keyword: normalizeInput(keywordValue, INPUT_LIMITS.keyword),
    country: normalizeInput(searchParams.get("country"), INPUT_LIMITS.country),
    research_area: normalizeInput(
      searchParams.get("research_area"),
      INPUT_LIMITS.researchArea,
    ),
    language: normalizeInput(searchParams.get("language"), INPUT_LIMITS.language),
    deadline: DEADLINE_OPTIONS.has(deadlineValue) ? deadlineValue : "any",
  };
}

function buildJobFilters(filters, datasetCondition) {
  const conditions = [
    "is_active = 1",
    datasetCondition,
    "(deadline IS NULL OR date(deadline) >= date('now'))",
  ];
  const values = [];

  if (filters.keyword) {
    const keyword = `%${escapeLikePattern(filters.keyword.toLowerCase())}%`;
    const searchableColumns = [
      "title",
      "institution",
      "country",
      "city",
      "research_area",
      "language",
      "description",
      "tags_json",
    ];
    conditions.push(
      `(${searchableColumns.map((column) => `LOWER(COALESCE(${column}, '')) LIKE ? ESCAPE '\\'`).join(" OR ")})`,
    );
    values.push(...searchableColumns.map(() => keyword));
  }

  if (filters.country) {
    conditions.push("LOWER(TRIM(country)) = ?");
    values.push(filters.country.toLowerCase());
  }

  if (filters.research_area) {
    conditions.push("LOWER(TRIM(research_area)) = ?");
    values.push(filters.research_area.toLowerCase());
  }

  if (filters.language) {
    conditions.push("LOWER(language) LIKE ? ESCAPE '\\'");
    values.push(`%${escapeLikePattern(filters.language.toLowerCase())}%`);
  }

  if (["7", "30", "60"].includes(filters.deadline)) {
    conditions.push(
      "deadline IS NOT NULL AND date(deadline) BETWEEN date('now') AND date('now', ?)",
    );
    values.push(`+${filters.deadline} days`);
  } else if (filters.deadline === "open") {
    conditions.push("deadline IS NOT NULL AND date(deadline) >= date('now')");
  } else if (filters.deadline === "none") {
    conditions.push("deadline IS NULL");
  }

  return {
    whereClause: `WHERE ${conditions.join(" AND ")}`,
    values,
  };
}

function methodNotAllowed() {
  return errorResponse(
    405,
    "METHOD_NOT_ALLOWED",
    "Only GET requests are supported for this endpoint.",
    { Allow: "GET" },
  );
}

function optionsResponse() {
  return new Response(null, {
    status: 204,
    headers: {
      Allow: "GET",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

async function handleHealth(env) {
  try {
    const result = await env.DB.prepare("SELECT 1 AS healthy").first();
    if (Number(result?.healthy) !== 1) {
      throw new Error("D1 health query returned an unexpected result.");
    }

    return jsonResponse({
      ok: true,
      service: "Postdoc ResearchZeal API",
      database: "connected",
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("D1 health check failed.", error);
    return errorResponse(
      503,
      "DATABASE_UNAVAILABLE",
      "The jobs database is temporarily unavailable.",
    );
  }
}

async function handleJobs(url, env) {
  const filters = getFilters(url.searchParams);
  const limit = parseInteger(url.searchParams.get("limit"), DEFAULT_LIMIT, 1, MAX_LIMIT);
  const offset = parseInteger(
    url.searchParams.get("offset"),
    DEFAULT_OFFSET,
    0,
    MAX_OFFSET,
  );

  try {
    const useCollectedJobs = await hasActiveCollectedJobs(env.DB);
    const { whereClause, values } = buildJobFilters(
      filters,
      publicDatasetCondition(useCollectedJobs),
    );
    const jobsQuery = `
      SELECT
        id, title, institution, country, city, research_area, language,
        description, apply_url, source_url, deadline, posted_at,
        created_at, updated_at, employment_type, duration, tags_json, is_demo,
        source_language, source_key, source_name, last_verified_at,
        (SELECT COUNT(*) FROM job_sources js
         WHERE js.job_id = jobs.id AND js.observation_state = 'active') AS source_count
      FROM jobs
      ${whereClause}
      ORDER BY posted_at DESC, created_at DESC
      LIMIT ? OFFSET ?
    `;
    const countQuery = `SELECT COUNT(*) AS total FROM jobs ${whereClause}`;
    const jobsStatement = env.DB.prepare(jobsQuery).bind(...values, limit, offset);
    const countStatement = env.DB.prepare(countQuery).bind(...values);
    const [jobsResult, countResult] = await env.DB.batch([
      jobsStatement,
      countStatement,
    ]);
    const jobs = (jobsResult.results ?? []).map(mapJobRow);
    const total = Number(countResult.results?.[0]?.total ?? 0);

    return jsonResponse({
      ok: true,
      source: "d1",
      count: jobs.length,
      total,
      limit,
      offset,
      has_more: offset + jobs.length < total,
      filters,
      jobs,
    });
  } catch (error) {
    console.error("D1 jobs query failed.", error);
    return errorResponse(
      503,
      "DATABASE_UNAVAILABLE",
      "The jobs database is temporarily unavailable.",
    );
  }
}

const worker = {
  async fetch(request, env, ctx) {
    try {
      const url = new URL(request.url);
      const pathname = url.pathname.replace(/\/+$/, "") || "/";
      const isApiRequest = pathname === "/api" || pathname.startsWith("/api/");

      if (!isApiRequest) {
        return env.ASSETS.fetch(request);
      }

      if (
        pathname !== "/api/health"
        && pathname !== "/api/jobs"
        && pathname !== "/api/visit"
      ) {
        return errorResponse(
          404,
          "NOT_FOUND",
          "The requested API endpoint was not found.",
        );
      }

      if (pathname === "/api/visit") {
        return handleVisitRequest(request, env);
      }

      if (request.method === "OPTIONS") {
        return optionsResponse();
      }

      if (request.method !== "GET") {
        return methodNotAllowed();
      }

      if (pathname === "/api/health") {
        return handleHealth(env);
      }

      return handleJobs(url, env);
    } catch (error) {
      console.error("Unexpected Worker request failure.", error);
      return errorResponse(
        500,
        "INTERNAL_ERROR",
        "An unexpected server error occurred.",
      );
    }
  },

  async scheduled(controller, env, ctx) {
    void ctx;
    try {
      const summary = await scheduleDueSources(env, controller, {
        now: new Date(controller.scheduledTime),
      });
      console.log(JSON.stringify({
        event: "source_collection_scheduled",
        runId: summary.runId,
        dueSources: summary.dueSources,
        messagesQueued: summary.messagesQueued,
        queueFailures: summary.queueFailures,
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown scheduled collection failure.";
      console.error(JSON.stringify({
        event: "source_collection_schedule_failed",
        error: message.replace(/[\r\n\t]+/g, " ").slice(0, 300),
      }));
    }
  },

  async queue(batch, env, ctx) {
    const results = await consumeSourceQueue(batch, env, ctx);
    console.log(JSON.stringify({
      event: "source_collection_batch_completed",
      queue: batch.queue,
      results: results.map((result) => ({
        sourceKey: result.sourceKey,
        status: result.status,
      })),
    }));
  },
};

export default worker;
