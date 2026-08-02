const TERMINAL_SOURCE_STATUSES = new Set([
  "success",
  "partial",
  "failed",
  "skipped",
  "dead_lettered",
]);

export function aggregateSourceRunStatus(sourceRuns) {
  if (!sourceRuns.length) return "skipped";
  if (sourceRuns.some((run) => !TERMINAL_SOURCE_STATUSES.has(run.status))) return "running";
  const successes = sourceRuns.filter((run) => ["success", "partial"].includes(run.status)).length;
  if (successes === sourceRuns.length && sourceRuns.every((run) => run.status === "success")) {
    return "success";
  }
  if (successes > 0) return "partial";
  if (sourceRuns.every((run) => run.status === "skipped")) return "skipped";
  return "failed";
}

function sum(rows, field) {
  return rows.reduce((total, row) => total + Number(row[field] ?? 0), 0);
}

export async function finalizeCollectionRun(db, collectionRunId, now = new Date()) {
  if (!collectionRunId) return { status: "skipped", finalized: false };
  const result = await db.prepare(
    `SELECT status, items_received, items_accepted, items_rejected,
            jobs_inserted, jobs_updated, jobs_unchanged, jobs_expired,
            error_code
     FROM source_runs
     WHERE collection_run_id = ?
     ORDER BY source_key`,
  ).bind(collectionRunId).all();
  const rows = result.results ?? [];
  const status = aggregateSourceRunStatus(rows);
  if (status === "running") return { status, finalized: false };
  const summary = {
    sourceStatuses: rows.map((row) => row.status),
    finalizedBy: "source-run-aggregate",
  };
  const update = await db.prepare(
    `UPDATE collection_runs SET
       finished_at = ?, status = ?, sources_attempted = ?, sources_succeeded = ?,
       items_received = ?, items_accepted = ?, items_rejected = ?,
       jobs_inserted = ?, jobs_updated = ?, jobs_unchanged = ?, jobs_expired = ?,
       error_count = ?, summary_json = ?
     WHERE id = ? AND status = 'running'`,
  ).bind(
    now.toISOString(),
    status,
    rows.length,
    rows.filter((row) => row.status === "success").length,
    sum(rows, "items_received"),
    sum(rows, "items_accepted"),
    sum(rows, "items_rejected"),
    sum(rows, "jobs_inserted"),
    sum(rows, "jobs_updated"),
    sum(rows, "jobs_unchanged"),
    sum(rows, "jobs_expired"),
    rows.filter((row) => row.error_code).length,
    JSON.stringify(summary),
    collectionRunId,
  ).run();
  return {
    status,
    finalized: Number(update?.meta?.changes ?? 0) === 1,
  };
}

export { TERMINAL_SOURCE_STATUSES };
