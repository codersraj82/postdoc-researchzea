import { formatDate } from "./formatDate.js";
import { areEquivalentJobUrls, normalizeComparableUrl } from "./jobPresentation.js";
import { getLanguageLabel } from "./languages.js";

export const MAX_COMPARISON_JOBS = 3;
export const NOT_STATED = "Not stated";

function cleanId(value) {
  return typeof value === "string" ? value.trim().slice(0, 160) : "";
}

export function normalizeStoredJobIds(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(cleanId).filter(Boolean))];
}

export function addComparisonJob(ids, jobId, maximum = MAX_COMPARISON_JOBS) {
  const current = normalizeStoredJobIds(ids);
  const id = cleanId(jobId);
  if (!id) return { ids: current, status: "invalid" };
  if (current.includes(id)) return { ids: current, status: "duplicate" };
  if (current.length >= maximum) return { ids: current, status: "limit" };
  return { ids: [...current, id], status: "added" };
}

export function removeComparisonJob(ids, jobId) {
  const id = cleanId(jobId);
  return normalizeStoredJobIds(ids).filter((currentId) => currentId !== id);
}

export function clearComparisonJobs() {
  return [];
}

export function reconcileStoredJobIds(ids, jobs) {
  const available = new Set(
    (Array.isArray(jobs) ? jobs : []).map((job) => cleanId(job?.id)).filter(Boolean),
  );
  return normalizeStoredJobIds(ids).filter((id) => available.has(id));
}

export function safeExternalJobUrl(value) {
  return normalizeComparableUrl(value) ? String(value).trim() : null;
}

export function hasDirectApplication(job) {
  const applyUrl = safeExternalJobUrl(job?.apply_url);
  if (!applyUrl) return false;
  const sourceUrl = safeExternalJobUrl(job?.source_url);
  return !sourceUrl || !areEquivalentJobUrls(applyUrl, sourceUrl);
}

function stated(value) {
  if (Array.isArray(value)) return value.filter(Boolean).join(", ") || NOT_STATED;
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : NOT_STATED;
  return String(value ?? "").trim() || NOT_STATED;
}

export function getComparisonRows(job, preferenceMatch = null) {
  const sourceUrl = safeExternalJobUrl(job?.source_url);
  const applyUrl = safeExternalJobUrl(job?.apply_url);
  const sourceName = stated(job?.source_name);
  const officialSource = job?.official_source === true
    ? `Yes${sourceName === NOT_STATED ? "" : ` - ${sourceName}`}`
    : job?.official_source === false
      ? `No${sourceName === NOT_STATED ? "" : ` - ${sourceName}`}`
      : NOT_STATED;
  const preferenceValue = preferenceMatch
    ? `${preferenceMatch.score}/100 - ${preferenceMatch.reasons.join("; ") || "No weighted criteria matched"}`
    : NOT_STATED;

  return [
    { key: "position", label: "Position", value: stated(job?.title) },
    { key: "institution", label: "Institution", value: stated(job?.institution) },
    { key: "city", label: "City", value: stated(job?.city) },
    { key: "country", label: "Country", value: stated(job?.country) },
    { key: "research", label: "Research areas", value: stated(job?.research_area) },
    { key: "source-language", label: "Source language", value: getLanguageLabel(job?.source_language) },
    { key: "posted", label: "Posted date", value: job?.posted_at ? formatDate(job.posted_at) : NOT_STATED },
    { key: "deadline", label: "Deadline", value: job?.deadline ? formatDate(job.deadline) : NOT_STATED },
    { key: "duration", label: "Duration", value: stated(job?.duration) },
    { key: "employment", label: "Employment type", value: stated(job?.employment_type) },
    { key: "salary", label: "Salary or funding", value: stated(job?.salary ?? job?.funding) },
    { key: "official", label: "Official source", value: officialSource },
    { key: "direct", label: "Direct application available", value: hasDirectApplication(job) ? "Yes" : "No" },
    { key: "sources", label: "Source count", value: stated(job?.source_count) },
    { key: "verified", label: "Last verified", value: job?.last_verified_at ? formatDate(job.last_verified_at) : NOT_STATED },
    { key: "preference", label: "Preference match", value: preferenceValue },
    {
      key: "source-action",
      label: "Source action",
      value: sourceUrl
        ? (job?.official_source === true ? "View official source" : "View original source")
        : NOT_STATED,
      href: sourceUrl,
    },
    {
      key: "apply-action",
      label: "Apply action",
      value: applyUrl
        ? (areEquivalentJobUrls(applyUrl, sourceUrl) ? "View application details" : "View and apply")
        : NOT_STATED,
      href: applyUrl,
    },
  ];
}
