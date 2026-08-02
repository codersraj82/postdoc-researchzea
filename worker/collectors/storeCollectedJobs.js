import { createContentHash } from "./hashing.js";
import { isUsableApplicationUrl } from "./selectApplicationUrl.js";

const EDITABLE_COLUMNS = [
  "title",
  "institution",
  "country",
  "city",
  "research_area",
  "language",
  "description",
  "apply_url",
  "source_url",
  "deadline",
  "posted_at",
  "employment_type",
  "duration",
  "tags_json",
  "source_name",
  "content_hash",
  "source_type",
  "canonical_url",
];

function databaseValues(job) {
  return {
    ...job,
    tags_json: JSON.stringify(job.tags ?? []),
  };
}

function parseTags(value) {
  try {
    const tags = JSON.parse(value);
    return Array.isArray(tags) ? tags : [];
  } catch {
    return [];
  }
}

function mapExisting(row) {
  return row ? { ...row, tags: parseTags(row.tags_json) } : null;
}

function useful(value, weakValues = []) {
  const normalized = String(value ?? "").trim();
  return normalized && !weakValues.includes(normalized.toLowerCase());
}

function explicitApplication(job) {
  return useful(job?.apply_url)
    && isUsableApplicationUrl(job.apply_url, { sourceUrl: job.source_url })
    && job.apply_url !== job.source_url
    && job.apply_url !== job.canonical_url;
}

function preferred(existing, incoming, field, weakValues = []) {
  return useful(incoming[field], weakValues)
    ? incoming[field]
    : existing?.[field] ?? incoming[field];
}

export async function mergeCollectedJob(existing, incoming) {
  if (!existing?.id) return incoming;
  const htmlIsCurrent = incoming.source_type === "html";
  const preserveHtmlContent = existing.source_type === "html" && !htmlIsCurrent;
  const mergedTags = [...new Set([...(incoming.tags ?? []), ...(existing.tags ?? [])])].slice(0, 10);
  const merged = {
    ...incoming,
    id: existing.id,
    first_seen_at: existing.first_seen_at,
    title: preserveHtmlContent
      ? existing.title
      : preferred(existing, incoming, "title"),
    description: preserveHtmlContent
      ? existing.description
      : preferred(existing, incoming, "description"),
    institution: preferred(existing, incoming, "institution", ["see original source"]),
    country: preferred(existing, incoming, "country", ["not specified"]),
    city: preferred(existing, incoming, "city"),
    deadline: preferred(existing, incoming, "deadline"),
    duration: preferred(existing, incoming, "duration"),
    apply_url: explicitApplication(incoming)
      ? incoming.apply_url
      : explicitApplication(existing)
        ? existing.apply_url
        : incoming.apply_url,
    source_type: htmlIsCurrent || existing.source_type === "html" ? "html" : "rss",
    canonical_url: incoming.canonical_url || existing.canonical_url,
    tags: mergedTags,
  };
  merged.content_hash = await createContentHash(merged);
  return merged;
}

export function createD1JobRepository(db) {
  return {
    async findByIdentity(sourceKey, sourceItemId) {
      const row = await db
        .prepare(
          `SELECT *
           FROM jobs
           WHERE source_key = ? AND source_item_id = ?
             AND origin_type = 'collected' AND is_demo = 0
           LIMIT 1`,
        )
        .bind(sourceKey, sourceItemId)
        .first();
      return mapExisting(row);
    },

    async findByCanonicalUrl(sourceKey, canonicalUrl) {
      if (!canonicalUrl) return null;
      const row = await db
        .prepare(
          `SELECT * FROM jobs
           WHERE source_key = ? AND canonical_url = ?
             AND origin_type = 'collected' AND is_demo = 0
           LIMIT 1`,
        )
        .bind(sourceKey, canonicalUrl)
        .first();
      return mapExisting(row);
    },

    async findBySourceUrl(sourceUrl) {
      if (!sourceUrl) return null;
      const row = await db
        .prepare(
          `SELECT *
           FROM jobs
           WHERE source_url = ? AND origin_type = 'collected' AND is_demo = 0
           LIMIT 1`,
        )
        .bind(sourceUrl)
        .first();
      return mapExisting(row);
    },

    async insert(job) {
      const row = databaseValues(job);
      await db
        .prepare(
          `INSERT INTO jobs (
             id, title, institution, country, city, research_area, language,
             description, apply_url, source_url, deadline, posted_at,
             employment_type, duration, tags_json, is_active, is_demo,
             created_at, updated_at, origin_type, source_key, source_name,
             source_item_id, content_hash, first_seen_at, last_seen_at,
             last_verified_at, collection_state, source_type, canonical_url,
             expiry_reason
           ) VALUES (
             ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
             ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
           )`,
        )
        .bind(
          row.id, row.title, row.institution, row.country, row.city || null,
          row.research_area, row.language, row.description, row.apply_url,
          row.source_url, row.deadline, row.posted_at, row.employment_type,
          row.duration || null, row.tags_json, 1, 0, row.created_at,
          row.updated_at, "collected", row.source_key, row.source_name,
          row.source_item_id, row.content_hash, row.first_seen_at,
          row.last_seen_at, row.last_verified_at, "active",
          row.source_type, row.canonical_url, null,
        )
        .run();
    },

    async touch(id, job) {
      await db
        .prepare(
          `UPDATE jobs
           SET last_seen_at = ?, last_verified_at = ?, collection_state = 'active',
               expiry_reason = NULL, is_active = 1
           WHERE id = ? AND origin_type = 'collected' AND is_demo = 0`,
        )
        .bind(job.last_seen_at, job.last_verified_at, id)
        .run();
    },

    async update(id, job) {
      const row = databaseValues(job);
      await db
        .prepare(
          `UPDATE jobs SET
             title = ?, institution = ?, country = ?, city = ?,
             research_area = ?, language = ?, description = ?, apply_url = ?,
             source_url = ?, deadline = ?, posted_at = ?, employment_type = ?,
             duration = ?, tags_json = ?, source_name = ?, content_hash = ?,
             source_type = ?, canonical_url = ?,
             last_seen_at = ?, last_verified_at = ?, collection_state = 'active',
             expiry_reason = NULL, is_active = 1, updated_at = ?
           WHERE id = ? AND origin_type = 'collected' AND is_demo = 0`,
        )
        .bind(
          ...EDITABLE_COLUMNS.map((column) => row[column] || null),
          row.last_seen_at, row.last_verified_at, row.updated_at, id,
        )
        .run();
    },
  };
}

export async function storeCollectedJobs(jobs, repository) {
  const metrics = { inserted: 0, updated: 0, unchanged: 0 };
  for (const job of jobs) {
    let existing = await repository.findByIdentity(job.source_key, job.source_item_id);
    if (!existing && repository.findByCanonicalUrl) {
      existing = await repository.findByCanonicalUrl(job.source_key, job.canonical_url);
    }
    if (!existing) existing = await repository.findBySourceUrl(job.source_url);
    if (existing?.content_hash === job.content_hash) {
      await repository.touch(existing.id, job);
      metrics.unchanged += 1;
      continue;
    }
    const candidate = await mergeCollectedJob(existing, job);

    if (!existing) {
      await repository.insert(candidate);
      metrics.inserted += 1;
    } else if (existing.content_hash === candidate.content_hash) {
      await repository.touch(existing.id, candidate);
      metrics.unchanged += 1;
    } else {
      await repository.update(existing.id, candidate);
      metrics.updated += 1;
    }
  }
  return metrics;
}
