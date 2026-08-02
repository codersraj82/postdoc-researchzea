import {
  berkeleyLabAdapter,
  berkeleyLabSource,
} from "./sources/berkeleyLab.js";
import { emblAdapter, emblSource } from "./sources/embl.js";
import { imechanicaAdapter, imechanicaSource } from "./sources/imechanica.js";
import { ornlAdapter, ornlSource } from "./sources/ornl.js";

const REGISTRY_ENTRIES = Object.freeze([
  Object.freeze({ source: imechanicaSource, adapter: imechanicaAdapter }),
  Object.freeze({ source: ornlSource, adapter: ornlAdapter }),
  Object.freeze({ source: berkeleyLabSource, adapter: berkeleyLabAdapter }),
  Object.freeze({ source: emblSource, adapter: emblAdapter }),
]);

const ENTRY_BY_KEY = Object.freeze(
  Object.fromEntries(REGISTRY_ENTRIES.map((entry) => [entry.source.key, entry])),
);

const APPROVED_SOURCES = Object.freeze(REGISTRY_ENTRIES.map((entry) => entry.source));

export function getEnabledSources() {
  return APPROVED_SOURCES.filter((source) => source.enabled);
}

export function getSourceDefinition(sourceKey) {
  return ENTRY_BY_KEY[sourceKey]?.source ?? null;
}

export function getSourceAdapter(sourceKey) {
  return ENTRY_BY_KEY[sourceKey]?.adapter ?? null;
}

export function getSourcePriority(sourceKey) {
  return getSourceDefinition(sourceKey)?.priority ?? Number.MAX_SAFE_INTEGER;
}

export { APPROVED_SOURCES };
