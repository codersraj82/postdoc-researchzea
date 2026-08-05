import { consumeSourceQueue } from "./collectors/consumeSourceQueue.js";
import { scheduleDueSources } from "./collectors/scheduleSources.js";
import { filtersFromSearchParams, searchPublicJobs } from "./jobSearch.js";
import {
  cleanupSourceSearchData,
  handleSourceSearchPost,
  handleSourceSearchStatus,
  recoverStaleSourceSearchRequests,
  sourceSearchError,
} from "./sourceSearch.js";
import { handleVisitRequest } from "./visitors.js";

const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;
const DEFAULT_OFFSET = 0;
const MAX_OFFSET = 10000;

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
  const filters = filtersFromSearchParams(url.searchParams);
  const limit = parseInteger(url.searchParams.get("limit"), DEFAULT_LIMIT, 1, MAX_LIMIT);
  const offset = parseInteger(
    url.searchParams.get("offset"),
    DEFAULT_OFFSET,
    0,
    MAX_OFFSET,
  );

  try {
    const result = await searchPublicJobs(env.DB, filters, { limit, offset });

    return jsonResponse({
      ok: true,
      source: "d1",
      count: result.jobs.length,
      total: result.total,
      limit,
      offset,
      has_more: result.hasMore,
      filters: result.filters,
      jobs: result.jobs,
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
      const sourceSearchMatch = pathname.match(/^\/api\/source-search\/([^/]+)$/);

      if (!isApiRequest) {
        return env.ASSETS.fetch(request);
      }

      if (pathname === "/api/source-search") {
        if (request.method !== "POST") {
          return sourceSearchError(
            405,
            "METHOD_NOT_ALLOWED",
            "Only POST requests are supported for this endpoint.",
            { headers: { Allow: "POST" } },
          );
        }
        return handleSourceSearchPost(request, env);
      }

      if (sourceSearchMatch) {
        if (request.method !== "GET") {
          return sourceSearchError(
            405,
            "METHOD_NOT_ALLOWED",
            "Only GET requests are supported for this endpoint.",
            { headers: { Allow: "GET" } },
          );
        }
        return handleSourceSearchStatus(sourceSearchMatch[1], env);
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
    const scheduledAt = new Date(controller.scheduledTime);
    try {
      const recovery = await recoverStaleSourceSearchRequests(env.DB, scheduledAt);
      console.log(JSON.stringify({ event: "source_search_recovery", ...recovery }));
    } catch (error) {
      console.error(JSON.stringify({
        event: "source_search_recovery_failed",
        error: error instanceof Error ? error.name : "UnknownError",
      }));
    }
    try {
      const cleanup = await cleanupSourceSearchData(
        env.DB,
        scheduledAt,
      );
      console.log(JSON.stringify({ event: "source_search_cleanup", ...cleanup }));
    } catch (error) {
      console.error(JSON.stringify({
        event: "source_search_cleanup_failed",
        error: error instanceof Error ? error.name : "UnknownError",
      }));
    }
    try {
      const summary = await scheduleDueSources(env, controller, {
        now: scheduledAt,
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
