const HOUR_MS = 60 * 60 * 1000;

const INTERVALS = Object.freeze({
  twice_daily: 12 * HOUR_MS,
  daily: 24 * HOUR_MS,
  every_48_hours: 48 * HOUR_MS,
  weekly: 7 * 24 * HOUR_MS,
});

function time(value) {
  const parsed = new Date(value ?? "").getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

export function collectionIntervalMs(source) {
  return INTERVALS[source?.collectionInterval] ?? INTERVALS.daily;
}

export function isSourceDue(source, state = {}, now = new Date()) {
  if (!source?.enabled) return false;
  state ??= {};
  const nowMs = now.getTime();
  const nextAllowed = time(state.next_allowed_at);
  if (nextAllowed !== null && nextAllowed > nowMs) return false;
  const lastAttempt = time(state.last_attempt_at);
  const lastSuccess = time(state.last_success_at);
  const lastActivity = Math.max(lastAttempt ?? 0, lastSuccess ?? 0);
  return lastActivity === 0 || nowMs - lastActivity >= collectionIntervalMs(source);
}

export function calculateBackoff(consecutiveFailures, now = new Date(), options = {}) {
  if (options.policyFailure) return "9999-12-31T23:59:59.000Z";
  const failures = Math.max(0, Number(consecutiveFailures) || 0);
  const delayHours = failures >= 4 ? 72 : failures === 3 ? 24 : failures === 2 ? 12 : 0;
  return delayHours
    ? new Date(now.getTime() + delayHours * HOUR_MS).toISOString()
    : null;
}

export function isPolicyFailure(error) {
  const code = String(error?.code ?? "");
  return error?.retryable !== true && [
    "ROBOTS_DISALLOWED",
    "CONTENT_SIGNAL_SEARCH_NO",
    "SOURCE_NOT_APPROVED",
  ].includes(code);
}
