import EmptyResults from "@/components/EmptyResults";
import JobCard from "@/components/JobCard";

function LoadingPositions() {
  return (
    <div
      className="rounded-2xl border border-white/10 bg-[#091625] px-6 py-14 text-center text-sm text-slate-300"
      role="status"
    >
      Loading positions…
    </div>
  );
}

export default function JobResults({
  jobs,
  referenceDate,
  onClear,
  comparedIds,
  savedIds,
  onToggleCompare,
  onToggleSaved,
  preferenceMatches,
  countLabel,
  initialLoading,
  initialError,
  loadingMore,
  loadMoreError,
  hasMore,
  canLoadMore,
  onLoadMore,
  announcement,
  dataSource,
  emptyTitle,
}) {
  const showLoadMore = canLoadMore && hasMore && !loadMoreError;
  const allLoaded = canLoadMore && !hasMore && jobs.length > 0;

  return (
    <div className="mt-10" aria-busy={initialLoading || loadingMore}>
      <div className="flex flex-col gap-4 border-b border-white/8 pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="eyebrow">Recent opportunities</p>
          <h2 className="mt-2 text-2xl font-semibold tracking-[-0.03em] text-white sm:text-3xl">
            Postdoc positions
          </h2>
        </div>
        {!initialLoading && countLabel && (
          <p className="text-sm font-semibold text-cyan-200" aria-live="polite" aria-atomic="true">
            {countLabel}
          </p>
        )}
      </div>

      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {announcement}
      </p>

      {initialError && (
        <div
          className="mt-5 rounded-xl border border-amber-300/20 bg-amber-300/8 px-4 py-3 text-sm leading-6 text-amber-100"
          role="alert"
        >
          {initialError}
          {dataSource === "fallback" && " Controlled sample positions are shown below."}
        </div>
      )}

      <div className="mt-5 space-y-4">
        {initialLoading ? (
          <LoadingPositions />
        ) : jobs.length ? (
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
          <EmptyResults onClear={onClear} title={emptyTitle} />
        )}
      </div>

      {showLoadMore && (
        <div className="mt-7 flex justify-center">
          <button
            type="button"
            onClick={onLoadMore}
            disabled={loadingMore}
            className="primary-button min-h-12 w-full sm:w-auto sm:min-w-56 disabled:cursor-wait disabled:opacity-60"
          >
            {loadingMore ? "Loading more positions…" : "Load more positions"}
          </button>
        </div>
      )}

      {loadMoreError && (
        <div className="mt-6 text-center" role="alert">
          <p className="text-sm text-amber-200">{loadMoreError}</p>
          <button
            type="button"
            onClick={onLoadMore}
            className="secondary-button mt-3 min-h-11"
          >
            Retry loading more
          </button>
        </div>
      )}

      {allLoaded && (
        <p className="mt-7 text-center text-sm font-semibold text-slate-400">
          {countLabel}
        </p>
      )}
    </div>
  );
}
