import { describe, expect, it } from "vitest";

import { cleanJSONSchemaForAntigravity } from "../../open-sse/translator/formats/gemini.js";

// Gemini's schema validator rejects a node that carries `items` without being
// an array: "field predicate failed: $type == Type.ARRAY". A tool schema with
// an object-typed property that also carries `items` takes the whole request
// down with a 400 (issue #163).
describe("cleanJSONSchemaForAntigravity drops items from non-array nodes (#163)", () => {
  it("removes items from an object-typed property", () => {
    const schema = {
      type: "object",
      properties: {
        expectedValue: {
          type: "object",
          properties: { id: { type: "string" } },
          items: { type: "string" },
        },
      },
    };

    const result = cleanJSONSchemaForAntigravity(structuredClone(schema));

    expect(result.properties.expectedValue.items).toBeUndefined();
    // The object shape itself is untouched.
    expect(result.properties.expectedValue.type).toBe("object");
    expect(result.properties.expectedValue.properties.id.type).toBe("string");
  });

  it("removes items from a nested array element that is not an array", () => {
    const schema = {
      type: "object",
      properties: {
        operations: {
          type: "array",
          items: {
            type: "object",
            properties: {
              expectedValue: { type: "object", properties: {}, items: { type: "string" } },
            },
          },
        },
      },
    };

    const result = cleanJSONSchemaForAntigravity(structuredClone(schema));

    expect(result.properties.operations.items.properties.expectedValue.items).toBeUndefined();
    // The array and its element stay arrays/objects.
    expect(result.properties.operations.type).toBe("array");
    expect(result.properties.operations.items.type).toBe("object");
  });

  it("keeps items on a real array and still fills a missing one", () => {
    const schema = {
      type: "object",
      properties: {
        tags: { type: "array", items: { type: "string" } },
        names: { type: "array" },
      },
    };

    const result = cleanJSONSchemaForAntigravity(structuredClone(schema));

    expect(result.properties.tags.items).toEqual({ type: "string" });
    expect(result.properties.names.items).toEqual({ type: "string" });
  });

  it("types a node that carries items but no type as an array", () => {
    const schema = {
      type: "object",
      properties: {
        values: { items: { type: "number" } },
      },
    };

    const result = cleanJSONSchemaForAntigravity(structuredClone(schema));

    expect(result.properties.values.type).toBe("array");
    expect(result.properties.values.items).toEqual({ type: "number" });
  });
});
