import assert from "node:assert/strict";
import test from "node:test";

import {
  aggregateSourceRunStatus,
} from "../../worker/collectors/collectionRuns.js";
import {
  consumeSourceQueue,
  isTemporaryCollectionFailure,
  processSourceQueueMessage,
  sourceRunFailureStatus,
} from "../../worker/collectors/consumeSourceQueue.js";
import {
  createOnDemandSourceQueueMessage,
  createSourceQueueMessage,
  validateSourceQueueMessage,
} from "../../worker/collectors/queueMessage.js";
import { scheduleDueSources } from "../../worker/collectors/scheduleSources.js";
import {
  calculateBackoff,
  isSourceDue,
} from "../../worker/collectors/sourceSchedule.js";
import { storeCollectedJobs } from "../../worker/collectors/storeCollectedJobs.js";

const now = new Date("2026-08-02T12:00:00.000Z");
const uuids = [
  "00000000-0000-4000-8000-000000000001",
  "00000000-0000-4000-8000-000000000002",
  "00000000-0000-4000-8000-000000000003",
  "00000000-0000-4000-8000-000000000004",
  "00000000-0000-4000-8000-000000000005",
];

function source(key = "fixture-source", overrides = {}) {
  return {
    key,
    name: `Fixture ${key}`,
    type: "html",
    enabled: true,
    priority: 10,
    collectionInterval: "daily",
    modes: { htmlFallback: { listingUrls: [`https://${key}.example/jobs`] } },
    ...overrides,
  };
}

function message(body, attempts = 1) {
  const calls = { ack: 0, retry: [] };
  return {
    id: `cloudflare-${body.messageId}`,
    body,
    attempts,
    ack() { calls.ack += 1; },
    retry(options) { calls.retry.push(options); },
    calls,
  };
}

function validBody(sourceKey = "fixture-source", index = 0) {
  return {
    version: 1,
    messageId: uuids[index + 1],
    runId: uuids[0],
    sourceKey,
    scheduledAt: now.toISOString(),
    attemptContext: { reason: "scheduled" },
  };
}

function schedulerDb(states = []) {
  const sourceRuns = [];
  const collectionRuns = [];
  return {
    sourceRuns,
    collectionRuns,
    prepare(sql) {
      const statement = {
        async all() {
          if (sql.includes("FROM collector_sources")) return { results: states };
          return { results: [] };
        },
        bind(...values) {
          return {
            async all() {
              if (sql.includes("FROM collector_sources")) return { results: states };
              return { results: [] };
            },
            async run() {
              if (sql.includes("INSERT INTO collection_runs")) collectionRuns.push(values);
              if (sql.includes("INSERT INTO source_runs")) sourceRuns.push(values);
              return { meta: { changes: 1 } };
            },
          };
        },
      };
      return statement;
    },
  };
}

function consumerDb(runs, searches = []) {
  const sourceRuns = new Map(runs.map((run) => [run.message_id, { ...run }]));
  const searchRequests = new Map(searches.map((request) => [request.id, { ...request }]));
  return {
    sourceRuns,
    searchRequests,
    prepare(sql) {
      return {
        bind(...values) {
          return {
            async first() {
              if (sql.includes("SELECT * FROM source_runs")) return sourceRuns.get(values[0]) ?? null;
              if (sql.includes("FROM collector_sources")) return null;
              if (sql.includes("FROM source_search_requests") && sql.includes("WHERE id = ?")) {
                return searchRequests.get(values[0]) ?? null;
              }
              if (sql.includes("FROM source_search_requests") && sql.includes("collection_run_id = ?")) {
                return [...searchRequests.values()].find((request) =>
                  request.collection_run_id === values[0]) ?? null;
              }
              return null;
            },
            async all() { return { results: [] }; },
            async run() {
              if (sql.includes("UPDATE source_runs SET status = 'running'")) {
                const run = sourceRuns.get(values.at(-1));
                if (run) run.status = "running";
              } else if (sql.includes("UPDATE source_runs SET status = 'skipped'")) {
                const run = sourceRuns.get(values.at(-1));
                if (run && ["queued", "running"].includes(run.status)) {
                  run.status = "skipped";
                  run.mode_used = values[1];
                  run.error_code = values[2];
                  run.finished_at = values[0];
                }
              } else if (sql.includes("UPDATE source_runs SET") && sql.includes("status = ?")) {
                const run = sourceRuns.get(values.at(-1));
                if (run) run.status = values[0];
              }
              return { meta: { changes: 1 } };
            },
          };
        },
      };
    },
  };
}

