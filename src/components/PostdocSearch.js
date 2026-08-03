"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import ComparisonSheet from "@/components/ComparisonSheet";
import ComparisonTray from "@/components/ComparisonTray";
import JobResults from "@/components/JobResults";
import PreferencePanel from "@/components/PreferencePanel";
import SearchFilters from "@/components/SearchFilters";
import {
  addComparisonJob,
  clearComparisonJobs,
  normalizeStoredJobIds,
  reconcileStoredJobIds,
  removeComparisonJob,
} from "@/lib/comparison";
import { filterJobs, getFilterOptions } from "@/lib/filterJobs";
import { getSourceLanguageOptions } from "@/lib/languages";
import { loadJobs } from "@/lib/loadJobs";
import {
  calculatePreferenceMatch,
  EMPTY_PREFERENCES,
  normalizePreferences,
} from "@/lib/preferenceMatch";

const COMPARE_STORAGE_KEY = "rz_compare_job_ids_v1";
const SAVED_STORAGE_KEY = "rz_saved_job_ids_v1";
const PREFERENCES_STORAGE_KEY = "rz_job_preferences_v1";

const emptyFilters = {
  keyword: "",
  country: "",
  researchArea: "",
  language: "",
  sourceLanguage: "",
  deadline: "",
};

function readStoredJson(key, fallback) {
  try {
    const value = window.localStorage.getItem(key);
    return value === null ? fallback : JSON.parse(value);
  } catch {
    return fallback;
  }
}

function isRealJob(job) {
  return job?.is_demo === false || job?.is_demo === 0;
}

