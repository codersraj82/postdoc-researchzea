const steps = [
  "Create an optional profile",
  "Upload a resume with consent",
  "Review matched opportunities",
];

export default function AiMatchingPreview() {
  return (
    <section className="pb-20 sm:pb-24">
      <div className="page-shell">
        <div className="rounded-2xl border border-white/8 bg-[#0a1727] p-6 sm:p-8 lg:p-10">
          <div className="flex flex-col justify-between gap-6 md:flex-row md:items-start">
            <div className="max-w-2xl">
              <div className="flex items-center gap-3">
                <p className="eyebrow">Future capability</p>
                <span className="rounded-full border border-indigo-300/20 bg-indigo-300/10 px-2.5 py-1 text-[0.68rem] font-bold uppercase tracking-wider text-indigo-200">
                  Coming soon
                </span>
              </div>
              <h2 className="mt-4 text-2xl font-semibold tracking-[-0.03em] text-white sm:text-3xl">
                Optional AI matching, later
              </h2>
              <p className="mt-4 leading-7 text-slate-300">
                Future users will be able to create an optional profile and upload a
                resume with consent to receive better-matched Postdoc suggestions.
              </p>
            </div>
            <div className="rounded-lg border border-emerald-300/15 bg-emerald-300/6 px-4 py-3 text-sm leading-6 text-emerald-100 md:max-w-xs">
              Search will remain available without login. Resume upload will never be
              required for basic search.
            </div>
          </div>

          <ol className="mt-8 grid gap-3 md:grid-cols-3">
            {steps.map((step, index) => (
              <li
                key={step}
                className="flex items-center gap-4 rounded-xl border border-white/8 bg-[#071321] p-4"
              >
                <span className="grid size-8 shrink-0 place-items-center rounded-full border border-cyan-300/20 bg-cyan-300/8 text-sm font-bold text-cyan-200">
                  {index + 1}
                </span>
                <span className="text-sm font-medium text-slate-200">{step}</span>
              </li>
            ))}
          </ol>
          <p className="mt-5 text-sm text-slate-500">
            This feature is not included in Phase 1.
          </p>
        </div>
      </div>
    </section>
  );
}
