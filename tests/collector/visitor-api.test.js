import assert from "node:assert/strict";
import test from "node:test";

import {
  handleVisitRequest,
  hashVisitorId,
  VISITOR_COOKIE,
  VISIT_DAY_COOKIE,
} from "../../worker/visitors.js";

const FIRST_ID = "123e4567-e89b-42d3-a456-426614174000";
const SECOND_ID = "123e4567-e89b-42d3-b456-426614174001";

class Statement {
  constructor(db, sql) {
    this.db = db;
    this.sql = sql;
    this.values = [];
  }

  bind(...values) {
    this.values = values;
    return this;
  }

  async execute() {
    this.db.sql.push(this.sql);
    if (this.db.fail) throw new Error("private database detail");
    if (this.sql.includes("INSERT OR IGNORE INTO site_visitors")) {
      const [hash, first, last] = this.values;
      if (!this.db.visitors.has(hash)) this.db.visitors.set(hash, { first, last });
    } else if (this.sql.includes("UPDATE site_visitors")) {
      const [last, hash] = this.values;
      const visitor = this.db.visitors.get(hash);
      if (visitor) visitor.last = last;
    } else if (this.sql.includes("INSERT OR IGNORE INTO site_visitor_days")) {
      const [date, hash] = this.values;
      this.db.days.add(`${date}:${hash}`);
    } else if (this.sql.includes("site_visitor_days WHERE")) {
      const [date] = this.values;
      return { results: [{ count: [...this.db.days].filter((key) => key.startsWith(`${date}:`)).length }] };
    } else if (this.sql.includes("COUNT(*) AS count FROM site_visitors")) {
      return { results: [{ count: this.db.visitors.size }] };
    }
    return { success: true, results: [] };
  }
}

class MemoryD1 {
  constructor() {
    this.visitors = new Map();
    this.days = new Set();
    this.sql = [];
    this.fail = false;
  }

  prepare(sql) {
    return new Statement(this, sql);
  }

  async batch(statements) {
    return Promise.all(statements.map((statement) => statement.execute()));
  }
}

function request(cookie = "", extra = {}) {
  const headers = new Headers(extra.headers);
  if (cookie) headers.set("Cookie", cookie);
  return new Request("https://postdoc.researchzeal.com/api/visit", {
    method: extra.method ?? "POST",
    headers,
    body: extra.body,
  });
}

async function visit(db, { cookie = "", now = "2026-08-03T12:00:00.000Z", id = FIRST_ID, ...extra } = {}) {
  return handleVisitRequest(request(cookie, extra), { DB: db }, {
    now: new Date(now),
    randomUUID: () => id,
  });
}

test("first browser increments total and today and stores only its SHA-256 hash", async () => {
  const db = new MemoryD1();
  const response = await visit(db);
  const setCookies = response.headers.getSetCookie();
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true,
    total_visitors: 1,
    today_visitors: 1,
    approximate: true,
  });
  const firstHash = await hashVisitorId(FIRST_ID);
  assert.equal(db.visitors.has(firstHash), true);
  assert.deepEqual(db.visitors.get(firstHash), {
    first: "2026-08-03T12:00:00.000Z",
    last: "2026-08-03T12:00:00.000Z",
  });
  assert.equal(JSON.stringify([...db.visitors]).includes(FIRST_ID), false);
  assert.equal(setCookies.length, 2);
  assert.match(setCookies[0], new RegExp(`^${VISITOR_COOKIE}=`));
  assert.match(setCookies[1], new RegExp(`^${VISIT_DAY_COOKIE}=`));
});

test("repeat browser on the same UTC day performs no visitor writes", async () => {
  const db = new MemoryD1();
  await visit(db);
  db.sql = [];
  const cookie = `${VISITOR_COOKIE}=${FIRST_ID}; ${VISIT_DAY_COOKIE}=2026-08-03`;
  const response = await visit(db, { cookie });
  assert.deepEqual(await response.json(), {
    ok: true,
    total_visitors: 1,
    today_visitors: 1,
    approximate: true,
  });
  assert.equal(db.sql.some((sql) => /INSERT|UPDATE/.test(sql)), false);
});

test("same browser next day increments daily only and a second browser increments both", async () => {
  const db = new MemoryD1();
  await visit(db);
  const returning = await visit(db, {
    cookie: `${VISITOR_COOKIE}=${FIRST_ID}; ${VISIT_DAY_COOKIE}=2026-08-03`,
    now: "2026-08-04T01:00:00.000Z",
  });
  assert.deepEqual(await returning.json(), {
    ok: true, total_visitors: 1, today_visitors: 1, approximate: true,
  });
  assert.equal(
    db.visitors.get(await hashVisitorId(FIRST_ID)).last,
    "2026-08-04T01:00:00.000Z",
  );
  const second = await visit(db, { now: "2026-08-04T02:00:00.000Z", id: SECOND_ID });
  assert.deepEqual(await second.json(), {
    ok: true, total_visitors: 2, today_visitors: 2, approximate: true,
  });
});

test("missing or malformed visitor cookies are replaced safely", async () => {
  for (const cookieValue of ["", `${VISITOR_COOKIE}=not-a-uuid`]) {
    const db = new MemoryD1();
    const response = await visit(db, { cookie: cookieValue });
    const setCookie = response.headers.get("set-cookie");
    assert.match(setCookie, new RegExp(`${VISITOR_COOKIE}=${FIRST_ID}`));
    assert.match(setCookie, /HttpOnly/);
    assert.match(setCookie, /Secure/);
    assert.match(setCookie, /SameSite=Lax/);
  }
});

test("GET, cross-origin, and request bodies are rejected", async () => {
  const db = new MemoryD1();
  assert.equal((await visit(db, { method: "GET" })).status, 405);
  assert.equal((await visit(db, { headers: { Origin: "https://attacker.example" } })).status, 403);
  assert.equal((await visit(db, { body: "{}" })).status, 413);
  assert.equal(db.visitors.size, 0);
});

test("an empty runtime request stream is accepted as a bodyless POST", async () => {
  const db = new MemoryD1();
  const emptyStreamRequest = new Request("https://postdoc.researchzeal.com/api/visit", {
    method: "POST",
    body: new Uint8Array(0),
  });
  const response = await handleVisitRequest(emptyStreamRequest, { DB: db }, {
    now: new Date("2026-08-03T12:00:00.000Z"),
    randomUUID: () => FIRST_ID,
  });
  assert.equal(response.status, 200);
});

test("D1 failures return a safe response without database details", async () => {
  const db = new MemoryD1();
  db.fail = true;
  const response = await visit(db);
  assert.equal(response.status, 503);
  const body = await response.text();
  assert.equal(body.includes("private database detail"), false);
  assert.match(body, /temporarily unavailable/);
});

test("visitor API SQL never references jobs or collection tables", async () => {
  const db = new MemoryD1();
  await visit(db);
  assert.equal(db.sql.length > 0, true);
  assert.equal(db.sql.every((sql) => /site_visitors|site_visitor_days/.test(sql)), true);
  assert.equal(db.sql.some((sql) => /\bjobs\b|collection_|source_runs|job_sources/.test(sql)), false);
});
