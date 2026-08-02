const deadlineOptions = [
  ["", "Any deadline"],
  ["7", "Within 7 days"],
  ["30", "Within 30 days"],
  ["60", "Within 60 days"],
  ["open", "Open deadline"],
  ["no-deadline", "No stated deadline"],
];

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="size-5">
      <circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth="1.8" />
      <path d="m16 16 4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function SourceStatus({ status, onRetryDatabase }) {
  const statusDetails = {
    loading: {
      label: "Checking live database",
      dotClassName: "animate-pulse bg-cyan-300",
    },
    d1: {
      label: "Live database",
      dotClassName: "bg-emerald-300",
    },
    fallback: {
      label: "Sample data fallback",
      dotClassName: "bg-amber-300",
    },
  };
  const details = statusDetails[status] ?? statusDetails.loading;

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
      <span
        className={`size-1.5 rounded-full ${details.dotClassName}`}
        aria-hidden="true"
      />
      <span role="status" aria-live="polite" aria-atomic="true">
        {details.label}
      </span>
      {status === "fallback" && (
        <button
          type="button"
          onClick={onRetryDatabase}
          className="rounded-md border border-amber-300/20 bg-amber-300/8 px-2 py-1 font-semibold text-amber-200 transition hover:border-amber-300/35 hover:bg-amber-300/12 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300"
        >
          Retry database
        </button>
      )}
    </div>
  );
}

function SelectField({ id, label, value, onChange, options, allLabel }) {
  return (
    <div>
      <label htmlFor={id} className="form-label">
        {label}
      </label>
      <div className="relative mt-2">
        <select id={id} className="form-control form-select" value={value} onChange={onChange}>
          <option value="">{allLabel}</option>
          {options.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
        <svg
          viewBox="0 0 20 20"
          aria-hidden="true"
          className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-slate-400"
        >
          <path fill="currentColor" d="m5.5 7.5 4.5 5 4.5-5h-9Z" />
        </svg>
      </div>
    </div>
  );
}

export default function SearchFilters({
  filters,
  options,
  onFilterChange,
  onClear,
  onSubmit,
  sourceStatus,
  onRetryDatabase,
}) {
  return (
    <form onSubmit={onSubmit} aria-label="Search Postdoc positions">
      <div>
        <label htmlFor="keyword" className="form-label">
          Keyword search
        </label>
        <div className="mt-2 grid gap-3 sm:grid-cols-[1fr_auto]">
          <div className="relative">
            <span
              className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400"
              aria-hidden="true"
            >
              <SearchIcon />
            </span>
            <input
              id="keyword"
              name="keyword"
              type="search"
              value={filters.keyword}
              onChange={(event) => onFilterChange("keyword", event.target.value)}
              className="form-control keyword-input min-h-13 sm:text-base"
              placeholder="Search by topic, skill, institution, or keyword"
              autoComplete="off"
            />
          </div>
          <button type="submit" className="primary-button min-h-13 sm:min-w-32">
            Search
          </button>
        </div>
        <p className="mt-2 text-xs leading-5 text-slate-500">
          Try Machine learning, Chemistry, Cancer biology, Renewable energy, Quantum
          computing, or Neuroscience.
        </p>
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <SelectField
          id="country"
          label="Country"
          value={filters.country}
          onChange={(event) => onFilterChange("country", event.target.value)}
          options={options.countries}
          allLabel="All countries"
        />
        <SelectField
          id="research-area"
          label="Research area"
          value={filters.researchArea}
          onChange={(event) => onFilterChange("researchArea", event.target.value)}
          options={options.researchAreas}
          allLabel="All research areas"
        />
        <SelectField
          id="language"
          label="Language"
          value={filters.language}
          onChange={(event) => onFilterChange("language", event.target.value)}
          options={options.languages}
          allLabel="All languages"
        />
        <div>
          <label htmlFor="deadline" className="form-label">
            Deadline
          </label>
          <div className="relative mt-2">
            <select
              id="deadline"
              className="form-control form-select"
              value={filters.deadline}
              onChange={(event) => onFilterChange("deadline", event.target.value)}
            >
              {deadlineOptions.map(([value, label]) => (
                <option key={label} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <svg
              viewBox="0 0 20 20"
              aria-hidden="true"
              className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-slate-400"
            >
              <path fill="currentColor" d="m5.5 7.5 4.5 5 4.5-5h-9Z" />
            </svg>
          </div>
        </div>
      </div>

      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-white/8 pt-5">
        <SourceStatus status={sourceStatus} onRetryDatabase={onRetryDatabase} />
        <button type="button" onClick={onClear} className="secondary-button min-h-10">
          Clear filters
        </button>
      </div>
    </form>
  );
}
