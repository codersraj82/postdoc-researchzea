import { canonicalizeApprovedUrl } from "./urlSafety.js";

export async function runApprovedBrowserAction(source, url, quickAction) {
  const browserMode = source?.modes?.browser;
  if (!browserMode?.enabled || typeof quickAction !== "function") {
    throw new Error("No approved Browser Run mode is enabled for this source.");
  }
  const approvedUrl = canonicalizeApprovedUrl(url, undefined, browserMode.allowedHosts ?? []);
  if (!approvedUrl) throw new Error("Browser source URL is not approved.");
  return quickAction({ url: approvedUrl, action: "extract" });
}
