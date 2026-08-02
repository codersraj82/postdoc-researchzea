const JOBS_API_URL = "/api/jobs?limit=100";

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

function isJobRecord(job) {
  return (
    job !== null &&
    typeof job === "object" &&
    requiredStringFields.every(
      (field) => typeof job[field] === "string" && job[field].trim().length > 0,
    ) &&
    Array.isArray(job.tags)
  );
}

function isValidJobsResponse(payload) {
  return (
    payload !== null &&
    typeof payload === "object" &&
    payload.ok === true &&
    payload.source === "d1" &&
    Array.isArray(payload.jobs) &&
    payload.jobs.every(isJobRecord)
  );
}

export async function loadJobs(fallbackJobs, { signal } = {}) {
  const safeFallbackJobs = Array.isArray(fallbackJobs) ? fallbackJobs : [];

  try {
    const response = await fetch(JOBS_API_URL, {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
      cache: "no-store",
      signal,
    });

    if (!response.ok) {
      throw new Error("The jobs API returned an unsuccessful response.");
    }

    const payload = await response.json();
    if (!isValidJobsResponse(payload)) {
      throw new Error("The jobs API returned an invalid response.");
    }

    return {
      jobs: payload.jobs,
      source: "d1",
    };
  } catch (error) {
    if (error?.name === "AbortError") {
      throw error;
    }

    return {
      jobs: safeFallbackJobs,
      source: "fallback",
    };
  }
}
