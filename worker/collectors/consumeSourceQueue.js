import { classifyPostdoc } from "./classifyPostdoc.js";
import { finalizeCollectionRun } from "./collectionRuns.js";
import { expireCollectedJobs } from "./expireCollectedJobs.js";
import { looksLikeUuid, validateSourceQueueMessage } from "./queueMessage.js";
import {
  getSourceAdapter,
  getSourceDefinition,
  getSourcePriority,
} from "./sourceRegistry.js";
import { isSourceDue } from "./sourceSchedule.js";
import {
  recordSourceFailure,
  recordSourceSuccess,
  sanitizeSourceError,
} from "./sourceHealth.js";
import { createD1JobRepository, storeCollectedJobs } from "./storeCollectedJobs.js";
import {
  finalizeSourceSearchRequest,
  markSourceSearchRunning,
  sourceRefreshDisposition,
} from "../sourceSearch.js";

const MAX_DELIVERY_ATTEMPTS = 4;
const PERMANENT_CODES = new Set([
  "CONTENT_SIGNAL_SEARCH_NO",
  "ROBOTS_DISALLOWED",
  "SOURCE_CONTENT_TYPE",
  "SOURCE_NOT_APPROVED",
  "SOURCE_SCHEMA_INVALID",
  "SOURCE_TOO_LARGE",
  "HTML_BUDGET_EXCEEDED",
]);

export function isTemporaryCollectionFailure(error) {
  if (error?.retryable === true) return true;
  if (error?.retryable === false || PERMANENT_CODES.has(String(error?.code ?? ""))) {
    return false;
  }
  return !/invalid|unsupported|configuration|adapter defect/i.test(String(error?.message ?? ""));
}

export function retryDelaySeconds(attempts) {
  return [60, 300, 900][Math.max(0, Math.min(Number(attempts) - 1, 2))];
}

export function sourceRunFailureStatus(attempts, temporary) {
  if (!temporary) return "failed";
  return Number(attempts) >= MAX_DELIVERY_ATTEMPTS ? "dead_lettered" : "running";
}

async function sourceState(db, sourceKey) {
  return db.prepare(
    `SELECT etag, last_modified, last_attempt_at, last_success_at,
            next_allowed_at, consecutive_failures, last_status
     FROM collector_sources WHERE source_key = ?`,
  ).bind(sourceKey).first();
}

async function sourceRun(db, messageId) {
  return db.prepare(
    "SELECT * FROM source_runs WHERE message_id = ? LIMIT 1",
  ).bind(messageId).first();
}

async function recordRejectedMessage(db, message, validation, now) {
  const body = message?.body && typeof message.body === "object" ? message.body : {};
  const messageId = typeof body.messageId === "string" && body.messageId.length <= 80
    ? body.messageId
    : `queue-${String(message?.id ?? crypto.randomUUID()).slice(0, 70)}`;
  const sourceKey = /^[a-z0-9][a-z0-9-]{2,79}$/.test(String(body.sourceKey ?? ""))
    ? body.sourceKey
    : "rejected-message";
  await db.prepare(
    `INSERT OR IGNORE INTO source_runs (
       id, collection_run_id, message_id, source_key, source_name, source_type,
       status, scheduled_at, finished_at, attempt_number, error_code,
       error_summary, created_at, updated_at
     ) VALUES (?, NULL, ?, ?, 'Rejected queue message', 'invalid', 'skipped',
       ?, ?, ?, 'INVALID_MESSAGE', ?, ?, ?)`,
  ).bind(
    crypto.randomUUID(), messageId, sourceKey, now, now,
    Number(message?.attempts ?? 1), validation.errors.join("; ").slice(0, 300),
    now, now,
  ).run();
}

