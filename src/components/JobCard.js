import { formatDate } from "@/lib/formatDate";
import { isClosingSoon } from "@/lib/filterJobs";

function ExternalLinkIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="size-4 shrink-0">
      <path d="M11 4h5v5M16 4l-7 7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M8 6H5.75A1.75 1.75 0 0 0 4 7.75v6.5C4 15.22 4.78 16 5.75 16h6.5A1.75 1.75 0 0 0 14 14.25V12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export default function JobCard({ job, referenceDate }) {
  const closingSoon = isClosingSoon(job, new Date(referenceDate));

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
          <p className="mt-1 text-sm text-slate-400">
            {job.city}, {job.country} <span aria-hidden="true">·</span> {job.language}
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

      <p className="mt-5 max-w-4xl text-sm leading-6 text-slate-300 sm:text-[0.94rem]">
        {job.description}
      </p>

      <div className="mt-5 flex flex-wrap gap-2">
        {(job.tags || []).slice(0, 4).map((tag) => (
          <span key={tag} className="rounded-md border border-white/8 bg-white/[0.035] px-2.5 py-1.5 text-xs text-slate-300">
            {tag}
          </span>
        ))}
      </div>

      <div className="mt-6 flex flex-col gap-4 border-t border-white/8 pt-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-x-5 gap-y-2 text-xs text-slate-400">
          {job.employment_type && <span>{job.employment_type}</span>}
          {job.duration && <span>{job.duration}</span>}
          <span>Demonstration listing</span>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          {job.source_url && (
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
          <a
            href={job.apply_url}
            target="_blank"
            rel="noopener noreferrer"
            className="primary-button min-h-11"
            aria-label={`View and apply for ${job.title} (opens in a new tab)`}
          >
            View &amp; Apply
            <ExternalLinkIcon />
          </a>
        </div>
      </div>
    </article>
  );
}
