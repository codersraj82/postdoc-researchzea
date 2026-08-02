import { safeHttpUrl } from "./text.js";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function validDate(value) {
  if (!ISO_DATE.test(value)) return false;
  return new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value;
}

export function validateCollectedJob(job) {
  const errors = [];
  const requiredText = [
    "id",
    "title",
    "institution",
    "country",
    "research_area",
    "language",
    "description",
    "source_language",
    "original_title",
    "original_description",
    "source_key",
    "source_name",
    "source_item_id",
    "content_hash",
    "canonical_url",
  ];

  for (const field of requiredText) {
    if (!String(job?.[field] ?? "").trim()) errors.push(`${field} is required`);
  }
  if (!safeHttpUrl(job?.source_url)) errors.push("source_url must be HTTP or HTTPS");
  if (!safeHttpUrl(job?.canonical_url)) errors.push("canonical_url must be HTTP or HTTPS");
  if (!safeHttpUrl(job?.apply_url)) errors.push("apply_url must be HTTP or HTTPS");
  if (!validDate(job?.posted_at ?? "")) errors.push("posted_at must be a valid ISO date");
  if (job?.deadline && !validDate(job.deadline)) errors.push("deadline must be a valid ISO date");
  if (String(job?.description ?? "").length > 1200) errors.push("description is too long");
  if (!Array.isArray(job?.tags) || job.tags.length > 10 || job.tags.some((tag) => !tag || tag.length > 50)) {
    errors.push("tags are invalid");
  }
  if (job?.origin_type !== "collected" || Number(job?.is_demo) !== 0) {
    errors.push("collected record markers are invalid");
  }
  if (!["rss", "html"].includes(job?.source_type)) errors.push("source_type is invalid");

  return { valid: errors.length === 0, errors };
}