function memoryRepository() {
  const rows = new Map();
  const observations = new Map();
  const calls = { insert: 0, touch: 0, update: 0, promote: 0 };
  const collected = () => [...rows.values()];
  return {
    rows,
    observations,
    calls,
    async findByIdentity(key, item) {
      return collected().find((row) => row.source_key === key && row.source_item_id === item)
        ?? [...observations.values()].find((entry) => entry.source_key === key && entry.source_item_id === item)?.job
        ?? null;
    },
    async findByCanonicalUrl(key, url) {
      return collected().find((row) => row.source_key === key && row.canonical_url === url) ?? null;
    },
    async findBySourceUrl(url) { return collected().find((row) => row.source_url === url) ?? null; },
    async findCrossSourceDuplicate(job) {
      return collected().find((row) => row.apply_url === job.apply_url) ?? null;
    },
    async insert(job) { calls.insert += 1; rows.set(job.id, { ...job }); },
    async touch() { calls.touch += 1; },
    async update(id, job) { calls.update += 1; rows.set(id, { ...job, id }); },
    async demotePrimary() {
      for (const observation of observations.values()) observation.isPrimary = false;
    },
    async promotePrimary(id, job) { calls.promote += 1; rows.set(id, { ...job, id }); },
    async upsertObservation(jobId, job, isPrimary) {
      observations.set(`${job.source_key}:${job.source_item_id}`, {
        job: rows.get(jobId), source_key: job.source_key,
        source_item_id: job.source_item_id, isPrimary,
      });
    },
    async markObservationClosed() { return 0; },
  };
}

function normalizedJob(sourceKey = "fixture-source", item = "REQ-1", applyUrl = "https://official.example/apply/1") {
  return {
    id: `job-${sourceKey}-${item}`,
    title: "Fictional Postdoctoral Fellow",
    institution: "Fixture Institute",
    country: "Germany",
    city: "Berlin",
    research_area: "Biology",
    language: "English",
    source_language: "en",
    original_title: "Fictional Postdoctoral Fellow",
    original_description: "A fictional postdoctoral vacancy.",
    description: "A fictional postdoctoral vacancy.",
    apply_url: applyUrl,
    source_url: `https://${sourceKey}.example/job/${item}`,
    canonical_url: `https://${sourceKey}.example/job/${item}`,
    deadline: "2026-10-01",
    posted_at: "2026-08-01",
    employment_type: "Postdoctoral position",
    duration: "2 years",
    tags: ["Postdoctoral"],
    is_demo: 0,
    origin_type: "collected",
    source_key: sourceKey,
    source_name: `Fixture ${sourceKey}`,
    source_item_id: item,
    source_type: "html",
    observation_source_type: "html",
    content_hash: `hash-${sourceKey}-${item}`,
    first_seen_at: now.toISOString(),
    last_seen_at: now.toISOString(),
    last_verified_at: now.toISOString(),
    collection_state: "active",
    created_at: now.toISOString(),
    updated_at: now.toISOString(),
  };
}

test("queue message contract accepts only controlled identifiers", () => {
  let index = 0;
  const created = createSourceQueueMessage({
    runId: uuids[0], sourceKey: "fixture-source", scheduledAt: now,
    uuid: () => uuids[++index],
  });
  assert.deepEqual(Object.keys(created).sort(), [
    "attemptContext", "messageId", "runId", "scheduledAt", "sourceKey", "version",
  ]);
  assert.equal(validateSourceQueueMessage(created, () => source()).valid, true);
  assert.equal(validateSourceQueueMessage({ ...created, sourceUrl: "https://unsafe.example" }, () => source()).valid, false);
  assert.equal(validateSourceQueueMessage({ ...created, sourceKey: "unknown" }, () => null).valid, false);
});

