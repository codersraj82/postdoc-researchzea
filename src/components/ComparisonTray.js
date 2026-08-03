export default function ComparisonTray({ jobs, message, onCompare, onRemove, onClear }) {
  if (!jobs.length) return null;

  return (
    <aside
      className="fixed inset-x-0 bottom-0 z-40 border-t border-cyan-300/20 bg-[#07111f]/96 shadow-[0_-18px_45px_rgba(1,7,15,0.45)] backdrop-blur-xl"
      aria-label="Selected positions for comparison"
    >
      <div className="page-shell flex flex-col gap-3 py-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-bold uppercase tracking-[0.12em] text-cyan-200">
            Compare {jobs.length} of 3
          </p>
          <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
            {jobs.map((job) => (
              <span key={job.id} className="inline-flex shrink-0 items-center gap-2 rounded-full border border-white/10 bg-white/[0.055] py-1 pl-3 pr-1 text-xs text-slate-200">
                <span className="max-w-48 truncate">{job.title}</span>
                <button
                  type="button"
                  onClick={() => onRemove(job.id)}
                  className="grid size-7 place-items-center rounded-full text-slate-400 hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-cyan-300"
                  aria-label={`Remove ${job.title} from comparison`}
                >
                  &times;
                </button>
              </span>
            ))}
          </div>
          <p className="mt-1 min-h-4 text-xs text-amber-200" role="status" aria-live="polite">
            {message}
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <button type="button" className="secondary-button min-h-11" onClick={onClear}>
            Clear all
          </button>
          <button type="button" className="primary-button min-h-11 flex-1 sm:flex-none" onClick={onCompare}>
            Compare
          </button>
        </div>
      </div>
    </aside>
  );
}
