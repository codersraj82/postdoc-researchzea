import { createContentHash } from "./hashing.js";
import { isUsableApplicationUrl } from "./selectApplicationUrl.js";

const EDITABLE_COLUMNS = [
  "title",
  "institution",
  "country",
  "city",
  "research_area",
  "language",
  "source_language",
  "original_title",
  "original_description",
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
    original_title: preserveHtmlContent
      ? existing.original_title || existing.title
      : preferred(existing, incoming, "original_title"),
    original_description: preserveHtmlContent
      ? existing.original_description || existing.description
      : preferred(existing, incoming, "original_description"),
    source_language: preferred(existing, incoming, "source_language", ["unknown"]),
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
      let row = await db
        .prepare(
          `SELECT *
           FROM jobs
           WHERE source_key = ? AND source_item_id = ?
             AND origin_type = 'collected' AND is_demo = 0
           LIMIT 1`,
        )
        .bind(sourceKey, sourceItemId)
        .first();
      if (!row) {
        row = await db.prepare(
          `SELECT j.* FROM job_sources js
           JOIN jobs j ON j.id = js.job_id
           WHERE js.source_key = ? AND js.source_item_id = ?
             AND j.origin_type = 'collected' AND j.is_demo = 0
           LIMIT 1`,
        ).bind(sourceKey, sourceItemId).first();
      }
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

    async findCrossSourceDuplicate(job) {
      const applicationUrl = explicitApplication(job) ? job.apply_url : null;
      const referenceId = /(?=.*[a-z])(?=.*\d)/i.test(job.source_item_id ?? "")
        ? job.source_item_id
        : null;
      const row = await db.prepare(
        `SELECT j.*
         FROM jobs j
         WHERE j.origin_type = 'collected' AND j.is_demo = 0
           AND (
             (? IS NOT NULL AND j.apply_url = ?)
             OR (? IS NOT NULL AND (j.canonical_url = ? OR j.source_url = ?))
             OR (? IS NOT NULL AND LOWER(j.institution) = LOWER(?) AND EXISTS (
               SELECT 1 FROM job_sources js
               WHERE js.job_id = j.id AND js.source_item_id = ?
             ))
             OR (? IS NOT NULL AND LOWER(j.institution) = LOWER(?)
                 AND LOWER(j.title) = LOWER(?) AND j.deadline = ?)
             OR (j.content_hash = ? AND LOWER(j.institution) = LOWER(?)
                 AND LOWER(j.country) = LOWER(?))
           )
         ORDER BY
           CASE
             WHEN ? IS NOT NULL AND j.apply_url = ? THEN 1
             WHEN ? IS NOT NULL AND (j.canonical_url = ? OR j.source_url = ?) THEN 2
             ELSE 3
           END,
           j.first_seen_at ASC
         LIMIT 1`,
      ).bind(
        applicationUrl, applicationUrl,
        job.canonical_url, job.canonical_url, job.source_url,
        referenceId, job.institution, referenceId,
        job.deadline, job.institution, job.title, job.deadline,
        job.content_hash, job.institution, job.country,
        applicationUrl, applicationUrl,
        job.canonical_url, job.canonical_url, job.source_url,
      ).first();
      return mapExisting(row);
    },

    async upsertObservation(jobId, job, isPrimary) {
      const observationId = `observation-${jobId}-${job.source_key}-${String(job.source_item_id).slice(0, 120)}`;
      await db.prepare(
        `INSERT INTO job_sources (
           id, job_id, source_key, source_name, source_type, source_item_id,
           source_url, apply_url, source_language, observed_title, content_hash,
           first_seen_at, last_seen_at, last_verified_at, is_primary,
           observation_state, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(source_key, source_item_id) DO UPDATE SET
           job_id = excluded.job_id,
           source_name = excluded.source_name,
           source_type = excluded.source_type,
           source_url = excluded.source_url,
           apply_url = excluded.apply_url,
           source_language = excluded.source_language,
           observed_title = excluded.observed_title,
           content_hash = excluded.content_hash,
           last_seen_at = excluded.last_seen_at,
           last_verified_at = excluded.last_verified_at,
           is_primary = excluded.is_primary,
           observation_state = excluded.observation_state,
           updated_at = excluded.updated_at`,
      ).bind(
        observationId, jobId, job.source_key, job.source_name,
        job.observation_source_type ?? job.source_type, job.source_item_id,
        job.source_url, job.apply_url, job.source_language, job.original_title ?? job.title,
        job.content_hash, job.first_seen_at, job.last_seen_at, job.last_verified_at,
        isPrimary ? 1 : 0, job.collection_state, job.created_at, job.updated_at,
      ).run();
    },

    async demotePrimary(jobId) {
      await db.prepare(
        `UPDATE job_sources SET is_primary = 0, updated_at = CURRENT_TIMESTAMP
         WHERE job_id = ? AND is_primary = 1`,
      ).bind(jobId).run();
    },

    async promotePrimary(id, job) {
      const row = databaseValues(job);
      await db.prepare(
        `UPDATE jobs SET
           title = ?, institution = ?, country = ?, city = ?,
           research_area = ?, language = ?, source_language = ?,
           original_title = ?, original_description = ?, description = ?,
           apply_url = ?, source_url = ?, deadline = ?, posted_at = ?,
           employment_type = ?, duration = ?, tags_json = ?, source_name = ?,
           content_hash = ?, source_type = ?, canonical_url = ?, source_key = ?,
           source_item_id = ?, last_seen_at = ?, last_verified_at = ?,
           collection_state = 'active', expiry_reason = NULL, is_active = 1,
           updated_at = ?
         WHERE id = ? AND origin_type = 'collected' AND is_demo = 0`,
      ).bind(
        row.title, row.institution, row.country, row.city || null,
        row.research_area, row.language, row.source_language,
        row.original_title, row.original_description, row.description,
        row.apply_url, row.source_url, row.deadline, row.posted_at,
        row.employment_type, row.duration || null, row.tags_json, row.source_name,
        row.content_hash, row.source_type, row.canonical_url, row.source_key,
        row.source_item_id, row.last_seen_at, row.last_verified_at,
        row.updated_at, id,
      ).run();
    },

    async markObservationClosed(sourceKey, sourceItemId, now) {
      const observation = await db.prepare(
        `SELECT job_id, is_primary FROM job_sources
         WHERE source_key = ? AND source_item_id = ? LIMIT 1`,
      ).bind(sourceKey, sourceItemId).first();
      if (!observation) return 0;
      await db.prepare(
        `UPDATE job_sources SET observation_state = 'expired',
           last_verified_at = ?, updated_at = ?
         WHERE source_key = ? AND source_item_id = ?`,
      ).bind(now, now, sourceKey, sourceItemId).run();
      if (Number(observation.is_primary) === 1) {
        await db.prepare(
          `UPDATE jobs SET collection_state = 'expired', is_active = 0,
             expiry_reason = 'primary_source_closed', last_verified_at = ?, updated_at = ?
           WHERE id = ? AND origin_type = 'collected' AND is_demo = 0`,
        ).bind(now, now, observation.job_id).run();
      } else {
        await db.prepare(
          `UPDATE jobs SET collection_state = 'expired', is_active = 0,
             expiry_reason = 'all_sources_inactive', last_verified_at = ?, updated_at = ?
           WHERE id = ? AND origin_type = 'collected' AND is_demo = 0
             AND NOT EXISTS (
               SELECT 1 FROM job_sources
               WHERE job_id = ? AND observation_state = 'active'
             )`,
        ).bind(now, now, observation.job_id, observation.job_id).run();
      }
      return 1;
    },

    async insert(job) {
      const row = databaseValues(job);
      await db
        .prepare(
          `INSERT INTO jobs (
             id, title, institution, country, city, research_area, language,
             source_language, original_title, original_description,
             description, apply_url, source_url, deadline, posted_at,
             employment_type, duration, tags_json, is_active, is_demo,
             created_at, updated_at, origin_type, source_key, source_name,
             source_item_id, content_hash, first_seen_at, last_seen_at,
             last_verified_at, collection_state, source_type, canonical_url,
             expiry_reason
           ) VALUES (
             ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
             ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
           )`,
        )
        .bind(
          row.id, row.title, row.institution, row.country, row.city || null,
          row.research_area, row.language, row.source_language,
          row.original_title, row.original_description, row.description,
          row.apply_url, row.source_url, row.deadline, row.posted_at, row.employment_type,
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
             research_area = ?, language = ?, source_language = ?,
             original_title = ?, original_description = ?,
             description = ?, apply_url = ?,
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

export async function storeCollectedJobs(jobs, repository, options = {}) {
  const metrics = { inserted: 0, updated: 0, unchanged: 0, duplicatesMerged: 0 };
  for (const job of jobs) {
    let existing = await repository.findByIdentity(job.source_key, job.source_item_id);
    if (!existing && repository.findByCanonicalUrl) {
      existing = await repository.findByCanonicalUrl(job.source_key, job.canonical_url);
    }
    if (!existing) existing = await repository.findBySourceUrl(job.source_url);
    if (!existing && repository.findCrossSourceDuplicate) {
      existing = await repository.findCrossSourceDuplicate(job);
    }
    const crossSourceDuplicate = Boolean(
      existing?.source_key && existing.source_key !== job.source_key,
    );
    const incomingPriority = options.getSourcePriority?.(job.source_key)
      ?? options.sourcePriority
      ?? Number.MAX_SAFE_INTEGER;
    const existingPriority = options.getSourcePriority?.(existing?.source_key)
      ?? Number.MAX_SAFE_INTEGER;
    const promoteIncoming = crossSourceDuplicate && incomingPriority < existingPriority;

    if (existing?.content_hash === job.content_hash) {
      if (promoteIncoming && repository.promotePrimary) {
        const promoted = await mergeCollectedJob(existing, job);
        await repository.demotePrimary(existing.id);
        await repository.promotePrimary(existing.id, promoted);
        await repository.upsertObservation(existing.id, job, true);
      } else {
        await repository.touch(existing.id, job);
        if (repository.upsertObservation) {
          await repository.upsertObservation(existing.id, job, !crossSourceDuplicate);
        }
      }
      if (crossSourceDuplicate) metrics.duplicatesMerged += 1;
      metrics.unchanged += 1;
      continue;
    }
    let candidate = await mergeCollectedJob(existing, job);
    if (crossSourceDuplicate && !promoteIncoming) {
      candidate = {
        ...candidate,
        source_key: existing.source_key,
        source_name: existing.source_name,
        source_item_id: existing.source_item_id,
        source_type: existing.source_type,
        canonical_url: existing.canonical_url,
        source_url: existing.source_url,
        source_language: existing.source_language || candidate.source_language,
        original_title: existing.original_title || candidate.original_title,
        original_description: existing.original_description || candidate.original_description,
      };
      candidate.content_hash = await createContentHash(candidate);
    }

    if (!existing) {
      await repository.insert(candidate);
      if (repository.upsertObservation) {
        await repository.upsertObservation(candidate.id, job, true);
      }
      metrics.inserted += 1;
    } else if (existing.content_hash === candidate.content_hash) {
      await repository.touch(existing.id, candidate);
      if (repository.upsertObservation) {
        await repository.upsertObservation(existing.id, job, !crossSourceDuplicate || promoteIncoming);
      }
      metrics.unchanged += 1;
    } else {
      if (promoteIncoming && repository.promotePrimary) {
        await repository.demotePrimary(existing.id);
        await repository.promotePrimary(existing.id, candidate);
        await repository.upsertObservation(existing.id, job, true);
      } else {
        await repository.update(existing.id, candidate);
        if (repository.upsertObservation) {
          await repository.upsertObservation(existing.id, job, !crossSourceDuplicate);
        }
      }
      metrics.updated += 1;
    }
    if (crossSourceDuplicate) metrics.duplicatesMerged += 1;
  }
  return metrics;
}
