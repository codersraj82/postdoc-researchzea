function stableValue(value) {
  if (Array.isArray(value)) {
    return value.map(stableValue);
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, stableValue(value[key])]),
    );
  }

  return value ?? null;
}

export async function sha256(value) {
  const bytes = new TextEncoder().encode(String(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function stableStringify(value) {
  return JSON.stringify(stableValue(value));
}

export async function createContentHash(job) {
  const fields = {
    title: job.title,
    institution: job.institution,
    country: job.country,
    city: job.city,
    research_area: job.research_area,
    description: job.description,
    apply_url: job.apply_url,
    deadline: job.deadline,
    duration: job.duration,
    tags: job.tags,
  };

  return sha256(stableStringify(fields));
}
