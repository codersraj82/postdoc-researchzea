"use client";

import { useMemo, useState } from "react";
import JobResults from "@/components/JobResults";
import SearchFilters from "@/components/SearchFilters";
import { filterJobs, getFilterOptions } from "@/lib/filterJobs";

const emptyFilters = {
  keyword: "",
  country: "",
  researchArea: "",
  language: "",
  deadline: "",
};

export default function PostdocSearch({ jobs, referenceDate }) {
  const [filters, setFilters] = useState(emptyFilters);

  const options = useMemo(
    () => ({
      countries: getFilterOptions(jobs, "country"),
      researchAreas: getFilterOptions(jobs, "research_area"),
      languages: getFilterOptions(jobs, "language"),
    }),
    [jobs],
  );

  const filteredJobs = useMemo(
    () => filterJobs(jobs, filters, new Date(referenceDate)),
    [jobs, filters, referenceDate],
  );

  function handleFilterChange(name, value) {
    setFilters((current) => ({ ...current, [name]: value }));
  }

  function clearFilters() {
    setFilters(emptyFilters);
  }

  function handleSubmit(event) {
    event.preventDefault();
    document.getElementById("results")?.scrollIntoView({ block: "start" });
  }

  return (
    <section id="positions" className="scroll-mt-4 pb-14 sm:pb-20">
      <div className="page-shell">
        <div className="search-panel">
          <div className="mb-6 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="eyebrow">Search opportunities</p>
              <h2 className="mt-2 text-xl font-semibold tracking-[-0.025em] text-white sm:text-2xl">
                Start with what you research
              </h2>
            </div>
            <p className="text-xs text-slate-500">Fast, local filtering · No account</p>
          </div>
          <SearchFilters
            filters={filters}
            options={options}
            onFilterChange={handleFilterChange}
            onClear={clearFilters}
            onSubmit={handleSubmit}
          />
        </div>
        <div id="results" className="scroll-mt-6">
          <JobResults jobs={filteredJobs} referenceDate={referenceDate} onClear={clearFilters} />
        </div>
      </div>
    </section>
  );
}
