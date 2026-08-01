const trustPoints = [
  "Free to search",
  "No forced profile",
  "Direct application links",
  "Worldwide opportunities",
];

function CheckIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" className="size-4 shrink-0">
      <path
        fill="currentColor"
        d="M10 1.75a8.25 8.25 0 1 0 0 16.5 8.25 8.25 0 0 0 0-16.5Zm3.71 6.18-4.33 4.6a.75.75 0 0 1-1.08.01L6.23 10.5a.75.75 0 1 1 1.05-1.07l1.52 1.5 3.82-4.03a.75.75 0 1 1 1.09 1.03Z"
      />
    </svg>
  );
}

export default function HeroSection() {
  return (
    <section className="relative overflow-hidden pb-8 pt-16 sm:pb-10 sm:pt-20">
      <div className="hero-grid" aria-hidden="true" />
      <div className="page-shell relative">
        <div className="max-w-4xl">
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-cyan-300/20 bg-cyan-300/8 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.16em] text-cyan-200">
            <span className="size-1.5 rounded-full bg-cyan-300" />
            Phase 1 · Demonstration search
          </div>
          <h1 className="max-w-3xl text-balance text-4xl font-semibold leading-[1.04] tracking-[-0.045em] text-white sm:text-5xl lg:text-6xl">
            Find Recent Postdoc Positions Worldwide
          </h1>
          <p className="mt-4 text-2xl font-medium tracking-[-0.025em] text-cyan-300 sm:text-3xl">
            No Signup Required
          </p>
          <p className="mt-6 max-w-2xl text-pretty text-base leading-7 text-slate-300 sm:text-lg">
            Search research opportunities by keyword, field, country, language, and
            application deadline. Open the official application page directly.
          </p>
        </div>

        <ul className="mt-8 flex max-w-4xl flex-wrap gap-x-6 gap-y-3 text-sm text-slate-300">
          {trustPoints.map((point) => (
            <li key={point} className="flex items-center gap-2">
              <span className="text-emerald-300">
                <CheckIcon />
              </span>
              {point}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