test("version-2 on-demand messages contain only approved identifiers and preserve version 1", () => {
  let index = 0;
  const scheduled = createSourceQueueMessage({
    runId: uuids[0], sourceKey: "fixture-source", scheduledAt: now,
    uuid: () => uuids[++index],
  });
  assert.equal(scheduled.version, 1);
  assert.equal(validateSourceQueueMessage(scheduled, () => source()).valid, true);

  index = 0;
  const onDemand = createOnDemandSourceQueueMessage({
    runId: uuids[0],
    sourceKey: "fixture-source",
    searchRequestId: uuids[4],
    scheduledAt: now,
    uuid: () => uuids[++index],
  });
  assert.equal(onDemand.version, 2);
  assert.deepEqual(onDemand.attemptContext, {
    reason: "on_demand",
    searchRequestId: uuids[4],
  });
  assert.equal(JSON.stringify(onDemand).includes("keyword"), false);
  assert.equal(JSON.stringify(onDemand).includes("http"), false);
  assert.equal(validateSourceQueueMessage(onDemand, () => source()).valid, true);
  assert.equal(validateSourceQueueMessage({
    ...onDemand,
    attemptContext: { ...onDemand.attemptContext, keyword: "quantum" },
  }, () => source()).valid, false);
  assert.equal(validateSourceQueueMessage({ ...onDemand, sourceKey: "disabled" }, () => source("disabled", { enabled: false })).valid, false);
});

test("scheduled producer sends one message only for each due enabled source", async () => {
  const due = source("due-source");
  const recent = source("recent-source");
  const disabled = source("disabled-source", { enabled: false });
  const db = schedulerDb([{
    source_key: recent.key,
    last_attempt_at: "2026-08-02T10:00:00.000Z",
    last_success_at: "2026-08-02T10:00:00.000Z",
  }]);
  const sent = [];
  let index = 0;
  const result = await scheduleDueSources({
    DB: db,
    SOURCE_COLLECTION_QUEUE: { async send(body) { sent.push(body); } },
  }, { cron: "17 1,13 * * *", scheduledTime: now.getTime() }, {
    now,
    sources: [due, recent, disabled],
    uuid: () => uuids[index++],
  });
  assert.deepEqual(result.dueSources, ["due-source"]);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].sourceKey, "due-source");
  assert.equal(db.sourceRuns.length, 1);
});

test("due calculation, failure backoff, retry classification, and finalization are deterministic", () => {
  assert.equal(isSourceDue(source(), {}, now), true);
  assert.equal(isSourceDue(source(), { last_success_at: "2026-08-02T10:00:00.000Z" }, now), false);
  assert.equal(calculateBackoff(1, now), null);
  assert.equal(calculateBackoff(2, now), "2026-08-03T00:00:00.000Z");
  assert.equal(calculateBackoff(3, now), "2026-08-03T12:00:00.000Z");
  assert.equal(calculateBackoff(4, now), "2026-08-05T12:00:00.000Z");
  assert.match(calculateBackoff(1, now, { policyFailure: true }), /^9999-/);
  assert.equal(isTemporaryCollectionFailure({ retryable: true }), true);
  assert.equal(isTemporaryCollectionFailure({ code: "ROBOTS_DISALLOWED" }), false);
  assert.equal(sourceRunFailureStatus(3, true), "running");
  assert.equal(sourceRunFailureStatus(4, true), "dead_lettered");
  assert.equal(aggregateSourceRunStatus([{ status: "success" }, { status: "failed" }]), "partial");
  assert.equal(aggregateSourceRunStatus([{ status: "failed" }, { status: "dead_lettered" }]), "failed");
  assert.equal(aggregateSourceRunStatus([{ status: "skipped" }]), "skipped");
  assert.equal(aggregateSourceRunStatus([{ status: "queued" }]), "running");
});

