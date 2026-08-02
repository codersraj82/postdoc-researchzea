const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TOP_LEVEL_KEYS = ["attemptContext", "messageId", "runId", "scheduledAt", "sourceKey", "version"];

function exactKeys(value, expected) {
  return value && typeof value === "object"
    && !Array.isArray(value)
    && Object.keys(value).sort().join("|") === [...expected].sort().join("|");
}

function validTimestamp(value) {
  if (typeof value !== "string" || value.length > 40 || !value.endsWith("Z")) return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}

export function createSourceQueueMessage({
  runId,
  sourceKey,
  scheduledAt,
  uuid = () => crypto.randomUUID(),
}) {
  return {
    version: 1,
    messageId: uuid(),
    runId,
    sourceKey,
    scheduledAt: scheduledAt.toISOString(),
    attemptContext: { reason: "scheduled" },
  };
}

export function validateSourceQueueMessage(body, getSource) {
  const errors = [];
  if (!exactKeys(body, TOP_LEVEL_KEYS)) errors.push("message shape is invalid");
  if (body?.version !== 1) errors.push("message version is unsupported");
  if (!UUID.test(String(body?.messageId ?? ""))) errors.push("messageId is invalid");
  if (!UUID.test(String(body?.runId ?? ""))) errors.push("runId is invalid");
  if (!/^[a-z0-9][a-z0-9-]{2,79}$/.test(String(body?.sourceKey ?? ""))) {
    errors.push("sourceKey is invalid");
  }
  if (!validTimestamp(body?.scheduledAt)) errors.push("scheduledAt is invalid");
  if (!exactKeys(body?.attemptContext, ["reason"]) || body?.attemptContext?.reason !== "scheduled") {
    errors.push("attemptContext is invalid");
  }
  const source = errors.length ? null : getSource(body.sourceKey);
  if (!source) errors.push("sourceKey is not approved");
  else if (!source.enabled) errors.push("source is disabled");
  return { valid: errors.length === 0, errors, source };
}

export function looksLikeUuid(value) {
  return UUID.test(String(value ?? ""));
}
