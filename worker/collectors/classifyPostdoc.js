import { htmlToPlainText } from "./text.js";

const POSTDOC_PATTERN = /\b(postdoc|post-doc|postdoctoral|post-doctoral|post doctoral)\b/gi;
const NEGATED_PATTERN = /\b(?:no|not|without)\s+(?:a\s+)?(?:postdoc|post-doc|postdoctoral|post-doctoral|post doctoral)\b/gi;
const EXCLUDED_TITLE_PATTERN = /\b(ph\.?d\.?|doctoral student|graduate assistant|professor|professorship|faculty|lecturer|lectureship|internship|master'?s|undergraduate|technician)\b/i;
const INFORMATIONAL_TITLE_PATTERN = /\b(rss feeds?|subscribe|subscription|job channel guide|how to post|posting guidelines)\b/i;

export function classifyPostdoc(entry) {
  const title = String(entry?.title ?? "");
  const description = htmlToPlainText(entry?.descriptionHtml, 5000);
  const titleTerms = title.match(POSTDOC_PATTERN) ?? [];
  const descriptionTerms = description.match(POSTDOC_PATTERN) ?? [];
  const matchedTerms = [...new Set([...titleTerms, ...descriptionTerms].map((term) => term.toLowerCase()))];

  if (matchedTerms.length === 0) {
    return { accepted: false, reason: "No explicit postdoctoral indicator.", matchedTerms };
  }

  if (INFORMATIONAL_TITLE_PATTERN.test(title)) {
    return { accepted: false, reason: "Item is informational rather than a vacancy.", matchedTerms };
  }

  const withoutNegatedTerms = `${title} ${description}`.replace(NEGATED_PATTERN, " ");
  if (!(withoutNegatedTerms.match(POSTDOC_PATTERN) ?? []).length) {
    return { accepted: false, reason: "Postdoctoral wording is explicitly negated.", matchedTerms };
  }

  if (EXCLUDED_TITLE_PATTERN.test(title) && titleTerms.length === 0) {
    return { accepted: false, reason: "Title describes a non-postdoctoral role.", matchedTerms };
  }

  return { accepted: true, reason: "Explicit postdoctoral opportunity found.", matchedTerms };
}
