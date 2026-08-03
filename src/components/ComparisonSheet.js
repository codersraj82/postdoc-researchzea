"use client";

import { useEffect, useMemo, useRef } from "react";
import { getComparisonRows } from "@/lib/comparison";

function CellValue({ row }) {
  if (!row.href) return row.value;
  return (
    <a
      href={row.href}
      target="_blank"
      rel="noopener noreferrer"
      className="font-semibold text-cyan-200 underline decoration-cyan-300/30 underline-offset-4 hover:text-cyan-100"
    >
      {row.value}
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  );
}

export default function ComparisonSheet({ jobs, preferenceMatches, onClose, onRemove }) {
  const panelRef = useRef(null);
  const closeRef = useRef(null);
  const rowsByJob = useMemo(
    () => jobs.map((job) => getComparisonRows(job, preferenceMatches.get(job.id))),
    [jobs, preferenceMatches],
  );

  useEffect(() => {
    closeRef.current?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function handleKeyDown(event) {
      if (event.key === "Escape") onClose();
      if (event.key !== "Tab") return;
      const focusable = [...panelRef.current.querySelectorAll(
        'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  if (!jobs.length) return null;

  return (
    <div className="fixed inset-0 z-50 bg-[#030a13]/85 p-2 backdrop-blur-sm sm:p-5">
      <section
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="comparison-title"
        className="mx-auto flex h-full max-w-7xl flex-col overflow-hidden rounded-2xl border border-white/12 bg-[#081523] shadow-2xl"
      >
        <header className="flex items-start justify-between gap-4 border-b border-white/10 px-4 py-4 sm:px-6">
          <div>
            <p className="eyebrow">No-AI comparison</p>
            <h2 id="comparison-title" className="mt-1 text-xl font-semibold text-white sm:text-2xl">
              Compare selected positions
            </h2>
            <p className="mt-1 text-xs text-slate-400">Missing information is shown as Not stated.</p>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            className="secondary-button min-h-11 shrink-0"
            aria-label="Close position comparison"
          >
            Close
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-auto" tabIndex="0" aria-label="Scrollable comparison table">
          <table className="w-full min-w-[52rem] border-collapse text-left text-sm">
            <caption className="sr-only">Comparison of up to three selected postdoctoral positions</caption>
            <thead className="sticky top-0 z-10 bg-[#0a1929]">
              <tr>
                <th scope="col" className="w-44 border-b border-r border-white/10 p-4 text-xs uppercase tracking-wider text-slate-400">
                  Field
                </th>
                {jobs.map((job) => (
                  <th key={job.id} scope="col" className="min-w-64 border-b border-r border-white/10 p-4 align-top text-white last:border-r-0">
                    <span className="block leading-6">{job.title}</span>
                    <button
                      type="button"
                      onClick={() => onRemove(job.id)}
                      className="mt-2 rounded-md text-xs font-semibold text-slate-400 underline underline-offset-4 hover:text-white focus-visible:outline-2 focus-visible:outline-cyan-300"
                      aria-label={`Remove ${job.title} from comparison`}
                    >
                      Remove
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rowsByJob[0]?.map((firstRow, rowIndex) => (
                <tr key={firstRow.key} className="odd:bg-white/[0.018]">
                  <th scope="row" className="border-b border-r border-white/8 p-4 align-top text-xs font-semibold uppercase tracking-wide text-slate-400">
                    {firstRow.label}
                  </th>
                  {rowsByJob.map((rows, jobIndex) => (
                    <td key={jobs[jobIndex].id} className="border-b border-r border-white/8 p-4 align-top leading-6 text-slate-200 last:border-r-0">
                      <CellValue row={rows[rowIndex]} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
