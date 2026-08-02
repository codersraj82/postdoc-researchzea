import { classifyPostdoc } from "./classifyPostdoc.js";
import { collectSourceEntries } from "./collectSourceEntries.js";
import { expireCollectedJobs } from "./expireCollectedJobs.js";
import { sha256 } from "./hashing.js";
import { normalizeJob } from "./normalizeJob.js";
import { getEnabledSources } from "./sourceRegistry.js";
import { createD1JobRepository, storeCollectedJobs } from "./storeCollectedJobs.js";
import { validateCollectedJob } from "./validateCollectedJob.js";

function sanitizeError(error) {
  const message = error instanceof Error ? error.message : "Unknown collection error.";
  return message.replace(/[\r\n\t]+/g, " ").slice(0, 300);
}

async function createRun(db, run) {
  await db.prepare(
    `INSERT INTO collection_runs (id, trigger_type, started_at, status)
     VALUES (?, ?, ?, 'running')`,
  ).bind(run.id, run.triggerType, run.startedAt).run();
}

async function sourceState(db, source) {
  return db.prepare(
    `SELECT etag, last_modified FROM collector_sources WHERE source_key = ?`,
  ).bind(source.key).first();
}

async function saveSourceState(db, source, values) {
  await db.prepare(
    `INSERT INTO collector_sources (
       source_key, source_name, source_url, etag, last_modified,
       last_attempt_at, last_success_at, last_status, last_error,
       last_mode, policy_result
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(source_key) DO UPDATE SET
       source_name = excluded.source_name, source_url = excluded.source_url,
       etag = COALESCE(excluded.etag, collector_sources.etag),
       last_modified = COALESCE(excluded.last_modified, collector_sources.last_modified),
       last_attempt_at = excluded.last_attempt_at,
       last_success_at = COALESCE(excluded.last_success_at, collector_sources.last_success_at),
       last_status = excluded.last_status, last_error = excluded.last_error,
       last_mode = excluded.last_mode, policy_result = excluded.policy_result`,
  ).bind(
    source.key, source.name, source.modes.rss.url, values.etag ?? null,
    values.lastModified ?? null, values.attemptedAt,
    values.succeededAt ?? null, values.status, values.error ?? null,
    values.mode ?? null,
    values.policyResult ? JSON.stringify(values.policyResult).slice(0, 1000) : null,
  ).run();
}

async function finishRun(db, summary) {
  const safeSummary = {
    runId: summary.runId,
    status: summary.status,
    cron: summary.cron,
    sourceResults: summary.sourceResults,
    durationMs: summary.durationMs,
  };
  await db.prepare(
    `UPDATE collection_runs SET
       finished_at = ?, status = ?, sources_attempted = ?, sources_succeeded = ?,
       items_received = ?, items_accepted = ?, items_rejected = ?,
       jobs_inserted = ?, jobs_updated = ?, jobs_unchanged = ?, jobs_expired = ?,
       error_count = ?, summary_json = ?
     WHERE id = ?`,
  ).bind(
    summary.finishedAt, summary.status, summary.sourcesAttempted,
    summary.sourcesSucceeded, summary.itemsReceived, summary.itemsAccepted,
    summary.itemsRejected, summary.jobsInserted, summary.jobsUpdated,
    summary.jobsUnchanged, summary.jobsExpired, summary.errorCount,
    JSON.stringify(safeSummary), summary.runId,
  ).run();
}

