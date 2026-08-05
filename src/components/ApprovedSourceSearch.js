"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  approvedSourceSearchFilters,
  approvedSourceSearchKey,
  SOURCE_SEARCH_SESSION_KEY,
} from "@/lib/approvedSourceSearch";

const POLL_INTERVAL_MS = 2500;
const POLL_TIMEOUT_MS = 90_000;
const TERMINAL = new Set(["success", "partial", "no_results", "failed"]);

const messages = {
  idle: "No matching positions are currently indexed.",
  requesting: "Starting an approved-source refresh…",
  queued: "The approved-source refresh is queued.",
  running: "Refreshing approved research sources…",
  success: "New matching positions are available.",
  partial: "Some approved sources were checked. Matching positions may still be available.",
  no_results: "No matching positions were found in the approved sources checked.",
  failed: "The approved-source refresh could not be completed right now.",
  rate_limited: "Approved-source search is temporarily rate limited. Please try again later.",
  timed_out: "The approved-source refresh is still processing. You can check again shortly.",
};

function safeSessionRead() {
  try {
    const value = JSON.parse(window.sessionStorage.getItem(SOURCE_SEARCH_SESSION_KEY));
    return value && typeof value.requestId === "string" && typeof value.queryKey === "string"
      ? value
      : null;
  } catch {
    return null;
  }
}

function safeSessionWrite(value) {
  try {
    if (value) window.sessionStorage.setItem(SOURCE_SEARCH_SESSION_KEY, JSON.stringify(value));
    else window.sessionStorage.removeItem(SOURCE_SEARCH_SESSION_KEY);
  } catch {
    // Polling still works when session storage is unavailable.
  }
}

function validStatusPayload(payload) {
  return payload?.ok === true
    && typeof payload.request_id === "string"
    && ["queued", "running", ...TERMINAL].includes(payload.status)
    && Number.isSafeInteger(payload.expected_sources)
    && Number.isSafeInteger(payload.completed_sources)
    && Number.isSafeInteger(payload.sources_succeeded)
    && Number.isSafeInteger(payload.matching_jobs);
}

