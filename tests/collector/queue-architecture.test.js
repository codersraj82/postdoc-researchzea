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

function consumerDb(runs) {
  const sourceRuns = new Map(runs.map((run) => [run.message_id, { ...run }]));
  return {
    sourceRuns,
    prepare(sql) {
      return {
        bind(...values) {
          return {
            async first() {
              if (sql.includes("SELECT * FROM source_runs")) return sourceRuns.get(values[0]) ?? null;
              if (sql.includes("FROM collector_sources")) return null;
              return null;
            },
            async all() { return { results: [] }; },
            async run() {
              if (sql.includes("UPDATE source_runs SET status = 'running'")) {
                const run = sourceRuns.get(values.at(-1));
                if (run) run.status = "running";
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
    status: "running",
  });
  await processSourceQueueMessage(message(restartedBody, 2), { DB: db }, options);
  assert.equal(repository.calls.insert, 1);
  assert.equal(repository.calls.touch, 1);
});

test("temporary failures retry, permanent failures acknowledge, and one source does not block another", async () => {
  const temporarySource = source("temporary-source");
  const successfulSource = source("successful-source");
  const temporaryBody = validBody(temporarySource.key, 0);
  const successfulBody = validBody(successfulSource.key, 1);
  const db = consumerDb([
    { message_id: temporaryBody.messageId, collection_run_id: temporaryBody.runId, status: "queued" },
    { message_id: successfulBody.messageId, collection_run_id: successfulBody.runId, status: "queued" },
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