export default function PostdocSearch({ jobs, referenceDate }) {
  const [filters, setFilters] = useState(emptyFilters);
  const [savedOnly, setSavedOnly] = useState(false);
  const [jobData, setJobData] = useState({ jobs, source: "loading" });
  const [retryRequest, setRetryRequest] = useState(0);
  const [comparedIds, setComparedIds] = useState([]);
  const [savedIds, setSavedIds] = useState([]);
  const [preferences, setPreferences] = useState(EMPTY_PREFERENCES);
  const [storageReady, setStorageReady] = useState(false);
  const [comparisonOpen, setComparisonOpen] = useState(false);
  const [comparisonMessage, setComparisonMessage] = useState("");

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setComparedIds(normalizeStoredJobIds(readStoredJson(COMPARE_STORAGE_KEY, [])));
      setSavedIds(normalizeStoredJobIds(readStoredJson(SAVED_STORAGE_KEY, [])));
      setPreferences(normalizePreferences(readStoredJson(
        PREFERENCES_STORAGE_KEY,
        EMPTY_PREFERENCES,
      )));
      setStorageReady(true);
    }, 0);
    return () => window.clearTimeout(timeout);
  }, []);

  useEffect(() => {
    if (!storageReady) return;
    window.localStorage.setItem(COMPARE_STORAGE_KEY, JSON.stringify(comparedIds));
  }, [comparedIds, storageReady]);

  useEffect(() => {
    if (!storageReady) return;
    window.localStorage.setItem(SAVED_STORAGE_KEY, JSON.stringify(savedIds));
  }, [savedIds, storageReady]);

  useEffect(() => {
    if (!storageReady) return;
    window.localStorage.setItem(PREFERENCES_STORAGE_KEY, JSON.stringify(preferences));
  }, [preferences, storageReady]);

  useEffect(() => {
    const controller = new AbortController();
    loadJobs(jobs, { signal: controller.signal })
      .then(setJobData)
      .catch((error) => {
        if (error?.name !== "AbortError") setJobData({ jobs, source: "fallback" });
      });
    return () => controller.abort();
  }, [jobs, retryRequest]);

  useEffect(() => {
    if (!storageReady || jobData.source !== "d1") return;
    const currentRealJobs = jobData.jobs.filter(isRealJob);
    const timeout = window.setTimeout(() => {
      setComparedIds((current) => reconcileStoredJobIds(current, currentRealJobs));
      setSavedIds((current) => reconcileStoredJobIds(current, currentRealJobs));
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [jobData, storageReady]);

  const options = useMemo(() => ({
    countries: getFilterOptions(jobData.jobs, "country"),
    researchAreas: getFilterOptions(jobData.jobs, "research_area"),
    languages: getFilterOptions(jobData.jobs, "language"),
    sourceLanguages: getSourceLanguageOptions(jobData.jobs),
  }), [jobData.jobs]);

  const preferenceMatches = useMemo(() => new Map(
    jobData.jobs.map((job) => [
      job.id,
      calculatePreferenceMatch(job, preferences, new Date(referenceDate)),
    ]),
  ), [jobData.jobs, preferences, referenceDate]);

  const filteredJobs = useMemo(() => {
    const matches = filterJobs(jobData.jobs, filters, new Date(referenceDate));
    return savedOnly ? matches.filter((job) => savedIds.includes(job.id)) : matches;
  }, [jobData.jobs, filters, referenceDate, savedIds, savedOnly]);

  const comparedJobs = useMemo(() => comparedIds
    .map((id) => jobData.jobs.find((job) => job.id === id))
    .filter(Boolean), [comparedIds, jobData.jobs]);

  function handleFilterChange(name, value) {
    setFilters((current) => ({ ...current, [name]: value }));
  }

  function clearFilters() {
    setFilters(emptyFilters);
    setSavedOnly(false);
  }

  function retryDatabase() {
    setJobData((current) => ({ ...current, source: "loading" }));
    setRetryRequest((current) => current + 1);
  }

  function handleSubmit(event) {
    event.preventDefault();
    document.getElementById("results")?.scrollIntoView({ block: "start" });
  }

  function toggleComparison(jobId) {
    setComparedIds((current) => {
      if (current.includes(jobId)) {
        setComparisonMessage("");
        return removeComparisonJob(current, jobId);
      }
      const result = addComparisonJob(current, jobId);
      setComparisonMessage(result.status === "limit"
        ? "You can compare up to three positions. Remove one before adding another."
        : "");
      return result.ids;
    });
  }

  function toggleSaved(jobId) {
    setSavedIds((current) => current.includes(jobId)
      ? removeComparisonJob(current, jobId)
      : [...current, jobId]);
  }

  function clearCompared() {
    setComparedIds(clearComparisonJobs());
    setComparisonMessage("");
    setComparisonOpen(false);
  }

  const closeComparison = useCallback(() => setComparisonOpen(false), []);

  function updatePreference(name, value) {
    setPreferences((current) => normalizePreferences({ ...current, [name]: value }));
  }

  return (
    <section id="positions" className={`scroll-mt-4 pb-14 sm:pb-20 ${comparedJobs.length ? "mb-32" : ""}`}>
      <div className="page-shell">
        <div className="search-panel">
          <div className="mb-6 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="eyebrow">Search opportunities</p>
              <h2 className="mt-2 text-xl font-semibold tracking-[-0.025em] text-white sm:text-2xl">
                Start with what you research
              </h2>
            </div>
            <p className="text-xs text-slate-500">Fast, local filtering &middot; No account</p>
          </div>
          <SearchFilters
            filters={filters}
            options={options}
            onFilterChange={handleFilterChange}
            onClear={clearFilters}
            onSubmit={handleSubmit}
            sourceStatus={jobData.source}
            onRetryDatabase={retryDatabase}
            savedOnly={savedOnly}
            onSavedOnlyChange={setSavedOnly}
            savedCount={savedIds.length}
          />
          <PreferencePanel
            preferences={preferences}
            onChange={updatePreference}
            onClear={() => setPreferences(EMPTY_PREFERENCES)}
          />
        </div>
        <div id="results" className="scroll-mt-6">
          <JobResults
            jobs={filteredJobs}
            referenceDate={referenceDate}
            onClear={clearFilters}
            comparedIds={comparedIds}
            savedIds={savedIds}
            onToggleCompare={toggleComparison}
            onToggleSaved={toggleSaved}
            preferenceMatches={preferenceMatches}
          />
        </div>
      </div>
      <ComparisonTray
        jobs={comparedJobs}
        message={comparisonMessage}
        onCompare={() => setComparisonOpen(true)}
        onRemove={toggleComparison}
        onClear={clearCompared}
      />
      {comparisonOpen && (
        <ComparisonSheet
          jobs={comparedJobs}
          preferenceMatches={preferenceMatches}
          onClose={closeComparison}
          onRemove={toggleComparison}
        />
      )}
    </section>
  );
}
