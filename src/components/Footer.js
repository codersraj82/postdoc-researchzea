export default function Footer() {
  return (
    <footer className="border-t border-white/8 bg-[#050e19]">
      <div className="page-shell grid gap-8 py-10 sm:grid-cols-[1fr_auto] sm:items-end">
        <div>
          <div className="flex items-center gap-3">
            <span className="grid size-9 place-items-center rounded-lg border border-cyan-300/20 bg-cyan-300/8 text-xs font-black text-cyan-200">
              RZ
            </span>
            <div>
              <p className="font-semibold text-white">Postdoc ResearchZeal</p>
              <p className="text-xs text-slate-500">A ResearchZeal project</p>
            </div>
          </div>
          <p className="mt-5 max-w-xl text-sm leading-6 text-slate-400">
            Making global research opportunities easier to discover, compare, and
            access without unnecessary barriers.
          </p>
          <p className="mt-3 text-xs text-slate-500">
            postdoc.researchzeal.com · Phase 1 static search preview
          </p>
        </div>
        <div className="sm:text-right">
          <nav className="flex gap-5 sm:justify-end" aria-label="Footer navigation">
            <a className="footer-link" href="#positions">
              Search positions
            </a>
            <a className="footer-link" href="#alerts">
              Weekly alerts
            </a>
          </nav>
          <p className="mt-5 text-xs text-slate-500">
            © {new Date().getFullYear()} ResearchZeal
          </p>
        </div>
      </div>
    </footer>
  );
}
