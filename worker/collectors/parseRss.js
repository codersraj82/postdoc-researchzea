import { XMLParser, XMLValidator } from "fast-xml-parser";

const UNSAFE_DECLARATION = /<!\s*(?:DOCTYPE|ENTITY)\b/i;

function values(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function textValue(value) {
  if (value === undefined || value === null) return "";
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map(textValue).filter(Boolean).join(", ");
  if (typeof value === "object") {
    return textValue(value["#text"] ?? value["@_href"] ?? value["@_url"] ?? "");
  }
  return "";
}

function findItems(document) {
  const rssItems = document?.rss?.channel?.item;
  if (rssItems !== undefined) return values(rssItems);
  const rdfItems = document?.["rdf:RDF"]?.item ?? document?.RDF?.item;
  return values(rdfItems);
}

export function parseRss(xml) {
  const input = String(xml ?? "");
  if (!input.trim()) return [];
  if (UNSAFE_DECLARATION.test(input)) {
    throw new Error("RSS contains a prohibited document declaration.");
  }

  const validation = XMLValidator.validate(input, { allowBooleanAttributes: false });
  if (validation !== true) {
    throw new Error("RSS XML is invalid.");
  }

  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    textNodeName: "#text",
    processEntities: false,
    htmlEntities: false,
    parseTagValue: false,
    trimValues: false,
    maxNestedTags: 100,
  });
  const document = parser.parse(input);

  return findItems(document).map((item) => ({
    title: textValue(item?.title).trim(),
    descriptionHtml: textValue(
      item?.["content:encoded"] ?? item?.description ?? item?.summary,
    ),
    link: textValue(item?.link).trim(),
    guid: textValue(item?.guid ?? item?.id).trim(),
    pubDate: textValue(item?.pubDate ?? item?.published ?? item?.["dc:date"]).trim(),
    categories: values(item?.category).map(textValue).map((category) => category.trim()).filter(Boolean),
  }));
}