async function markSourceRunSkipped(db, run, code, summary, now, mode = null) {
  await db.prepare(
    `UPDATE source_runs SET status = 'skipped', finished_at = ?,
       mode_used = COALESCE(?, mode_used), error_code = ?, error_summary = ?, updated_at = ?
     WHERE message_id = ? AND status IN ('queued', 'running')`,
  ).bind(now, mode, code, summary.slice(0, 300), now, run.message_id).run();
}

async function linkedSearchRequest(db, requestId) {
  if (!requestId) return null;
  return db.prepare(
    `SELECT id, collection_run_id, status
     FROM source_search_requests WHERE id = ? LIMIT 1`,
  ).bind(requestId).first();
}

async function searchRequestForRun(db, collectionRunId) {
  if (!collectionRunId) return null;
  return db.prepare(
    `SELECT id, collection_run_id, status
     FROM source_search_requests WHERE collection_run_id = ? LIMIT 1`,
  ).bind(collectionRunId).first();
}

async function finalizeRuns(
  db,
  run,
  searchRequestId,
  nowDate,
  finalizeCollection,
  finalizeSearch,
) {
  await finalizeCollection(db, run.collection_run_id, nowDate);
  if (searchRequestId) {
    await finalizeSearch(db, searchRequestId, nowDate);
  }
}

async function markRunning(db, messageId, attempts, now) {
  await db.prepare(
    `UPDATE source_runs SET status = 'running', started_at = COALESCE(started_at, ?),
       finished_at = NULL, attempt_number = ?, error_code = NULL,
       error_summary = NULL, updated_at = ?
     WHERE message_id = ? AND status NOT IN ('success', 'partial')`,
  ).bind(now, attempts, now, messageId).run();
}

async function markCompleted(db, messageId, status, metrics, response, now) {
  const stats = response.stats ?? {};
  await db.prepare(
    `UPDATE source_runs SET
       status = ?, mode_used = ?, finished_at = ?, attempt_number = ?,
       pages_requested = ?, pages_succeeded = ?, items_received = ?,
       items_accepted = ?, items_rejected = ?, jobs_inserted = ?,
       jobs_updated = ?, jobs_unchanged = ?, jobs_stale = ?, jobs_expired = ?,
       duplicates_merged = ?, error_code = NULL, error_summary = NULL,
       updated_at = ?
     WHERE message_id = ? AND status NOT IN ('success', 'partial')`,
  ).bind(
    status, response.mode ?? null, now, metrics.attempts,
    Number(stats.requests ?? 0), Number(stats.pagesSucceeded ?? stats.requests ?? 0),
    metrics.received, metrics.accepted, metrics.rejected,
    metrics.inserted, metrics.updated, metrics.unchanged,
    metrics.stale, metrics.expired, metrics.duplicatesMerged,
    now, messageId,
  ).run();
}

async function markFailure(db, messageId, status, error, attempts, now) {
  await db.prepare(
    `UPDATE source_runs SET status = ?, finished_at = ?, attempt_number = ?,
       error_code = ?, error_summary = ?, updated_at = ?
     WHERE message_id = ? AND status NOT IN ('success', 'partial')`,
  ).bind(
    status,
    status === "running" ? null : now,
    attempts,
    String(error?.code ?? "SOURCE_FAILED").slice(0, 80),
    sanitizeSourceError(error),
    now,
    messageId,
  ).run();
}

