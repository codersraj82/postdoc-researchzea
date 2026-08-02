import { htmlToPlainText } from "./text.js";

const textStates = new WeakMap();

export function appendTextChunk(target, key, chunk) {
  let states = textStates.get(target);
  if (!states) {
    states = new Map();
    textStates.set(target, states);
  }
  const state = states.get(key) ?? { pendingBoundary: false };
  let value = String(chunk.text ?? "");
  const current = target[key] ?? "";
  if (
    state.pendingBoundary
    && current
    && value
    && !/\s$/.test(current)
    && !/^\s/.test(value)
    && /[\p{L}\p{N},.;:!?)]$/u.test(current)
    && /^[\p{L}\p{N}]/u.test(value)
  ) {
    value = ` ${value}`;
  }
  target[key] = `${current}${value}`;
  state.pendingBoundary = Boolean(chunk.lastInTextNode);
  states.set(key, state);
}

function textHandler(target, key) {
  return {
    text(chunk) {
      appendTextChunk(target, key, chunk);
    },
  };
}

function anchorHandler(target) {
  let current = null;
  return {
    element(element) {
      current = {
        href: element.getAttribute("href") ?? "",
        text: "",
        parentText: "",
        nearbyText: "",
        headingText: "",
        isMainContent: true,
        isExcludedRegion: false,
      };
      target.push(current);
    },
    text(chunk) {
      if (current) appendTextChunk(current, "text", chunk);
    },
  };
}

function attributeHandler(target, name, attribute) {
  return {
    element(element) {
      const value = element.getAttribute(attribute);
      if (value) target.push(value);
    },
  };
}

export async function collectListingSignals(html) {
  if (typeof HTMLRewriter === "undefined") return null;
  const result = {
    title: "",
    mainHeading: "",
    entryLinks: [],
    excerpts: [],
    submittedDates: [],
    paginationLinks: [],
  };
  let rewriter = new HTMLRewriter()
    .on("title", textHandler(result, "title"))
    .on("main h1", textHandler(result, "mainHeading"))
    .on("article h2 a", anchorHandler(result.entryLinks))
    .on("article h3 a", anchorHandler(result.entryLinks))
    .on("nav.pager a", anchorHandler(result.paginationLinks))
    .on(".pager a", anchorHandler(result.paginationLinks))
    .on("article time", attributeHandler(result.submittedDates, "time", "datetime"));
  rewriter = rewriter.on("article .field--name-body", {
    text(chunk) {
      const index = Math.max(result.entryLinks.length - 1, 0);
      appendTextChunk(result.excerpts, index, chunk);
    },
  });
  await rewriter
    .transform(new Response(html, { headers: { "content-type": "text/html" } }))
    .arrayBuffer();
  return result;
}

export async function collectDetailSignals(html) {
  if (typeof HTMLRewriter === "undefined") return null;
  const result = {
    title: "",
    body: "",
    metaDescriptions: [],
    publishedDates: [],
    anchors: [],
  };
  const rewriter = new HTMLRewriter()
    .on("main h1", textHandler(result, "title"))
    .on("main article .field--name-body", textHandler(result, "body"))
    .on("main article time", attributeHandler(result.publishedDates, "time", "datetime"))
    .on("main article a", anchorHandler(result.anchors))
    .on("meta[name='description']", attributeHandler(result.metaDescriptions, "meta", "content"));
  await rewriter
    .transform(new Response(html, { headers: { "content-type": "text/html" } }))
    .arrayBuffer();
  result.title = htmlToPlainText(result.title, 300);
  result.body = htmlToPlainText(result.body, 20_000);
  return result;
}

export async function collectJsonLdScripts(html) {
  if (typeof HTMLRewriter === "undefined") return null;
  const scripts = [];
  let current = null;
  const rewriter = new HTMLRewriter().on("script[type='application/ld+json']", {
    element() {
      current = "";
      scripts.push(current);
    },
    text(chunk) {
      if (current === null) return;
      const index = scripts.length - 1;
      scripts[index] = `${scripts[index]}${chunk.text}`;
      current = scripts[index];
    },
  });
  await rewriter
    .transform(new Response(html, { headers: { "content-type": "text/html" } }))
    .arrayBuffer();
  return scripts;
}
