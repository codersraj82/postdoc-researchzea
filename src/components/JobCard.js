import { formatDate } from "@/lib/formatDate";
import { isClosingSoon } from "@/lib/filterJobs";
import {
  areEquivalentJobUrls,
  formatJobLocation,
  isDemonstrationJob,
} from "@/lib/jobPresentation";
import { getLanguageLabel } from "@/lib/languages";

function ExternalLinkIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="size-4 shrink-0">
      <path d="M11 4h5v5M16 4l-7 7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M8 6H5.75A1.75 1.75 0 0 0 4 7.75v6.5C4 15.22 4.78 16 5.75 16h6.5A1.75 1.75 0 0 0 14 14.25V12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export default function JobCard({
  job,
  referenceDate,
  isCompared,
  isSaved,
  onToggleCompare,
  onToggleSaved,
  preferenceMatch,
}) {
  const closingSoon = isClosingSoon(job, new Date(referenceDate));
  const location = formatJobLocation(job);
  const isDemo = isDemonstrationJob(job);
  const hasSingleApplicationDestination = areEquivalentJobUrls(
    job.apply_url,
    job.source_url,
  );

  return (
    <article className="job-card">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-cyan-300/20 bg-cyan-300/8 px-2.5 py-1 text-[0.68rem] font-bold uppercase tracking-[0.1em] text-cyan-200">
              {job.research_area}
            </span>
            <span className="rounded-full border border-emerald-300/15 bg-emerald-300/7 px-2.5 py-1 text-[0.68rem] font-semibold text-emerald-200">
              Open
            </span>
          </div>
          <h3 className="mt-4 text-xl font-semibold leading-snug tracking-[-0.025em] text-white sm:text-[1.35rem]">
            {job.title}
          </h3>
          <p className="mt-2 font-medium text-slate-300">{job.institution}</p>
          {location && <p className="mt-1 text-sm text-slate-400">{location}</p>}
          <p className="mt-1 text-xs text-slate-500">
            Source language: {getLanguageLabel(job.source_language)}
          </p>
        </div>

        <div className="grid shrink-0 grid-cols-2 gap-3 lg:min-w-52 lg:grid-cols-1">
          <div className="rounded-lg border border-white/8 bg-[#071321] px-3 py-2.5">
            <p className="text-[0.65rem] font-bold uppercase tracking-[0.13em] text-slate-500">
              Posted
            </p>
            <p className="mt-1 text-sm font-medium text-slate-200">
              {formatDate(job.posted_at)}
            </p>
          </div>
          <div className="rounded-lg border border-white/8 bg-[#071321] px-3 py-2.5">
            <p className="text-[0.65rem] font-bold uppercase tracking-[0.13em] text-slate-500">
              Deadline
            </p>
            <p className={`mt-1 text-sm font-medium ${closingSoon ? "text-amber-300" : "text-slate-200"}`}>
              {closingSoon ? "Closing soon · " : ""}
              {formatDate(job.deadline)}
            </p>
          </div>
        </div>
      </div>

      <p className="mt-5 line-clamp-5 max-w-4xl text-sm leading-6 text-slate-300 sm:text-[0.94rem]">
        {job.description}
      </p>

      <div className="mt-5 flex flex-wrap gap-2">
        {(job.tags || []).slice(0, 4).map((tag) => (
          <span key={tag} className="rounded-md border border-white/8 bg-white/[0.035] px-2.5 py-1.5 text-xs text-slate-300">
            {tag}
          </span>
        ))}
      </div>

      {preferenceMatch && (
        <details className="mt-5 rounded-lg border border-cyan-300/15 bg-cyan-300/[0.045] px-3 py-2.5">
          <summary className="cursor-pointer text-sm font-semibold text-cyan-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300">
            Preference match: {preferenceMatch.score}/100
          </summary>
          <ul className="mt-2 space-y-1 text-xs leading-5 text-slate-300">
            {preferenceMatch.reasons.length ? preferenceMatch.reasons.map((reason) => (
              <li key={reason}>- {reason}</li>
            )) : <li>No selected preference earned points for this listing.</li>}
          </ul>
        </details>
      )}

      <div className="mt-6 flex flex-col gap-4 border-t border-white/8 pt-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-x-5 gap-y-2 text-xs text-slate-400">
          {job.employment_type && <span>{job.employment_type}</span>}
          {job.duration && <span>{job.duration}</span>}
          {isDemo && <span>Demonstration listing</span>}
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
          {!isDemo && (
            <>
              <button
                type="button"
                className="secondary-button min-h-11"
                onClick={() => onToggleSaved(job.id)}
                aria-pressed={isSaved}
              >
                {isSaved ? "Saved" : "Save"}
              </button>
              <button
                type="button"
                className="secondary-button min-h-11"
                onClick={() => onToggleCompare(job.id)}
                aria-pressed={isCompared}
              >
                {isCompared ? "Remove from compare" : "Compare"}
              </button>
            </>
          )}
          {job.source_url && !hasSingleApplicationDestination && (
            <a
              href={job.source_url}
              target="_blank"
              rel="noopener noreferrer"
              className="source-link min-h-11"
              aria-label={`View original source for ${job.title} (opens in a new tab)`}
            >
              View original source
              <ExternalLinkIcon />
            </a>
          )}
          {job.apply_url && (
            <a
              href={job.apply_url}
              target="_blank"
              rel="noopener noreferrer"
              className="primary-button min-h-11"
              aria-label={hasSingleApplicationDestination
                ? `View application details for ${job.title} (opens in a new tab)`
                : `View and apply for ${job.title} (opens in a new tab)`}
            >
              {hasSingleApplicationDestination ? "View application details" : "View & Apply"}
              <ExternalLinkIcon />
            </a>
          )}
        </div>
      </div>
    </article>
  );
}
