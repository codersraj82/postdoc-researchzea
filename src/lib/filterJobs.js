import { matchesSourceLanguage } from "./languages.js";

function normalize(value) {
  return String(value ?? "").trim().toLocaleLowerCase();
}

function startOfToday(date) {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  return result;
}

function deadlineDifferenceInDays(deadline, now) {
  const deadlineDate = new Date(`${deadline}T00:00:00`);
  return Math.round((deadlineDate - startOfToday(now)) / (24 * 60 * 60 * 1000));
}

export function isExpired(job, now = new Date()) {
  if (!job?.deadline) return false;
  return deadlineDifferenceInDays(job.deadline, now) < 0;
}

export function isClosingSoon(job, now = new Date()) {
  if (!job?.deadline) return false;
  const days = deadlineDifferenceInDays(job.deadline, now);
  return days >= 0 && days <= 7;
}

export function filterJobs(jobs, filters = {}, now = new Date()) {
  const keyword = normalize(filters.keyword);
  const country = normalize(filters.country);
  const researchArea = normalize(filters.researchArea);
  const language = normalize(filters.language);
  const deadline = normalize(filters.deadline);

  return [...(Array.isArray(jobs) ? jobs : [])]
    .filter((job) => !isExpired(job, now))
    .filter((job) => {
      if (!keyword) return true;
      const searchableText = [
        job.title,
        job.institution,
        job.country,
        job.city,
        job.research_area,
        job.description,
        ...(Array.isArray(job.tags) ? job.tags : []),
      ]
        .map(normalize)
        .join(" ");

      return searchableText.includes(keyword);
    })
    .filter((job) => !country || normalize(job.country) === country)
    .filter(
      (job) => !researchArea || normalize(job.research_area) === researchArea,
    )
    .filter((job) => !language || normalize(job.language) === language)
    .filter(
      (job) => !filters.sourceLanguage
        || matchesSourceLanguage(job, filters.sourceLanguage),
    )
    .filter((job) => {
      if (!deadline) return true;
      if (deadline === "no-deadline") return !job.deadline;
      if (!job.deadline) return false;

      const days = deadlineDifferenceInDays(job.deadline, now);
      if (deadline === "open") return days >= 0;
      if (deadline === "7") return days >= 0 && days <= 7;
      if (deadline === "30") return days >= 0 && days <= 30;
      if (deadline === "60") return days >= 0 && days <= 60;
      return true;
    })
    .sort(
      (first, second) =>
        new Date(second.posted_at || 0) - new Date(first.posted_at || 0),
    );
}

export function getFilterOptions(jobs, field) {
  return [...new Set((jobs || []).map((job) => job?.[field]).filter(Boolean))].sort(
    (first, second) => first.localeCompare(second),
  );
}
