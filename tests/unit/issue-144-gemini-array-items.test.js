// Issue #144: antigravity/gemini 400 —
//   GenerateContentRequest.tools[0].function_declarations[3].parameters
//     .properties[query].properties[where].items.items: missing field
// Google requires `items` on every array-typed schema node. cleanJSONSchemaForAntigravity
// inferred a missing type=object (ensureObjectType) but had no equivalent for arrays,
// so a nested array survived to the wire and was rejected.
import { describe, it, expect } from "vitest";
import { cleanJSONSchemaForAntigravity } from "open-sse/translator/formats/gemini.js";

describe("issue #144 — Gemini requires items on every array schema", () => {
  it("fills in items for the exact shape the issue reported", () => {
    const schema = {
      type: "object",
      properties: {
        query: {
          type: "object",
          properties: {
            where: { type: "array", items: { type: "array" } },
          },
        },
      },
    };

    const cleaned = cleanJSONSchemaForAntigravity(structuredClone(schema));

    const where = cleaned.properties.query.properties.where;
    // Google's complaint was literally the path `...items.items`, so that is
    // what has to exist now. The inner node stays an array — the client meant
    // a nested array, and widening it to string would change the tool contract.
    expect(where.type).toBe("array");
    expect(where.items.type).toBe("array");
    expect(where.items.items).toEqual({ type: "string" });
  });

  it("fills in items for a bare array with no items at all", () => {
    const cleaned = cleanJSONSchemaForAntigravity({
      type: "object",
      properties: { tags: { type: "array" } },
    });

    expect(cleaned.properties.tags.items).toEqual({ type: "string" });
  });

  it("reaches arrays nested deeper than one level", () => {
    const cleaned = cleanJSONSchemaForAntigravity({
      type: "object",
      properties: {
        outer: {
          type: "object",
          properties: { list: { type: "array", items: { type: "array" } } },
        },
      },
    });

    expect(cleaned.properties.outer.properties.list.items.items).toEqual({ type: "string" });
  });

  it("leaves a well-formed array alone", () => {
    const cleaned = cleanJSONSchemaForAntigravity({
      type: "object",
      properties: { ids: { type: "array", items: { type: "number" } } },
    });

    expect(cleaned.properties.ids.items).toEqual({ type: "number" });
  });

  it("keeps ensureObjectType working — the two passes must not fight", () => {
    const cleaned = cleanJSONSchemaForAntigravity({
      properties: { obj: { properties: { inner: { type: "string" } } } },
    });

    expect(cleaned.properties.obj.type).toBe("object");
  });
});
