import { fetchStaticPage } from "./fetchStaticPage.js";
import { contentSignalAllowsSearch, getHtmlPolicy } from "./sourcePolicy.js";
import { SourcePolicyError } from "./urlSafety.js";

function cleanLine(line) {
  return line.replace(/\s+#.*$/, "").trim();
}

export function parseRobotsTxt(text, userAgent = "ResearchZealBot") {
  const groups = [];
  let group = null;
  for (const rawLine of String(text ?? "").replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const line = cleanLine(rawLine);
    if (!line || !line.includes(":")) continue;
    const separator = line.indexOf(":");
    const directive = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();

    if (directive === "user-agent") {
      if (!group || group.hasDirectives) {
        group = { agents: [], rules: [], crawlDelay: null, hasDirectives: false };
        groups.push(group);
      }
      group.agents.push(value.toLowerCase());
    } else if (group && (directive === "allow" || directive === "disallow")) {
      group.hasDirectives = true;
      if (value || directive === "allow") group.rules.push({ type: directive, path: value });
    } else if (group && directive === "crawl-delay") {
      group.hasDirectives = true;
      const seconds = Number(value);
      if (Number.isFinite(seconds) && seconds >= 0) group.crawlDelay = seconds;
    }
  }

  const agent = userAgent.toLowerCase();
  const specific = groups.filter((entry) => entry.agents.includes(agent));
  const selected = specific.length
    ? specific
    : groups.filter((entry) => entry.agents.includes("*"));
  if (!selected.length) {
    return { userAgent: agent, evaluatedGroup: "none", rules: [], crawlDelaySeconds: null };
  }
  return {
    userAgent: agent,
    evaluatedGroup: specific.length ? agent : "*",
    rules: selected.flatMap((entry) => entry.rules),
    crawlDelaySeconds: selected
      .map((entry) => entry.crawlDelay)
      .find((value) => value !== null) ?? null,
  };
}

function rulePattern(path) {
  const anchored = path.endsWith("$");
  const value = anchored ? path.slice(0, -1) : path;
  const escaped = value.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}${anchored ? "$" : ""}`);
}

export function isRobotsAllowed(robots, url) {
  const parsed = new URL(url);
  const target = `${parsed.pathname}${parsed.search}`;
  const matches = robots.rules
    .filter((rule) => rule.path && rulePattern(rule.path).test(target))
    .map((rule) => ({ ...rule, specificity: rule.path.replace(/[*$]/g, "").length }))
    .sort((left, right) => right.specificity - left.specificity || (left.type === "allow" ? -1 : 1));
  return matches.length === 0 || matches[0].type === "allow";
}

export async function loadRobotsPolicy(source, options = {}) {
  const policy = getHtmlPolicy(source);
  let response;
  try {
    response = await fetchStaticPage(policy.robotsUrl, policy, {
      fetchImpl: options.fetchImpl,
      kind: "robots",
      maximumBytes: 256 * 1024,
      timeoutMs: policy.timeoutMs,
    });
  } catch (error) {
    throw new SourcePolicyError(
      "Robots policy could not be evaluated safely.",
      "ROBOTS_UNAVAILABLE",
      { retryable: error?.retryable === true },
    );
  }
  if (!contentSignalAllowsSearch(response.contentSignal)) {
    throw new SourcePolicyError("Source policy prohibits search indexing.", "CONTENT_SIGNAL_SEARCH_NO");
  }
  const robots = parseRobotsTxt(response.body);
  return {
    ...robots,
    crawlDelayMs: Math.max(
      policy.minimumDelayMs,
      Math.ceil((robots.crawlDelaySeconds ?? 0) * 1000),
    ),
    robotsUrl: response.finalUrl,
  };
}

export function createRequestPacer(delayMs, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))) {
  let requestCount = 0;
  return async function pace() {
    if (requestCount > 0) await sleep(delayMs);
    requestCount += 1;
  };
}
