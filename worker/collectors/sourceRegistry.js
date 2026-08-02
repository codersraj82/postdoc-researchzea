import { imechanicaSource } from "./sources/imechanica.js";

const APPROVED_SOURCES = Object.freeze([imechanicaSource]);

export function getEnabledSources() {
  return APPROVED_SOURCES.filter((source) => source.enabled);
}

export { APPROVED_SOURCES };
