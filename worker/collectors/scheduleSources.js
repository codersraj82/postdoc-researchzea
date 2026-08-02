import { finalizeCollectionRun } from "./collectionRuns.js";
import { createSourceQueueMessage } from "./queueMessage.js";
import { getEnabledSources } from "./sourceRegistry.js";
import { isSourceDue } from "./sourceSchedule.js";

function sourceUrl(source) {
  return source.modes?.rss?.url
    ?? source.modes?.htmlFallback?.listingUrls?.[0]
    ?? "https://postdoc.researchzeal.com";
}

async function loadSourceStates(db) {
  const result = await db.prepare(
    `SELECT source_key, last_attempt_at, last_success_at, next_allowed_at,
            consecutive_failures, last_status
     FROM collector_sources`,
  ).all();
  return Object.fromEntries((result.results ?? []).map((row) => [row.source_key, row]));
}

async function ensureSourceState(db, source) {
  await db.prepare(
    `INSERT INTO collector_sources (source_key, source_name, source_url)
     VALUES (?, ?, ?)
     ON CONFLICT(source_key) DO UPDATE SET
       source_name = excluded.source_name,
       source_url = excluded.source_url`,
  ).bind(source.key, source.name, sourceUrl(source)).run();
}

export async function scheduleDueSources(env, controller, options = {}) {
  const now = options.now instanceof Date
    ? options.now
    : new Date(options.now ?? controller?.scheduledTime ?? Date.now());
  const uuid = options.uuid ?? (() => crypto.randomUUID());
  const runId = uuid();
  const sources = options.sources ?? getEnabledSources();
  await env.DB.prepare(
    `INSERT INTO collection_runs (id, trigger_type, started_at, status, summary_json)
     VALUES (?, 'scheduled', ?, 'running', ?)`,
  ).bind(
    runId,
    now.toISOString(),
    JSON.stringify({ cron: controller?.cron ?? null, messagesQueued: 0 }),
  ).run();

  const states = await loadSourceStates(env.DB);
  for (const source of sources) await ensureSourceState(env.DB, source);
  const dueSources = sources.filter((source) => isSourceDue(source, states[source.key], now));
  let messagesQueued = 0;
  const failures = [];

  for (const source of dueSources) {
    const message = createSourceQueueMessage({
      runId,
      sourceKey: source.key,
      scheduledAt: now,
      uuid,
    });
    await env.DB.prepare(
      `INSERT INTO source_runs (
         id, collection_run_id, message_id, source_key, source_name,
         source_type, status, scheduled_at, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?)`,
    ).bind(
      uuid(), runId, message.messageId, source.key, source.name, source.type,
      message.scheduledAt, now.toISOString(), now.toISOString(),
    ).run();
    try {
      await env.SOURCE_COLLECTION_QUEUE.send(message);
      messagesQueued += 1;
    } catch (error) {
      const summary = error instanceof Error ? error.message : "Queue send failed.";
      failures.push(source.key);
      await env.DB.prepare(
        `UPDATE source_runs SET status = 'failed', finished_at = ?,
           error_code = 'QUEUE_SEND_FAILED', error_summary = ?, updated_at = ?
         WHERE message_id = ? AND status = 'queued'`,
      ).bind(
        now.toISOString(), summary.replace(/[\r\n\t]+/g, " ").slice(0, 300),
        now.toISOString(), message.messageId,
      ).run();
    }
  }

  await env.DB.prepare(
    `UPDATE collection_runs SET sources_attempted = ?, error_count = ?, summary_json = ?
     WHERE id = ?`,
  ).bind(
    dueSources.length,
    failures.length,
    JSON.stringify({
      cron: controller?.cron ?? null,
      dueSources: dueSources.map((source) => source.key),
      messagesQueued,
      queueFailures: failures,
    }),
    runId,
  ).run();
  if (!dueSources.length || failures.length) await finalizeCollectionRun(env.DB, runId, now);

  return {
    runId,
    dueSources: dueSources.map((source) => source.key),
    messagesQueued,
    queueFailures: failures,
  };
}
