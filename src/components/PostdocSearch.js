"use client";

import { useSearchParams, usePathname, useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import ApprovedSourceSearch from "@/components/ApprovedSourceSearch";
import ComparisonSheet from "@/components/ComparisonSheet";
import ComparisonTray from "@/components/ComparisonTray";
import JobResults from "@/components/JobResults";
import PreferencePanel from "@/components/PreferencePanel";
import SearchFilters from "@/components/SearchFilters";
import {
  addComparisonJob,
  clearComparisonJobs,
  normalizeStoredJobIds,
  removeComparisonJob,
} from "@/lib/comparison";
import { filterJobs, getFilterOptions } from "@/lib/filterJobs";
import {
  canonicalPublicFilterKey,
  normalizePublicFilters,
  publicFiltersFromSearchParams,
  publicFiltersToUi,
  publicFilterUrl,
} from "@/lib/jobFilters";
import { fetchJobsPage, JOBS_PAGE_SIZE } from "@/lib/jobsApi";
import { getSourceLanguageOptions, matchesSourceLanguage } from "@/lib/languages";
import {
  isCurrentPageRequest,
  mergeJobsById,
  nextOffsetFromPage,
  pageLoadedAnnouncement,
  resultCountCopy,
} from "@/lib/paginatedJobs";
import {
  calculatePreferenceMatch,
  EMPTY_PREFERENCES,
  normalizePreferences,
} from "@/lib/preferenceMatch";
import { shouldOfferApprovedSourceSearch } from "@/lib/approvedSourceSearch";

const COMPARE_STORAGE_KEY = "rz_compare_job_ids_v1";
const SAVED_STORAGE_KEY = "rz_saved_job_ids_v1";
const PREFERENCES_STORAGE_KEY = "rz_job_preferences_v1";
const KEYWORD_DEBOUNCE_MS = 450;

const initialResults = Object.freeze({
  jobs: [],
  total: 0,
  nextOffset: 0,
  hasMore: false,
  initialLoading: true,
  loadingMore: false,
  initialError: null,
  loadMoreError: null,
  dataSource: "loading",
  announcement: "Loading positions…",
  activeQueryKey: null,
});

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

function withCurrentOption(options, current) {
  return [...new Set([...(options ?? []), current].filter(Boolean))]
    .sort((first, second) => first.localeCompare(second));
}

export default function PostdocSearch({ jobs: fallbackJobs, referenceDate }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const urlSearch = searchParams.toString();
  const appliedFilters = useMemo(
    () => publicFiltersFromSearchParams(new URLSearchParams(urlSearch)),
    [urlSearch],
  );
  const activeQueryKey = useMemo(
    () => canonicalPublicFilterKey(appliedFilters),
    [appliedFilters],
  );

  const [keywordDraft, setKeywordDraft] = useState(appliedFilters.keyword);
  const [sourceLanguage, setSourceLanguage] = useState("");
  const [savedOnly, setSavedOnly] = useState(false);
  const [results, setResults] = useState(initialResults);
  const [refreshRequest, setRefreshRequest] = useState(0);
  const [knownJobs, setKnownJobs] = useState([]);
  const [comparedIds, setComparedIds] = useState([]);
  const [savedIds, setSavedIds] = useState([]);
  const [preferences, setPreferences] = useState(EMPTY_PREFERENCES);
  const [storageReady, setStorageReady] = useState(false);
  const [comparisonOpen, setComparisonOpen] = useState(false);
  const [comparisonMessage, setComparisonMessage] = useState("");
  const generationRef = useRef(0);
  const initialControllerRef = useRef(null);
  const loadMoreControllerRef = useRef(null);
  const activeQueryKeyRef = useRef(activeQueryKey);

  useLayoutEffect(() => {
    activeQueryKeyRef.current = activeQueryKey;
  }, [activeQueryKey]);

  const filtersForControls = useMemo(() => ({
    ...publicFiltersToUi(appliedFilters, sourceLanguage),
    keyword: keywordDraft,
  }), [appliedFilters, keywordDraft, sourceLanguage]);

  const navigateToFilters = useCallback((nextFilters, { replace = false } = {}) => {
    const normalized = normalizePublicFilters(nextFilters);
    const nextUrl = publicFilterUrl(pathname, normalized);
    const currentUrl = publicFilterUrl(pathname, appliedFilters);
    if (nextUrl === currentUrl) return false;
    const method = replace ? "replace" : "push";
    router[method](nextUrl, { scroll: false });
    return true;
  }, [appliedFilters, pathname, router]);

  useEffect(() => {
    const timeout = window.setTimeout(() => setKeywordDraft(appliedFilters.keyword), 0);
    return () => window.clearTimeout(timeout);
  }, [activeQueryKey, appliedFilters.keyword]);

  useEffect(() => {
    if (keywordDraft === appliedFilters.keyword) return undefined;
    const timeout = window.setTimeout(() => {
      navigateToFilters({ ...appliedFilters, keyword: keywordDraft });
    }, KEYWORD_DEBOUNCE_MS);
    return () => window.clearTimeout(timeout);
  }, [appliedFilters, keywordDraft, navigateToFilters]);

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
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    initialControllerRef.current?.abort();
    loadMoreControllerRef.current?.abort();
    loadMoreControllerRef.current = null;
    const controller = new AbortController();
    initialControllerRef.current = controller;
    const loadingTimeout = window.setTimeout(() => {
      setResults({
        ...initialResults,
        announcement: "Loading positions…",
        activeQueryKey,
      });
    }, 0);

    fetchJobsPage({
      filters: appliedFilters,
      limit: JOBS_PAGE_SIZE,
      offset: 0,
      signal: controller.signal,
    }).then((page) => {
      window.clearTimeout(loadingTimeout);
      if (!isCurrentPageRequest({
        currentGeneration: generationRef.current,
        requestGeneration: generation,
        currentQueryKey: activeQueryKeyRef.current,
        requestQueryKey: activeQueryKey,
        aborted: controller.signal.aborted,
      })) return;
      const pageJobs = mergeJobsById([], page.jobs);
      setKnownJobs((current) => mergeJobsById(current, pageJobs.filter(isRealJob)));
      setResults({
        jobs: pageJobs,
        total: page.total,
        nextOffset: nextOffsetFromPage(page),
        hasMore: page.hasMore,
        initialLoading: false,
        loadingMore: false,
        initialError: null,
        loadMoreError: null,
        dataSource: "d1",
        activeQueryKey,
        announcement: page.total
          ? `${pageJobs.length} positions loaded.`
          : "No matching positions are currently indexed.",
      });
    }).catch((error) => {
      window.clearTimeout(loadingTimeout);
      if (error?.name === "AbortError" || generationRef.current !== generation) return;
      const fallbackUiFilters = publicFiltersToUi(appliedFilters);
      const matchingFallback = filterJobs(fallbackJobs, fallbackUiFilters, new Date(referenceDate));
      setResults({
        jobs: matchingFallback,
        total: matchingFallback.length,
        nextOffset: 0,
        hasMore: false,
        initialLoading: false,
        loadingMore: false,
        initialError: "The positions database is temporarily unavailable.",
        loadMoreError: null,
        dataSource: "fallback",
        activeQueryKey,
        announcement: "The positions database is temporarily unavailable. Sample positions are shown.",
      });
    });

    return () => {
      window.clearTimeout(loadingTimeout);
      controller.abort();
    };
  }, [activeQueryKey, appliedFilters, fallbackJobs, referenceDate, refreshRequest]);

  useEffect(() => () => {
    generationRef.current += 1;
    initialControllerRef.current?.abort();
    loadMoreControllerRef.current?.abort();
  }, []);

  const loadMore = useCallback(async () => {
    if (
      results.dataSource !== "d1"
      || results.initialLoading
      || results.loadingMore
      || loadMoreControllerRef.current
      || !results.hasMore
      || savedOnly
    ) return;
    const generation = generationRef.current;
    const expectedQueryKey = activeQueryKey;
    const requestedOffset = results.nextOffset;
    const controller = new AbortController();
    loadMoreControllerRef.current = controller;
    setResults((current) => ({
      ...current,
      loadingMore: true,
      loadMoreError: null,
      announcement: "Loading more positions…",
    }));
    try {
      const page = await fetchJobsPage({
        filters: appliedFilters,
        limit: JOBS_PAGE_SIZE,
        offset: requestedOffset,
        signal: controller.signal,
      });
      if (!isCurrentPageRequest({
        currentGeneration: generationRef.current,
        requestGeneration: generation,
        currentQueryKey: activeQueryKeyRef.current,
        requestQueryKey: expectedQueryKey,
        aborted: controller.signal.aborted,
      })) return;
      setResults((current) => {
        const merged = mergeJobsById(current.jobs, page.jobs);
        const added = Math.max(0, merged.length - current.jobs.length);
        return {
          ...current,
          jobs: merged,
          total: page.total,
          nextOffset: nextOffsetFromPage(page),
          hasMore: page.hasMore,
          loadingMore: false,
          loadMoreError: null,
          announcement: pageLoadedAnnouncement({
            added,
            displayed: merged.length,
            total: page.total,
          }),
        };
      });
      setKnownJobs((current) => mergeJobsById(current, page.jobs.filter(isRealJob)));
    } catch (error) {
      if (error?.name === "AbortError" || generationRef.current !== generation) return;
      setResults((current) => ({
        ...current,
        loadingMore: false,
        loadMoreError: "More positions could not be loaded.",
        announcement: "More positions could not be loaded.",
      }));
    } finally {
      if (loadMoreControllerRef.current === controller) loadMoreControllerRef.current = null;
    }
  }, [activeQueryKey, appliedFilters, results, savedOnly]);

  const optionJobs = useMemo(
    () => mergeJobsById(fallbackJobs, mergeJobsById(knownJobs, results.jobs)),
    [fallbackJobs, knownJobs, results.jobs],
  );
  const options = useMemo(() => ({
    countries: withCurrentOption(getFilterOptions(optionJobs, "country"), appliedFilters.country),
    researchAreas: withCurrentOption(
      getFilterOptions(optionJobs, "research_area"),
      appliedFilters.research_area,
    ),
    languages: withCurrentOption(getFilterOptions(optionJobs, "language"), appliedFilters.language),
    sourceLanguages: getSourceLanguageOptions(optionJobs),
  }), [appliedFilters, optionJobs]);

  const viewResults = results.activeQueryKey === activeQueryKey
    ? results
    : { ...initialResults, activeQueryKey };

  const sourceLanguageJobs = useMemo(() => viewResults.jobs.filter(
    (job) => !sourceLanguage || matchesSourceLanguage(job, sourceLanguage),
  ), [sourceLanguage, viewResults.jobs]);

  const visibleJobs = useMemo(() => {
    if (!savedOnly) return sourceLanguageJobs;
    return savedIds
      .map((id) => knownJobs.find((job) => job.id === id))
      .filter(Boolean)
      .filter((job) => !sourceLanguage || matchesSourceLanguage(job, sourceLanguage));
  }, [knownJobs, savedIds, savedOnly, sourceLanguage, sourceLanguageJobs]);

  const preferenceJobs = useMemo(
    () => mergeJobsById(knownJobs, results.jobs),
    [knownJobs, results.jobs],
  );
  const preferenceMatches = useMemo(() => new Map(
    preferenceJobs.map((job) => [
      job.id,
      calculatePreferenceMatch(job, preferences, new Date(referenceDate)),
    ]),
  ), [preferenceJobs, preferences, referenceDate]);

  const comparedJobs = useMemo(() => comparedIds
    .map((id) => knownJobs.find((job) => job.id === id))
    .filter(Boolean), [comparedIds, knownJobs]);

  function handleFilterChange(name, value) {
    if (name === "keyword") {
      setKeywordDraft(value);
      return;
    }
    if (name === "sourceLanguage") {
      setSourceLanguage(value);
      return;
    }
    const publicName = name === "researchArea" ? "research_area" : name;
    navigateToFilters({ ...appliedFilters, [publicName]: value });
  }

  function clearFilters() {
    setKeywordDraft("");
    setSourceLanguage("");
    setSavedOnly(false);
    navigateToFilters({});
  }

  const retryDatabase = useCallback(() => {
    setResults({ ...initialResults, activeQueryKey });
    setRefreshRequest((current) => current + 1);
  }, [activeQueryKey]);

  function handleSubmit(event) {
    event.preventDefault();
    navigateToFilters({ ...appliedFilters, keyword: keywordDraft });
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

  const countLabel = savedOnly
    ? `${visibleJobs.length} saved ${visibleJobs.length === 1 ? "position" : "positions"}.`
    : sourceLanguage
      ? `${visibleJobs.length} source-language ${visibleJobs.length === 1 ? "match" : "matches"} in ${viewResults.jobs.length} loaded positions.`
      : resultCountCopy({
        displayed: visibleJobs.length,
        total: viewResults.total,
        source: viewResults.dataSource,
      });

  const approvedSourceVisible = shouldOfferApprovedSourceSearch({
    dataSource: viewResults.dataSource,
    total: viewResults.total,
    savedOnly,
    filters: appliedFilters,
    initialLoading: viewResults.initialLoading,
    initialError: viewResults.initialError,
    loadingMore: viewResults.loadingMore,
  });
  const emptyTitle = savedOnly
    ? "No saved positions yet."
    : sourceLanguage
      ? "No loaded positions match that source language."
      : viewResults.dataSource === "fallback"
        ? "No matching sample positions are available."
        : "No matching positions are currently indexed.";

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
            <p className="text-xs text-slate-500">Server-filtered results &middot; No account</p>
          </div>
          <SearchFilters
            filters={filtersForControls}
            options={options}
            onFilterChange={handleFilterChange}
            onClear={clearFilters}
            onSubmit={handleSubmit}
            sourceStatus={viewResults.dataSource}
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
            jobs={visibleJobs}
            referenceDate={referenceDate}
            onClear={clearFilters}
            comparedIds={comparedIds}
            savedIds={savedIds}
            onToggleCompare={toggleComparison}
            onToggleSaved={toggleSaved}
            preferenceMatches={preferenceMatches}
            countLabel={countLabel}
            initialLoading={viewResults.initialLoading}
            initialError={viewResults.initialError}
            loadingMore={viewResults.loadingMore}
            loadMoreError={viewResults.loadMoreError}
            hasMore={viewResults.hasMore}
            canLoadMore={viewResults.dataSource === "d1" && !savedOnly && viewResults.jobs.length > 0}
            onLoadMore={loadMore}
            announcement={viewResults.announcement}
            dataSource={viewResults.dataSource}
            emptyTitle={emptyTitle}
          />
          <ApprovedSourceSearch
            filters={publicFiltersToUi(appliedFilters)}
            visible={approvedSourceVisible}
            onRefreshJobs={retryDatabase}
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