test("successful consumption is idempotent across duplicate delivery and restart after upsert", async () => {
  const definition = source();
  const body = validBody();
  const db = consumerDb([{
    message_id: body.messageId,
    collection_run_id: body.runId,
    source_key: body.sourceKey,
    status: "queued",
  }]);
  const repository = memoryRepository();
  const adapter = {
    async collectSourceEntries() {
      return { entries: [{ title: "Fictional Postdoctoral Fellow", descriptionHtml: "Postdoctoral vacancy." }], mode: "fixture", stats: {} };
    },
    async normalizeSourceEntry() { return normalizedJob(); },
    validateSourceEntry() { return { valid: true, errors: [] }; },
  };
  const options = {
    now,
    repository,
    getSourceDefinition: () => definition,
    getSourceAdapter: () => adapter,
    getSourcePriority: () => 10,
    expireCollectedJobs: async () => ({ stale: 0, expired: 0 }),
    finalizeCollectionRun: async () => ({ status: "success", finalized: true }),
  };
  const first = message(body);
  assert.equal((await processSourceQueueMessage(first, { DB: db }, options)).status, "success");
  assert.equal(first.calls.ack, 1);
  const duplicate = message(body, 2);
  assert.equal((await processSourceQueueMessage(duplicate, { DB: db }, options)).status, "duplicate");
  assert.equal(repository.calls.insert, 1);

  const restartedBody = { ...body, messageId: uuids[2] };
  db.sourceRuns.set(restartedBody.messageId, {
    message_id: restartedBody.messageId,
    collection_run_id: restartedBody.runId,
    source_key: restartedBody.sourceKey,
    status: "running",
  });
  await processSourceQueueMessage(message(restartedBody, 2), { DB: db }, options);
  assert.equal(repository.calls.insert, 1);
  assert.equal(repository.calls.touch, 1);
});

test("on-demand consumption validates the linked search, stays idempotent, and finalizes it", async () => {
  const definition = source();
  const body = createOnDemandSourceQueueMessage({
    runId: uuids[0],
    sourceKey: definition.key,
    searchRequestId: uuids[4],
    scheduledAt: now,
    uuid: () => uuids[1],
  });
  const db = consumerDb([{
    message_id: body.messageId,
    collection_run_id: body.runId,
    source_key: body.sourceKey,
    status: "queued",
  }], [{
    id: body.attemptContext.searchRequestId,
    collection_run_id: body.runId,
    status: "queued",
  }]);
  const repository = memoryRepository();
  let collections = 0;
  let searches = 0;
  let runningMarks = 0;
  const adapter = {
    async collectSourceEntries() {
      return {
        entries: [{ title: "Fictional Postdoctoral Fellow", descriptionHtml: "Postdoctoral vacancy." }],
        mode: "fixture",
        stats: {},
      };
    },
    async normalizeSourceEntry() { return normalizedJob(); },
    validateSourceEntry() { return { valid: true, errors: [] }; },
  };
  const options = {
    now,
    repository,
    getSourceDefinition: () => definition,
    getSourceAdapter: () => adapter,
    getSourcePriority: () => 10,
    sourceRefreshDisposition: () => ({ eligible: true }),
    markSourceSearchRunning: async () => { runningMarks += 1; },
    expireCollectedJobs: async () => ({ stale: 0, expired: 0 }),
    finalizeCollectionRun: async () => { collections += 1; },
    finalizeSourceSearchRequest: async () => { searches += 1; },
  };
  const first = message(body);
  assert.equal((await processSourceQueueMessage(first, { DB: db }, options)).status, "success");
  assert.equal(first.calls.ack, 1);
  assert.equal(runningMarks, 1);
  assert.equal(collections, 1);
  assert.equal(searches, 1);

  const duplicate = message(body, 2);
  assert.equal((await processSourceQueueMessage(duplicate, { DB: db }, options)).status, "duplicate");
  assert.equal(duplicate.calls.ack, 1);
  assert.equal(repository.calls.insert, 1);
  assert.equal(searches, 2);
});

