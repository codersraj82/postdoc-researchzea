const VISITOR_COOKIE = "rz_visitor_id";
const VISIT_DAY_COOKIE = "rz_visit_day";
const VISITOR_MAX_AGE_SECONDS = 365 * 24 * 60 * 60;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const VISITOR_JSON_HEADERS = Object.freeze({
  "Cache-Control": "no-store",
  "Content-Type": "application/json; charset=utf-8",
  "X-Content-Type-Options": "nosniff",
});

function visitorJson(payload, status = 200, cookies = []) {
  const headers = new Headers(VISITOR_JSON_HEADERS);
  for (const cookie of cookies) headers.append("Set-Cookie", cookie);
  return new Response(JSON.stringify(payload), { status, headers });
}

function visitorError(status, code, message, extraHeaders = {}) {
  const response = visitorJson({ ok: false, error: { code, message } }, status);
  for (const [name, value] of Object.entries(extraHeaders)) {
    response.headers.set(name, value);
  }
  return response;
}

export function parseCookieHeader(value) {
  const cookies = {};
  for (const part of String(value ?? "").split(";")) {
    const separator = part.indexOf("=");
    if (separator < 1) continue;
    const name = part.slice(0, separator).trim();
    const cookieValue = part.slice(separator + 1).trim();
    if (name && !Object.hasOwn(cookies, name)) cookies[name] = cookieValue;
  }
  return cookies;
}

export function isValidVisitorId(value) {
  return UUID_PATTERN.test(String(value ?? ""));
}

export async function hashVisitorId(visitorId, cryptoImpl = crypto) {
  const bytes = new TextEncoder().encode(visitorId);
  const digest = await cryptoImpl.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function utcVisitDate(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

export function secondsUntilNextUtcDay(now = new Date()) {
  const nextDay = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1,
  );
  return Math.max(60, Math.ceil((nextDay - now.getTime()) / 1000));
}

function cookie(name, value, maximumAge) {
  return `${name}=${value}; Max-Age=${maximumAge}; Path=/; HttpOnly; Secure; SameSite=Lax`;
}

function isSameOrigin(request) {
  const origin = request.headers.get("Origin");
  if (!origin) return true;
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

async function hasUnexpectedBody(request) {
  const contentLength = request.headers.get("Content-Length");
  if ((contentLength !== null && contentLength !== "0")
    || request.headers.has("Transfer-Encoding")) {
    return true;
  }
  if (request.body === null) return false;
  const reader = request.body.getReader();
  const firstChunk = await reader.read();
  await reader.cancel();
  return !firstChunk.done || Boolean(firstChunk.value?.byteLength);
}

export async function readVisitorCounts(db, visitDate) {
  const [totalResult, todayResult] = await db.batch([
    db.prepare("SELECT COUNT(*) AS count FROM site_visitors"),
    db.prepare(
      "SELECT COUNT(*) AS count FROM site_visitor_days WHERE visit_date = ?",
    ).bind(visitDate),
  ]);
  return {
    totalVisitors: Number(totalResult.results?.[0]?.count ?? 0),
    todayVisitors: Number(todayResult.results?.[0]?.count ?? 0),
  };
}

export async function recordVisitor(db, values) {
  await db.batch([
    db.prepare(
      `INSERT OR IGNORE INTO site_visitors (
         visitor_hash, first_seen_at, last_seen_at
       ) VALUES (?, ?, ?)`,
    ).bind(values.visitorHash, values.now, values.now),
    db.prepare(
      "UPDATE site_visitors SET last_seen_at = ? WHERE visitor_hash = ?",
    ).bind(values.now, values.visitorHash),
    db.prepare(
      `INSERT OR IGNORE INTO site_visitor_days (
         visit_date, visitor_hash, first_seen_at
       ) VALUES (?, ?, ?)`,
    ).bind(values.visitDate, values.visitorHash, values.now),
  ]);
}

export async function handleVisitRequest(request, env, options = {}) {
  if (request.method !== "POST") {
    return visitorError(
      405,
      "METHOD_NOT_ALLOWED",
      "Only POST requests are supported for this endpoint.",
      { Allow: "POST" },
    );
  }
  if (!isSameOrigin(request)) {
    return visitorError(403, "ORIGIN_NOT_ALLOWED", "The request origin is not allowed.");
  }
  if (await hasUnexpectedBody(request)) {
    return visitorError(413, "REQUEST_BODY_NOT_ALLOWED", "This endpoint accepts no request body.");
  }

  const nowDate = options.now instanceof Date ? options.now : new Date();
  const now = nowDate.toISOString();
  const visitDate = utcVisitDate(nowDate);
  const cookies = parseCookieHeader(request.headers.get("Cookie"));
  const existingVisitorId = cookies[VISITOR_COOKIE];
  const hasValidVisitorId = isValidVisitorId(existingVisitorId);
  const visitorId = hasValidVisitorId
    ? existingVisitorId
    : (options.randomUUID ?? (() => crypto.randomUUID()))();

  try {
    if (hasValidVisitorId && cookies[VISIT_DAY_COOKIE] === visitDate) {
      const counts = await readVisitorCounts(env.DB, visitDate);
      return visitorJson({
        ok: true,
        total_visitors: counts.totalVisitors,
        today_visitors: counts.todayVisitors,
        approximate: true,
      });
    }

    const visitorHash = await hashVisitorId(visitorId, options.cryptoImpl ?? crypto);
    await recordVisitor(env.DB, { visitorHash, visitDate, now });
    const counts = await readVisitorCounts(env.DB, visitDate);
    const responseCookies = [
      cookie(VISIT_DAY_COOKIE, visitDate, secondsUntilNextUtcDay(nowDate)),
    ];
    if (!hasValidVisitorId) {
      responseCookies.unshift(
        cookie(VISITOR_COOKIE, visitorId, VISITOR_MAX_AGE_SECONDS),
      );
    }
    return visitorJson({
      ok: true,
      total_visitors: counts.totalVisitors,
      today_visitors: counts.todayVisitors,
      approximate: true,
    }, 200, responseCookies);
  } catch (error) {
    console.error(JSON.stringify({
      event: "visitor_count_failed",
      error: error instanceof Error ? error.name : "UnknownError",
    }));
    return visitorError(
      503,
      "VISITOR_COUNTER_UNAVAILABLE",
      "The visitor counter is temporarily unavailable.",
    );
  }
}

export {
  VISITOR_COOKIE,
  VISITOR_MAX_AGE_SECONDS,
  VISIT_DAY_COOKIE,
};
