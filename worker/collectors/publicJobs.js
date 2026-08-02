export function normalizeDemoFlag(value) {
  return value === true || value === 1;
}

export function publicDatasetCondition(hasActiveCollectedJobs) {
  if (hasActiveCollectedJobs) {
    return "origin_type = 'collected' AND is_demo = 0 AND collection_state = 'active'";
  }
  return "origin_type = 'seed' AND is_demo = 1 AND collection_state = 'active'";
}

export async function hasActiveCollectedJobs(db) {
  const row = await db
    .prepare(
      `SELECT 1 AS found
       FROM jobs
       WHERE is_active = 1
         AND origin_type = 'collected'
         AND is_demo = 0
         AND collection_state = 'active'
         AND (deadline IS NULL OR date(deadline) >= date('now'))
       LIMIT 1`,
    )
    .first();
  return Number(row?.found) === 1;
}