test("on-demand delivery rechecks the source cooldown without crawling", async () => {
  const definition = source();
  const body = createOnDemandSourceQueueMessage({
    runId: uuids[0],
    sourceKey: definition.key,
    searchRequestId: uuids[4],
    scheduledAt: now,
    uuid: () => uuids[1],
  });
  const db = consumerDb([{
    message_id: body.messageId,
    collection_run_id: body.runId,
    source_key: body.sourceKey,
    status: "queued",
  }], [{
    id: body.attemptContext.searchRequestId,
    collection_run_id: body.runId,
    status: "running",
  }]);
  let collected = 0;
  let searches = 0;
  const queuedMessage = message(body);
  const result = await processSourceQueueMessage(queuedMessage, { DB: db }, {
    now,
    getSourceDefinition: () => definition,
    getSourceAdapter: () => ({
      async collectSourceEntries() { collected += 1; return { entries: [] }; },
    }),
    sourceRefreshDisposition: () => ({
      eligible: false,
      reliable: true,
      mode: "recent-cache",
      code: null,
    }),
    finalizeCollectionRun: async () => {},
    finalizeSourceSearchRequest: async () => { searches += 1; },
  });
  assert.equal(result.status, "skipped");
  assert.equal(collected, 0);
  assert.equal(searches, 1);
  assert.equal(queuedMessage.calls.ack, 1);
});

test("malformed messages terminate existing linked runs and searches idempotently", async () => {
  const cases = [
    {
      name: "malformed v2 searchRequestId",
      mutate: (body) => ({
        ...body,
        attemptContext: { reason: "on_demand", searchRequestId: "invalid" },
      }),
    },
    { name: "unsupported version", mutate: (body) => ({ ...body, version: 99 }) },
    { name: "invalid sourceKey", mutate: (body) => ({ ...body, sourceKey: "INVALID" }) },
  ];
  for (const [index, fixture] of cases.entries()) {
    const definition = source();
    const searchRequestId = `00000000-0000-4000-8000-00000000002${index}`;
    const base = createOnDemandSourceQueueMessage({
      runId: uuids[0],
      sourceKey: definition.key,
      searchRequestId,
      scheduledAt: now,
      uuid: () => uuids[index + 1],
    });
    const malformed = fixture.mutate(base);
    const db = consumerDb([{
      message_id: base.messageId,
      collection_run_id: base.runId,
      source_key: base.sourceKey,
      status: "queued",
    }], [{
      id: searchRequestId,
      collection_run_id: base.runId,
      status: "running",
    }]);
    let collectionStatus = "running";
    const options = {
      now,
      getSourceDefinition: (key) => key === definition.key ? definition : null,
      finalizeCollectionRun: async () => { collectionStatus = "skipped"; },
      finalizeSourceSearchRequest: async (_database, requestId) => {
        const search = db.searchRequests.get(requestId);
        if (search) search.status = "failed";
      },
    };
    const first = message(malformed);
    const firstResult = await processSourceQueueMessage(first, { DB: db }, options);
    assert.equal(firstResult.status, "rejected", fixture.name);
    assert.equal(first.calls.ack, 1, fixture.name);
    assert.equal(db.sourceRuns.get(base.messageId).status, "skipped", fixture.name);
    assert.equal(db.sourceRuns.get(base.messageId).error_code, "INVALID_MESSAGE", fixture.name);
    assert.equal(collectionStatus, "skipped", fixture.name);
    assert.equal(db.searchRequests.get(searchRequestId).status, "failed", fixture.name);

    const duplicate = message(malformed, 2);
    await processSourceQueueMessage(duplicate, { DB: db }, options);
    assert.equal(duplicate.calls.ack, 1, fixture.name);
    assert.equal(db.sourceRuns.get(base.messageId).status, "skipped", fixture.name);
    assert.equal(db.searchRequests.get(searchRequestId).status, "failed", fixture.name);
  }
});

