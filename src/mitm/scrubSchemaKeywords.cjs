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
  "gap", "padding", "strokeColor", "strokeThickness", "textColor"
];

const BLOCKED_KEYWORDS = new Set(UNSUPPORTED_SCHEMA_KEYWORDS);
const QUOTED_KEYWORDS = UNSUPPORTED_SCHEMA_KEYWORDS.map(k => `"${k}"`);

function mentionsUnsupportedKeyword(bodyBuffer) {
  for (const needle of QUOTED_KEYWORDS) {
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
      state.removed = true;
    } else {
      stripKeywords(node[key], state);
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
      for (const declaration of declarations) stripKeywords(declaration?.parameters, state);
    }
  }
  for (const key of Object.keys(node)) scrubToolDeclarations(node[key], state);
}

/**
 * Remove JSON Schema keywords Google's Antigravity backend rejects from tool
 * declaration parameters. Returns the original buffer untouched when nothing
 * matched (clean bodies stay byte-identical), and the original buffer again when
 * the body is not JSON (binary/proto payloads).
 */
function scrubSchemaKeywords(bodyBuffer) {
  if (!Buffer.isBuffer(bodyBuffer) || bodyBuffer.length === 0) return bodyBuffer;
  if (!mentionsUnsupportedKeyword(bodyBuffer)) return bodyBuffer;

  let parsed;
  try {
    parsed = JSON.parse(bodyBuffer.toString());
  } catch {
    return bodyBuffer;
  }

  const state = { removed: false };
  scrubToolDeclarations(parsed, state);
  if (!state.removed) return bodyBuffer;
  return Buffer.from(JSON.stringify(parsed));
}

module.exports = {
  UNSUPPORTED_SCHEMA_KEYWORDS,
  scrubSchemaKeywords,
};