export async function runCollection(env, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date(options.now ?? Date.now());
  const startedAtMs = Date.now();
  const startedAt = now.toISOString();
  const runId = `collection-${(await sha256(`${startedAt}\n${options.triggerType ?? "scheduled"}`)).slice(0, 32)}`;
  const sources = options.sources ?? getEnabledSources();
  const summary = {
    runId,
    triggerType: options.triggerType ?? "scheduled",
    cron: options.cron ?? null,
    startedAt,
    finishedAt: null,
    status: "running",
    sourcesAttempted: 0,
    sourcesSucceeded: 0,
    itemsReceived: 0,
    itemsAccepted: 0,
    itemsRejected: 0,
    jobsInserted: 0,
    jobsUpdated: 0,
    jobsUnchanged: 0,
    jobsExpired: 0,
    errorCount: 0,
    durationMs: 0,
    sourceResults: [],
  };
  await createRun(env.DB, { id: runId, triggerType: summary.triggerType, startedAt });
  const repository = options.repository ?? createD1JobRepository(env.DB);

  for (const source of sources) {
    summary.sourcesAttempted += 1;
    const sourceResult = {
      key: source.key,
      status: "failed",
      mode: null,
      received: 0,
      accepted: 0,
      rejected: 0,
    };
    try {
      const state = await sourceState(env.DB, source);
      const response = await collectSourceEntries(source, state, {
        fetchImpl: options.fetchImpl,
        fetchPage: options.fetchPage,
        sleep: options.sleep,
        timeoutMs: options.timeoutMs,
        maximumBytes: options.maximumBytes,
        maxListingPages: options.maxListingPages,
        maxDetailPages: options.maxDetailPages,
      });
      sourceResult.mode = response.mode;
      if (response.fallbackReason) sourceResult.fallbackReason = response.fallbackReason;
      if (response.stats) sourceResult.crawl = response.stats;
      if (response.unchanged) {
        sourceResult.status = "unchanged";
        summary.sourcesSucceeded += 1;
        await saveSourceState(env.DB, source, {
          attemptedAt: startedAt, succeededAt: startedAt, status: "unchanged",
          etag: response.etag, lastModified: response.lastModified,
          mode: response.mode, policyResult: response.policyResult,
        });
        summary.sourceResults.push(sourceResult);
        continue;
      }

      const entries = response.entries;
      sourceResult.received = entries.length;
      summary.itemsReceived += entries.length;
      const acceptedJobs = [];
      for (const entry of entries) {
        const classification = classifyPostdoc(entry);
        if (!classification.accepted) {
          sourceResult.rejected += 1;
          summary.itemsRejected += 1;
          continue;
        }
        const job = await normalizeJob(entry, source, now);
        const validation = validateCollectedJob(job);
        if (!validation.valid) {
          sourceResult.rejected += 1;
          summary.itemsRejected += 1;
          continue;
        }
        acceptedJobs.push(job);
        sourceResult.accepted += 1;
        summary.itemsAccepted += 1;
      }
      const stored = await storeCollectedJobs(acceptedJobs, repository);
      summary.jobsInserted += stored.inserted;
      summary.jobsUpdated += stored.updated;
      summary.jobsUnchanged += stored.unchanged;
      sourceResult.status = "success";
      summary.sourcesSucceeded += 1;
      await saveSourceState(env.DB, source, {
        attemptedAt: startedAt, succeededAt: startedAt, status: "success",
        etag: response.etag, lastModified: response.lastModified,
        mode: response.mode, policyResult: response.policyResult,
      });
    } catch (error) {
      summary.errorCount += 1;
      sourceResult.error = sanitizeError(error);
      await saveSourceState(env.DB, source, {
        attemptedAt: startedAt, status: "failed", error: sourceResult.error,
        mode: sourceResult.mode,
      });
    }
    summary.sourceResults.push(sourceResult);
  }

  try {
    const lifecycle = await expireCollectedJobs(env.DB, now);
    summary.jobsExpired = lifecycle.expired;
  } catch (error) {
    summary.errorCount += 1;
    summary.sourceResults.push({ key: "lifecycle", status: "failed", error: sanitizeError(error) });
  }
  summary.status = summary.sourcesSucceeded === summary.sourcesAttempted
    ? "success"
    : summary.sourcesSucceeded > 0
      ? "partial"
      : "failed";
  summary.finishedAt = new Date().toISOString();
  summary.durationMs = Date.now() - startedAtMs;
  await finishRun(env.DB, summary);
  return summary;
}