test("temporary failures retry, permanent failures acknowledge, and one source does not block another", async () => {
  const temporarySource = source("temporary-source");
  const successfulSource = source("successful-source");
  const temporaryBody = validBody(temporarySource.key, 0);
  const successfulBody = validBody(successfulSource.key, 1);
  const db = consumerDb([
    { message_id: temporaryBody.messageId, collection_run_id: temporaryBody.runId, source_key: temporaryBody.sourceKey, status: "queued" },
    { message_id: successfulBody.messageId, collection_run_id: successfulBody.runId, source_key: successfulBody.sourceKey, status: "queued" },
  ]);
  const repository = memoryRepository();
  const temporaryMessage = message(temporaryBody);
  const successfulMessage = message(successfulBody);
  const results = await consumeSourceQueue(
    { queue: "fixture", messages: [temporaryMessage, successfulMessage] },
    { DB: db },
    {},
    {
      now,
      repository,
      getSourceDefinition: (key) => key === temporarySource.key ? temporarySource : successfulSource,
      getSourceAdapter: (key) => key === temporarySource.key
        ? { async collectSourceEntries() { const error = new Error("timeout"); error.retryable = true; throw error; } }
        : {
            async collectSourceEntries() { return { entries: [{ title: "Postdoctoral Fellow", descriptionHtml: "Postdoctoral role" }], mode: "fixture", stats: {} }; },
            async normalizeSourceEntry() { return normalizedJob(successfulSource.key); },
            validateSourceEntry() { return { valid: true }; },
          },
      getSourcePriority: () => 10,
      expireCollectedJobs: async () => ({ stale: 0, expired: 0 }),
      finalizeCollectionRun: async () => ({ status: "success", finalized: true }),
    },
  );
  assert.deepEqual(results.map((result) => result.status), ["running", "success"]);
  assert.equal(temporaryMessage.calls.retry.length, 1);
  assert.equal(successfulMessage.calls.ack, 1);

  const permanentBody = { ...temporaryBody, messageId: uuids[4] };
  db.sourceRuns.set(permanentBody.messageId, {
    message_id: permanentBody.messageId,
    collection_run_id: permanentBody.runId,
    source_key: permanentBody.sourceKey,
    status: "queued",
  });
  const permanentMessage = message(permanentBody);
  const permanentAdapter = {
    async collectSourceEntries() {
      const error = new Error("unsupported schema");
      error.code = "SOURCE_SCHEMA_INVALID";
      error.retryable = false;
      throw error;
    },
  };
  const result = await processSourceQueueMessage(permanentMessage, { DB: db }, {
    now,
    getSourceDefinition: () => temporarySource,
    getSourceAdapter: () => permanentAdapter,
    finalizeCollectionRun: async () => ({ status: "failed", finalized: true }),
  });
  assert.equal(result.status, "failed");
  assert.equal(permanentMessage.calls.ack, 1);
  assert.equal(permanentMessage.calls.retry.length, 0);
});

test("cross-source duplicate evidence keeps one job and two source observations", async () => {
  const repository = memoryRepository();
  const sharedApply = "https://official.example/apply/shared";
  const portal = normalizedJob("portal-source", "PORTAL-1", sharedApply);
  const official = normalizedJob("official-source", "REQ-1", sharedApply);
  await storeCollectedJobs([portal], repository, {
    getSourcePriority: (key) => key === "official-source" ? 10 : 40,
  });
  const result = await storeCollectedJobs([official], repository, {
    getSourcePriority: (key) => key === "official-source" ? 10 : 40,
  });
  assert.equal(repository.rows.size, 1);
  assert.equal(repository.observations.size, 2);
  assert.equal(result.duplicatesMerged, 1);
  assert.equal(repository.calls.promote, 1);
  assert.equal([...repository.rows.values()][0].source_key, "official-source");
});
