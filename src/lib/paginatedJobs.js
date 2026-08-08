export function mergeJobsById(existingJobs, incomingJobs) {
  const merged = [...(Array.isArray(existingJobs) ? existingJobs : [])];
  const indexes = new Map(merged.map((job, index) => [job.id, index]));
  for (const job of Array.isArray(incomingJobs) ? incomingJobs : []) {
    if (!job?.id) continue;
    const existingIndex = indexes.get(job.id);
    if (existingIndex === undefined) {
      indexes.set(job.id, merged.length);
      merged.push(job);
    } else {
      merged[existingIndex] = { ...merged[existingIndex], ...job };
    }
  }
  return merged;
}

export function nextOffsetFromPage(page) {
  return Number(page?.offset ?? 0) + Number(page?.count ?? 0);
}

export function resultCountCopy({ displayed, total, source = "d1" }) {
  if (source === "fallback") {
    return `${displayed} sample ${displayed === 1 ? "position" : "positions"} shown.`;
  }
  if (total === 0) return "";
  if (total === 1) return "1 matching position.";
  if (displayed >= total) return `All ${total} matching positions are loaded.`;
  return `Showing ${displayed} of ${total} matching positions.`;
}

export function pageLoadedAnnouncement({ added, displayed, total }) {
  if (displayed >= total) return `All ${total} matching positions are loaded.`;
  return `${added} more ${added === 1 ? "position" : "positions"} loaded. Showing ${displayed} of ${total}.`;
}

export function isCurrentPageRequest({
  currentGeneration,
  requestGeneration,
  currentQueryKey,
  requestQueryKey,
  aborted = false,
}) {
  return aborted !== true
    && currentGeneration === requestGeneration
    && currentQueryKey === requestQueryKey;
}
