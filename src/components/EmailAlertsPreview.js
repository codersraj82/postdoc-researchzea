function MailIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="size-6">
      <path d="m3 6 9 7 9-7" stroke="currentColor" strokeWidth="1.7" />
      <rect x="3" y="5" width="18" height="14" rx="3" stroke="currentColor" strokeWidth="1.7" />
    </svg>
  );
}

export default function EmailAlertsPreview() {
  return (
    <section id="alerts" className="section-space scroll-mt-6">
      <div className="page-shell">
        <div className="overflow-hidden rounded-2xl border border-cyan-300/15 bg-[linear-gradient(135deg,rgba(10,31,49,0.98),rgba(11,24,44,0.98))]">
          <div className="grid gap-8 p-6 sm:p-8 lg:grid-cols-[1fr_0.9fr] lg:items-center lg:p-10">
            <div>
              <div className="mb-5 grid size-11 place-items-center rounded-xl bg-cyan-300/10 text-cyan-200">
                <MailIcon />
              </div>
              <p className="eyebrow">Planned for the next phase</p>
              <h2 className="mt-3 max-w-xl text-2xl font-semibold tracking-[-0.03em] text-white sm:text-3xl">
                Get matching Postdoc opportunities in your inbox
              </h2>
              <p className="mt-4 max-w-xl leading-7 text-slate-300">
                Weekly email alerts are planned for the next phase. A full profile will
                not be required.
              </p>
            </div>

            <div className="rounded-xl border border-white/10 bg-[#071321]/70 p-4 sm:p-5">
              <label htmlFor="alert-email" className="form-label">
                Email address
              </label>
              <input
                id="alert-email"
                className="form-control mt-2 disabled:cursor-not-allowed disabled:opacity-65"
                type="email"
                placeholder="researcher@example.com"
                disabled
              />
              <button
                type="button"
                className="mt-3 min-h-12 w-full cursor-not-allowed rounded-lg border border-white/10 bg-slate-700/65 px-4 text-sm font-semibold text-slate-300"
                disabled
              >
                Weekly alerts coming soon
              </button>
              <p className="mt-3 text-center text-xs leading-5 text-slate-400">
                Email collection is not active in this preview.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