async function processMessage(message, env, options = {}) {
  const nowDate = options.now instanceof Date ? options.now : new Date();
  const now = nowDate.toISOString();
  const resolveSource = options.getSourceDefinition ?? getSourceDefinition;
  const resolveAdapter = options.getSourceAdapter ?? getSourceAdapter;
  const priorityFor = options.getSourcePriority ?? getSourcePriority;
  const finalize = options.finalizeCollectionRun ?? finalizeCollectionRun;
  const finalizeSearch = options.finalizeSourceSearchRequest ?? finalizeSourceSearchRequest;
  const markSearchRunning = options.markSourceSearchRunning ?? markSourceSearchRunning;
  const refreshDisposition = options.sourceRefreshDisposition ?? sourceRefreshDisposition;
  const expire = options.expireCollectedJobs ?? expireCollectedJobs;
  const validation = validateSourceQueueMessage(message.body, resolveSource);
  if (!validation.valid) {
    const recognizableMessageId = looksLikeUuid(message.body?.messageId)
      ? message.body.messageId
      : null;
    const existingRun = recognizableMessageId
      ? await sourceRun(env.DB, recognizableMessageId)
      : null;
    if (existingRun) {
      await markSourceRunSkipped(
        env.DB,
        existingRun,
        "INVALID_MESSAGE",
        validation.errors.join("; "),
        now,
        "invalid-message",
      );
      const related = await searchRequestForRun(env.DB, existingRun.collection_run_id);
      await finalizeRuns(
        env.DB,
        existingRun,
        related?.id,
        nowDate,
        finalize,
        finalizeSearch,
      );
    } else {
      await recordRejectedMessage(env.DB, message, validation, now);
    }
    message.ack();
    return { status: "rejected", sourceKey: null };
  }

  const source = validation.source;
  const adapter = resolveAdapter(source.key);
  const run = await sourceRun(env.DB, message.body.messageId);
  const onDemand = message.body.version === 2;
  const requestedSearchId = onDemand
    ? message.body.attemptContext.searchRequestId
    : null;
  if (!run
    || run.collection_run_id !== message.body.runId
    || run.source_key !== source.key) {
    if (run) {
      await markSourceRunSkipped(
        env.DB,
        run,
        "INVALID_MESSAGE",
        "Message runId does not match its queued source run.",
        now,
      );
      const related = onDemand
        ? await searchRequestForRun(env.DB, run.collection_run_id)
        : null;
      await finalizeRuns(env.DB, run, related?.id, nowDate, finalize, finalizeSearch);
    } else {
      await recordRejectedMessage(
        env.DB,
        message,
        { errors: ["message has no matching queued source run"] },
        now,
      );
    }
    message.ack();
    return { status: "rejected", sourceKey: source.key };
  }
  let searchRequest = null;
  if (onDemand) {
    searchRequest = await linkedSearchRequest(env.DB, requestedSearchId);
    if (!searchRequest
      || searchRequest.collection_run_id !== run.collection_run_id
      || !["queued", "running"].includes(searchRequest.status)) {
      await markSourceRunSkipped(
        env.DB,
        run,
        "INVALID_SEARCH_REQUEST",
        "On-demand message is not linked to an active approved-source search.",
        now,
      );
      const related = await searchRequestForRun(env.DB, run.collection_run_id);
      await finalizeRuns(env.DB, run, related?.id, nowDate, finalize, finalizeSearch);
      message.ack();
      return { status: "rejected", sourceKey: source.key };
    }
  }
  if (["success", "partial", "failed", "skipped", "dead_lettered"].includes(run.status)) {
    if (onDemand) {
      await finalizeRuns(env.DB, run, requestedSearchId, nowDate, finalize, finalizeSearch);
    }
    message.ack();
    return { status: "duplicate", sourceKey: source.key };
  }

  const attempts = Math.max(1, Number(message.attempts ?? 1));
  const state = await sourceState(env.DB, source.key);
  if (run.status === "queued") {
    if (onDemand) {
      const disposition = refreshDisposition(state, nowDate);
      if (!disposition.eligible) {
        await markSourceRunSkipped(
          env.DB,
          run,
          disposition.code,
          disposition.reliable
            ? "Source was refreshed successfully within the approved cooldown."
            : "Source refresh remains deferred by its approved health policy.",
          now,
          disposition.mode,
        );
        await finalizeRuns(
          env.DB,
          run,
          requestedSearchId,
          nowDate,
          finalize,
          finalizeSearch,
        );
        message.ack();
        return { status: "skipped", sourceKey: source.key };
      }
    } else if (!isSourceDue(source, state, new Date(message.body.scheduledAt))) {
      await markSourceRunSkipped(env.DB, run, "SOURCE_NOT_DUE", "Source is no longer due.", now);
      await finalize(env.DB, run.collection_run_id, nowDate);
      message.ack();
      return { status: "skipped", sourceKey: source.key };
    }
  }

  if (onDemand) await markSearchRunning(env.DB, requestedSearchId, nowDate);
  await markRunning(env.DB, message.body.messageId, attempts, now);
  try {
    const response = await adapter.collectSourceEntries(state ?? {}, options);
    const repository = options.repository ?? createD1JobRepository(env.DB);
    const acceptedJobs = [];
    let rejected = 0;
    let expired = 0;
    for (const entry of response.entries ?? []) {
      if (entry.closed) {
        expired += await repository.markObservationClosed?.(
          source.key,
          entry.sourceItemId || entry.guid,
          now,
        ) ?? 0;
        continue;
      }
      const classification = classifyPostdoc(entry);
      if (!classification.accepted) {
        rejected += 1;
        continue;
      }
      const job = await adapter.normalizeSourceEntry(entry, nowDate);
      const checked = adapter.validateSourceEntry(job);
      if (!checked.valid) {
        rejected += 1;
        continue;
      }
      acceptedJobs.push(job);
    }
    const stored = await storeCollectedJobs(acceptedJobs, repository, {
      getSourcePriority: priorityFor,
      sourcePriority: source.priority,
    });
    const lifecycle = await expire(env.DB, nowDate);
    expired += lifecycle.expired;
    const received = (response.entries ?? []).length;
    const partial = Number(response.stats?.skipped ?? 0) > 0 && acceptedJobs.length > 0;
    const metrics = {
      attempts,
      received,
      accepted: acceptedJobs.length,
      rejected,
      inserted: stored.inserted,
      updated: stored.updated,
      unchanged: stored.unchanged,
      stale: lifecycle.stale,
      expired,
      duplicatesMerged: stored.duplicatesMerged,
    };
    const status = partial ? "partial" : "success";
    await markCompleted(env.DB, message.body.messageId, status, metrics, response, now);
    await recordSourceSuccess(env.DB, source, {
      etag: response.etag,
      lastModified: response.lastModified,
      mode: response.mode,
      policyResult: response.policyResult,
      status,
    }, nowDate);
    await finalizeRuns(env.DB, run, requestedSearchId, nowDate, finalize, finalizeSearch);
    message.ack();
    return { status, sourceKey: source.key, metrics };
  } catch (error) {
    const temporary = isTemporaryCollectionFailure(error);
    const status = sourceRunFailureStatus(attempts, temporary);
    await markFailure(env.DB, message.body.messageId, status, error, attempts, now);
    await recordSourceFailure(env.DB, source, error, nowDate);
    if (temporary) {
      if (status === "dead_lettered") {
        await finalizeRuns(env.DB, run, requestedSearchId, nowDate, finalize, finalizeSearch);
      }
      message.retry({ delaySeconds: retryDelaySeconds(attempts) });
      return { status, sourceKey: source.key };
    }
    await finalizeRuns(env.DB, run, requestedSearchId, nowDate, finalize, finalizeSearch);
    message.ack();
    return { status, sourceKey: source.key };
  }
}

export async function consumeSourceQueue(batch, env, ctx, options = {}) {
  void ctx;
  const results = [];
  for (const message of batch.messages) {
    try {
      results.push(await processMessage(message, env, options));
    } catch (error) {
      console.error(JSON.stringify({
        event: "source_queue_unhandled_error",
        queueMessageId: String(message.id ?? "unknown").slice(0, 100),
        error: sanitizeSourceError(error),
      }));
      message.retry({ delaySeconds: retryDelaySeconds(message.attempts ?? 1) });
      results.push({ status: "retry", sourceKey: null });
    }
  }
  return results;
}

export { processMessage as processSourceQueueMessage };
