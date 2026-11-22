"use strict";

// JSON Schema keywords the Antigravity/Gemini backend rejects with
// 400 Unknown name "optional" at request.tools[0].function_declarations[...].parameters.
// Duplicated from UNSUPPORTED_SCHEMA_CONSTRAINTS in open-sse/translator/formats/gemini.js
// because this MITM bundle is CommonJS and cannot import open-sse ESM sources.
// Upgrade path: emit one shared JSON list at build time and read it from both sides.
const UNSUPPORTED_SCHEMA_KEYWORDS = [
  // Basic constraints (not supported by Gemini API)
  "minLength", "maxLength", "exclusiveMinimum", "exclusiveMaximum",
  "minItems", "maxItems", "format", "multipleOf",
  // Array keywords the Gemini schema proto has no field for
  "uniqueItems", "contains",
  // Tuple-array keywords; converted to items in the provider path
  "prefixItems", "additionalItems",
  // 2020-12 keywords with no Gemini equivalent
  "unevaluatedProperties", "unevaluatedItems", "contentSchema",
  // Claude rejects these in VALIDATED mode
  "default", "examples",
  // JSON Schema meta keywords
  "$schema", "$defs", "definitions", "const", "$ref", "$comment",
  // Annotation keywords (rejected by Gemini/Antigravity - e.g. MCP tool schemas set these)
  "deprecated", "readOnly", "writeOnly",
  // Object validation keywords (not supported)
  "additionalProperties", "propertyNames", "patternProperties", "enumDescriptions",
  // Complex schema keywords
  "anyOf", "oneOf", "allOf", "not",
  // Dependency keywords (not supported)
  "dependencies", "dependentSchemas", "dependentRequired",
  // Other unsupported keywords
  "title", "optional", "if", "then", "else", "contentMediaType", "contentEncoding",
  // UI/Styling properties (from Cursor tools - NOT JSON Schema standard)
  "cornerRadius", "fillColor", "fontFamily", "fontSize", "fontWeight",
  "gap", "padding", "strokeColor", "strokeThickness", "textColor",
  // Non-standard annotation/error keywords used by some MCP tool schemas (#4283).
  // Gemini's schema proto has no field for these and rejects the whole request with
  // "Unknown name X: Cannot find field" if any nested schema node carries them.
  "errorMessage", "errorMessages", "x-errorMessage", "x-errorMessages",
  "markdownDescription", "x-intellij-html-description",
  "x-taplo-info", "x-taplo", "doNotSuggest", "suggestSortText",
  "minProperties", "maxProperties"
];

const BLOCKED_KEYWORDS = new Set(UNSUPPORTED_SCHEMA_KEYWORDS);
const QUOTED_KEYWORDS = UNSUPPORTED_SCHEMA_KEYWORDS.map(k => `"${k}"`);

// `items` is not an unsupported keyword, but it is the field whose protobuf
// predicate rejects a node that is not an array (issue #163). Include it in the
// cheap pre-parse scan so such a body is parsed and repaired; a body that only
// mentions it in prose parses once and is still returned byte-identical.
const QUOTED_DETECTION_KEYWORDS = [...QUOTED_KEYWORDS, '"items"'];

function needsSchemaScrub(bodyBuffer) {
  for (const needle of QUOTED_DETECTION_KEYWORDS) {
    if (bodyBuffer.includes(needle, 0, "latin1")) return true;
  }
  return false;
}

function stripKeywords(node, state) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const item of node) stripKeywords(item, state);
    return;
  }
  for (const key of Object.keys(node)) {
    if (BLOCKED_KEYWORDS.has(key)) {
      delete node[key];
      state.changed = true;
    } else {
      stripKeywords(node[key], state);
    }
  }
}

// Gemini's Schema proto only allows `items` on a node whose type is ARRAY:
//   field predicate failed: $type == Type.ARRAY
// The Antigravity passthrough skips the provider translator (and its
// cleanJSONSchemaForAntigravity), so a native tool schema can reach Google with
// `items` still attached to a node that lost or never carried the type — the
// exact 400 of issue #163. Mirror the provider sanitiser: a node with `items`,
// no type and no object shape is an array that lost its type; anything else is
// an object that must not carry `items` at all.
function enforceItemsPredicate(node, state) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const item of node) enforceItemsPredicate(item, state);
    return;
  }
  // Native Antigravity bodies carry the proto enum names ("ARRAY", "OBJECT"),
  // while the provider translator emits lowercase; the API accepts either, so
  // the predicate check must be case-insensitive.
  const isArray = typeof node.type === "string" && node.type.toLowerCase() === "array";
  if (Object.hasOwn(node, "items") && !isArray) {
    if (node.type === undefined && !node.properties) {
      node.type = "array";
    } else {
      delete node.items;
    }
    state.changed = true;
  }
  for (const [key, value] of Object.entries(node)) {
    // A `properties` map is not itself a schema node. A tool parameter may be
    // named "items", and treating the map as a node would inject
    // type:"array" into it instead of fixing the parameter's own schema.
    if (key === "properties" && value && typeof value === "object" && !Array.isArray(value)) {
      for (const sub of Object.values(value)) enforceItemsPredicate(sub, state);
    } else {
      enforceItemsPredicate(value, state);
    }
  }
}

// Walk the body for `tools` arrays at any nesting depth (root, body.request, body.request.request)
// and clean every function declaration schema. Gemini proto JSON arrives in either casing.
function scrubToolDeclarations(node, state) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const item of node) scrubToolDeclarations(item, state);
    return;
  }
  if (Array.isArray(node.tools)) {
    for (const group of node.tools) {
      const declarations = group?.functionDeclarations || group?.function_declarations;
      if (!Array.isArray(declarations)) continue;
      for (const declaration of declarations) {
        const parameters = declaration?.parameters;
        stripKeywords(parameters, state);
        enforceItemsPredicate(parameters, state);
      }
    }
  }
  for (const key of Object.keys(node)) scrubToolDeclarations(node[key], state);
}

/**
 * Remove JSON Schema keywords Google's Antigravity backend rejects from tool
 * declaration parameters, and enforce the `items` predicate the proto applies
 * to them. Returns the original buffer untouched when nothing changed (clean
 * bodies stay byte-identical), and the original buffer again when the body is
 * not JSON (binary/proto payloads).
 */
function scrubSchemaKeywords(bodyBuffer) {
  if (!Buffer.isBuffer(bodyBuffer) || bodyBuffer.length === 0) return bodyBuffer;
  if (!needsSchemaScrub(bodyBuffer)) return bodyBuffer;

  let parsed;
  try {
    parsed = JSON.parse(bodyBuffer.toString());
  } catch {
    return bodyBuffer;
  }

  const state = { changed: false };
  scrubToolDeclarations(parsed, state);
  if (!state.changed) return bodyBuffer;
  return Buffer.from(JSON.stringify(parsed));
}

module.exports = {
  UNSUPPORTED_SCHEMA_KEYWORDS,
  scrubSchemaKeywords,
};
