export default function EmptyResults({ onClear }) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-600 bg-[#091625] px-6 py-14 text-center">
      <div className="mx-auto grid size-11 place-items-center rounded-full border border-white/10 bg-white/[0.04] text-slate-300">
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="size-5">
          <circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth="1.7" />
          <path d="m16 16 4 4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
        </svg>
      </div>
      <h3 className="mt-5 text-xl font-semibold text-white">No matching positions found</h3>
      <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-slate-400">
        Try removing a filter or searching with a broader research keyword.
      </p>
      <div className="mt-6 flex flex-col justify-center gap-3 sm:flex-row">
        <button type="button" onClick={onClear} className="primary-button min-h-11">
          Clear filters
        </button>
        <button type="button" onClick={onClear} className="secondary-button min-h-11">
          Return to all positions
        </button>
      </div>
    </div>
  );
}
