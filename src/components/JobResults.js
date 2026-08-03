import EmptyResults from "@/components/EmptyResults";
import JobCard from "@/components/JobCard";

export default function JobResults({
  jobs,
  referenceDate,
  onClear,
  comparedIds,
  savedIds,
  onToggleCompare,
  onToggleSaved,
  preferenceMatches,
}) {
  const countLabel = `${jobs.length} ${jobs.length === 1 ? "position" : "positions"} found`;

  return (
    <div className="mt-10">
      <div className="flex flex-col gap-4 border-b border-white/8 pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="eyebrow">Recent opportunities</p>
          <h2 className="mt-2 text-2xl font-semibold tracking-[-0.03em] text-white sm:text-3xl">
            Postdoc positions
          </h2>
        </div>
        <p className="text-sm font-semibold text-cyan-200" aria-live="polite" aria-atomic="true">
          {countLabel}
        </p>
      </div>

      <div className="mt-5 space-y-4">
        {jobs.length ? (
          jobs.map((job) => (
            <JobCard
              key={job.id}
              job={job}
              referenceDate={referenceDate}
              isCompared={comparedIds.includes(job.id)}
              isSaved={savedIds.includes(job.id)}
              onToggleCompare={onToggleCompare}
              onToggleSaved={onToggleSaved}
              preferenceMatch={preferenceMatches.get(job.id)}
            />
          ))
        ) : (
          <EmptyResults onClear={onClear} />
        )}
      </div>
    </div>
  );
}
