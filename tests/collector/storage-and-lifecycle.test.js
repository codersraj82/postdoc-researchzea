import assert from "node:assert/strict";
import test from "node:test";

import { collectionStateFor } from "../../worker/collectors/expireCollectedJobs.js";
import { publicDatasetCondition } from "../../worker/collectors/publicJobs.js";
import { storeCollectedJobs } from "../../worker/collectors/storeCollectedJobs.js";

function fakeRepository() {
  const rows = new Map();
  const calls = { insert: 0, touch: 0, update: 0 };
  return {
    calls,
    rows,
    async findByIdentity(sourceKey, itemId) {
      return rows.get(`${sourceKey}:${itemId}`) ?? null;
    },
    async findBySourceUrl() {
      return null;
    },
    async insert(job) {
      calls.insert += 1;
      rows.set(`${job.source_key}:${job.source_item_id}`, { id: job.id, content_hash: job.content_hash });
    },
    async touch() {
      calls.touch += 1;
    },
    async update(id, job) {
      calls.update += 1;
      rows.set(`${job.source_key}:${job.source_item_id}`, { id, content_hash: job.content_hash });
    },
  };
}

const baseJob = {
  id: "collected-one",
  source_key: "imechanica-job-channel",
  source_item_id: "one",
  source_url: "https://www.imechanica.org/node/one",
  content_hash: "hash-one",
};

test("duplicate items insert once and then use unchanged handling", async () => {
  const repository = fakeRepository();
  const result = await storeCollectedJobs([baseJob, baseJob], repository);
  assert.deepEqual(result, { inserted: 1, updated: 0, unchanged: 1, duplicatesMerged: 0 });
  assert.deepEqual(repository.calls, { insert: 1, touch: 1, update: 0 });
});

test("changed item updates the existing collected record", async () => {
  const repository = fakeRepository();
  await storeCollectedJobs([baseJob], repository);
  const result = await storeCollectedJobs([{ ...baseJob, content_hash: "hash-two" }], repository);
  assert.deepEqual(result, { inserted: 0, updated: 1, unchanged: 0, duplicatesMerged: 0 });
  assert.equal(repository.calls.update, 1);
});

test("collected lifecycle uses deadline, 45-day stale, and 75-day expiry rules", () => {
  const now = new Date("2026-08-02T12:00:00.000Z");
  assert.equal(collectionStateFor({ deadline: "2026-08-01" }, now), "expired");
  assert.equal(collectionStateFor({ last_seen_at: "2026-06-10T12:00:00.000Z" }, now), "stale");
  assert.equal(collectionStateFor({ last_seen_at: "2026-05-01T12:00:00.000Z" }, now), "expired");
  assert.equal(collectionStateFor({ last_seen_at: "2026-07-20T12:00:00.000Z" }, now), "active");
});

test("public dataset switches from demos to active real collected jobs", () => {
  assert.match(publicDatasetCondition(true), /origin_type = 'collected'/);
  assert.match(publicDatasetCondition(true), /is_demo = 0/);
  assert.match(publicDatasetCondition(false), /origin_type = 'seed'/);
  assert.match(publicDatasetCondition(false), /is_demo = 1/);
});
