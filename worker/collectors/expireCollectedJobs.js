const DAY_MS = 24 * 60 * 60 * 1000;

export function collectionStateFor(job, now = new Date()) {
  const today = now.toISOString().slice(0, 10);
  if (job.deadline && job.deadline < today) return "expired";
  if (!job.last_seen_at) return job.collection_state ?? "active";

  const ageDays = Math.floor((now.getTime() - new Date(job.last_seen_at).getTime()) / DAY_MS);
  if (ageDays >= 75) return "expired";
  if (ageDays >= 45) return "stale";
  return "active";
}

function changes(result) {
  return Number(result?.meta?.changes ?? 0);
}

export async function expireCollectedJobs(db, now = new Date()) {
  const today = now.toISOString().slice(0, 10);
  const staleCutoff = new Date(now.getTime() - 45 * DAY_MS).toISOString();
  const expiredCutoff = new Date(now.getTime() - 75 * DAY_MS).toISOString();
  const common = "origin_type = 'collected' AND is_demo = 0";
  const [deadlineResult, ageExpiredResult, staleResult] = await db.batch([
    db.prepare(
      `UPDATE jobs SET collection_state = 'expired', expiry_reason = 'past_deadline'
       WHERE ${common} AND collection_state != 'expired'
         AND deadline IS NOT NULL AND date(deadline) < date(?)`,
    ).bind(today),
    db.prepare(
      `UPDATE jobs SET collection_state = 'expired', expiry_reason = 'unseen_75_days'
       WHERE ${common} AND collection_state != 'expired'
         AND last_seen_at IS NOT NULL AND datetime(last_seen_at) <= datetime(?)`,
    ).bind(expiredCutoff),
    db.prepare(
      `UPDATE jobs SET collection_state = 'stale', expiry_reason = 'unseen_45_days'
       WHERE ${common} AND collection_state = 'active'
         AND last_seen_at IS NOT NULL AND datetime(last_seen_at) <= datetime(?)`,
    ).bind(staleCutoff),
  ]);

  return {
    expired: changes(deadlineResult) + changes(ageExpiredResult),
    stale: changes(staleResult),
  };
}
