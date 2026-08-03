"use client";

import { useEffect, useState } from "react";

const TOOLTIP = "Approximate unique browsers. No personal information is stored.";

function validCount(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function visitorLabel(count) {
  return `${count.toLocaleString()} ${count === 1 ? "visitor" : "visitors"}`;
}

export default function VisitorCounter() {
  const [state, setState] = useState({ status: "loading", total: 0, today: 0 });

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/visit", {
      method: "POST",
      credentials: "same-origin",
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("Visitor API request failed.");
        const payload = await response.json();
        if (
          payload?.ok !== true
          || !validCount(payload.total_visitors)
          || !validCount(payload.today_visitors)
        ) {
          throw new Error("Visitor API response was invalid.");
        }
        setState({
          status: "ready",
          total: payload.total_visitors,
          today: payload.today_visitors,
        });
      })
      .catch((error) => {
        if (error?.name !== "AbortError") {
          setState({ status: "error", total: 0, today: 0 });
        }
      });
    return () => controller.abort();
  }, []);

  if (state.status === "error") {
    return <span className="block min-h-10 min-w-24" aria-hidden="true" />;
  }

  return (
    <span
      className="inline-flex min-h-10 min-w-24 items-center justify-center rounded-full border border-cyan-300/15 bg-cyan-300/[0.055] px-3 text-[0.68rem] font-semibold text-cyan-100 sm:min-w-28 sm:text-xs"
      aria-describedby="visitor-counter-privacy"
      title={TOOLTIP}
    >
      {state.status === "ready" ? (
        <>
          <span>{visitorLabel(state.total)}</span>
          <span className="hidden lg:inline">&nbsp;&middot; {state.today.toLocaleString()} today</span>
        </>
      ) : (
        <span className="text-slate-400">Counting visitors</span>
      )}
      <span id="visitor-counter-privacy" className="sr-only">
        {TOOLTIP}
      </span>
    </span>
  );
}
