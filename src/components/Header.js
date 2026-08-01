export default function Header() {
  return (
    <header className="border-b border-white/8 bg-[#07111f]/85 backdrop-blur-md">
      <div className="page-shell flex min-h-20 items-center justify-between gap-5 py-3">
        <a
          href="#top"
          className="group flex min-w-0 items-center gap-3 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
          aria-label="Postdoc ResearchZeal home"
        >
          <span className="grid size-11 shrink-0 place-items-center rounded-xl border border-cyan-300/25 bg-cyan-300/10 text-sm font-black tracking-tight text-cyan-200 transition-colors group-hover:bg-cyan-300/15">
            RZ
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold tracking-[-0.01em] text-white sm:text-base">
              Postdoc ResearchZeal
            </span>
            <span className="block truncate text-[0.68rem] text-slate-400 sm:text-xs">
              Global research opportunities
            </span>
          </span>
        </a>

        <nav className="flex items-center gap-2 text-sm" aria-label="Primary navigation">
          <a className="nav-link hidden sm:inline-flex" href="#positions">
            Browse positions
          </a>
          <a className="nav-link hidden md:inline-flex" href="#alerts">
            Weekly alerts
          </a>
          <span className="rounded-full border border-emerald-300/20 bg-emerald-300/8 px-3 py-1.5 text-[0.68rem] font-semibold text-emerald-200 sm:text-xs">
            No signup required
          </span>
        </nav>
      </div>
    </header>
  );
}