export default function ApprovedSourceSearch({ filters, visible, onRefreshJobs }) {
  const requestFilters = useMemo(() => approvedSourceSearchFilters(filters), [filters]);
  const queryKey = useMemo(() => approvedSourceSearchKey(filters), [filters]);
  const [state, setState] = useState({
    status: "idle",
    requestId: null,
    completed: 0,
    expected: 0,
    retryMode: null,
  });
  const timerRef = useRef(null);
  const controllerRef = useRef(null);
  const deadlineRef = useRef(0);
  const pollRef = useRef(null);

  const stopPolling = useCallback((abort = true) => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = null;
    if (abort) controllerRef.current?.abort();
    controllerRef.current = null;
  }, []);

  const finish = useCallback(async (payload) => {
    stopPolling(false);
    safeSessionWrite(null);
    setState((current) => ({
      ...current,
      status: payload.status,
      requestId: payload.request_id ?? current.requestId,
      completed: payload.completed_sources ?? current.completed,
      expected: payload.expected_sources ?? current.expected,
      retryMode: null,
    }));
    if (["success", "partial"].includes(payload.status) || payload.matching_jobs > 0) {
      onRefreshJobs();
    }
  }, [onRefreshJobs, stopPolling]);

  const poll = useCallback(async (requestId, expectedQueryKey) => {
    if (expectedQueryKey !== queryKey) return;
    if (Date.now() >= deadlineRef.current) {
      stopPolling();
      setState((current) => ({ ...current, status: "timed_out" }));
      return;
    }
    const controller = new AbortController();
    controllerRef.current = controller;
    try {
      const response = await fetch(`/api/source-search/${encodeURIComponent(requestId)}`, {
        method: "GET",
        headers: { Accept: "application/json" },
        cache: "no-store",
        signal: controller.signal,
      });
      if (!response.ok) throw new Error("Status request failed.");
      const payload = await response.json();
      if (!validStatusPayload(payload) || payload.request_id !== requestId) {
        throw new Error("Status response was invalid.");
      }
      setState((current) => ({
        ...current,
        status: payload.status,
        completed: payload.completed_sources,
        expected: payload.expected_sources,
      }));
      if (TERMINAL.has(payload.status)) {
        await finish(payload);
        return;
      }
      timerRef.current = window.setTimeout(
        () => void pollRef.current?.(requestId, expectedQueryKey),
        POLL_INTERVAL_MS,
      );
    } catch (error) {
      if (error?.name === "AbortError") return;
      stopPolling(false);
      setState((current) => ({ ...current, status: "failed", retryMode: "status" }));
    }
  }, [finish, queryKey, stopPolling]);

  useEffect(() => {
    pollRef.current = poll;
  }, [poll]);

  const beginPolling = useCallback((requestId) => {
    stopPolling();
    deadlineRef.current = Date.now() + POLL_TIMEOUT_MS;
    safeSessionWrite({ requestId, queryKey });
    setState((current) => ({
      ...current,
      requestId,
      status: "queued",
      retryMode: null,
    }));
    void poll(requestId, queryKey);
  }, [poll, queryKey, stopPolling]);

  useEffect(() => {
    stopPolling();
    const stored = safeSessionRead();
    const timeout = window.setTimeout(() => {
      if (visible && stored?.queryKey === queryKey) {
        deadlineRef.current = Date.now() + POLL_TIMEOUT_MS;
        setState({
          status: "queued",
          requestId: stored.requestId,
          completed: 0,
          expected: 0,
          retryMode: null,
        });
        void poll(stored.requestId, queryKey);
      } else {
        if (stored && stored.queryKey !== queryKey) safeSessionWrite(null);
        setState({
          status: "idle",
          requestId: null,
          completed: 0,
          expected: 0,
          retryMode: null,
        });
      }
    }, 0);
    return () => {
      window.clearTimeout(timeout);
      stopPolling();
    };
  }, [poll, queryKey, stopPolling, visible]);

  async function requestRefresh() {
    stopPolling();
    setState({
      status: "requesting",
      requestId: null,
      completed: 0,
      expected: 0,
      retryMode: null,
    });
    const controller = new AbortController();
    controllerRef.current = controller;
    try {
      const response = await fetch("/api/source-search", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestFilters),
        cache: "no-store",
        signal: controller.signal,
      });
      const payload = await response.json();
      if (response.status === 429) {
        setState((current) => ({
          ...current,
          status: "rate_limited",
          retryMode: null,
        }));
        return;
      }
      if (!response.ok || payload?.ok !== true) throw new Error("Refresh request failed.");
      if (payload.status === "results_available") {
        setState((current) => ({ ...current, status: "success" }));
        onRefreshJobs();
        return;
      }
      if (TERMINAL.has(payload.status)) {
        await finish({
          ...payload,
          completed_sources: 0,
          expected_sources: 0,
        });
        return;
      }
      if (typeof payload.request_id !== "string") throw new Error("Missing request ID.");
      beginPolling(payload.request_id);
    } catch (error) {
      if (error?.name !== "AbortError") {
        setState((current) => ({ ...current, status: "failed", retryMode: "request" }));
      }
    }
  }

  function cancelPolling() {
    stopPolling();
    setState((current) => ({ ...current, status: "timed_out" }));
  }

  function checkAgain() {
    if (state.requestId) beginPolling(state.requestId);
  }

  if (!visible) return null;

  const active = ["requesting", "queued", "running"].includes(state.status);
  const canStart = state.status === "idle" || state.retryMode === "request";
  const progress = state.expected > 0
    ? `${state.completed} of ${state.expected} approved sources checked.`
    : null;

  return (
    <section
      className="mt-5 rounded-2xl border border-cyan-300/15 bg-cyan-300/[0.045] p-5 sm:p-6"
      aria-labelledby="approved-source-search-title"
    >
      <p className="eyebrow">Approved-source search</p>
      <h3
        id="approved-source-search-title"
        className="mt-2 text-lg font-semibold text-white"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {messages[state.status] ?? messages.failed}
      </h3>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">
        ResearchZeal will refresh its approved research sources. It does not search the entire internet.
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        {canStart && (
          <button
            type="button"
            className="primary-button min-h-11"
            onClick={requestRefresh}
          >
            {state.status === "idle" ? "Search approved sources" : "Try approved sources again"}
          </button>
        )}
        {active && state.status !== "requesting" && (
          <button type="button" className="secondary-button min-h-11" onClick={cancelPolling}>
            Stop status checks
          </button>
        )}
        {state.status === "timed_out" && state.requestId && (
          <button type="button" className="secondary-button min-h-11" onClick={checkAgain}>
            Check status
          </button>
        )}
        {state.retryMode === "status" && state.requestId && (
          <button type="button" className="secondary-button min-h-11" onClick={checkAgain}>
            Check status
          </button>
        )}
      </div>
      <div className="mt-3 min-h-5 text-xs text-cyan-100" role="status" aria-live="polite" aria-atomic="true">
        {progress ?? (active ? "Waiting for approved sources…" : "")}
      </div>
    </section>
  );
}

export { POLL_INTERVAL_MS, POLL_TIMEOUT_MS };
