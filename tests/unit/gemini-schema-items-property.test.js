import { describe, expect, it } from "vitest";

import { cleanJSONSchemaForAntigravity } from "../../open-sse/translator/formats/gemini.js";

// When a tool parameter is named "items", the properties map must not be treated
// as a schema node. Otherwise ensureArrayItems would set properties.type = "array",
// which Google Cloud AI Platform / Gemini rejects with INVALID_ARGUMENT (HTTP 400).
describe("cleanJSONSchemaForAntigravity handles properties named items and prefixItems", () => {
  it("does not inject type: array into properties container when a property is named items", () => {
    const schema = {
      type: "object",
      properties: {
        i: { type: "string" },
        items: {
          type: "array",
          items: { type: "string" },
        },
        list: {
          type: "array",
          items: {
            type: "object",
            properties: {
              items: {
                type: "array",
                items: { type: "string" },
              },
              phase: { type: "string" },
            },
            required: ["phase", "items"],
          },
        },
      },
      required: ["op", "i"],
    };

    const result = cleanJSONSchemaForAntigravity(structuredClone(schema));

    expect(result.properties.type).toBeUndefined();
    expect(result.properties.items.type).toBe("array");
    expect(result.properties.items.items.type).toBe("string");
    expect(result.properties.list.items.properties.type).toBeUndefined();
    expect(result.properties.list.items.properties.items.type).toBe("array");
  });

  it("converts prefixItems tuple validation to items", () => {
    const schema = {
      type: "object",
      properties: {
        tuple: {
          type: "array",
          prefixItems: [{ type: "string" }],
        },
      },
    };

    const result = cleanJSONSchemaForAntigravity(structuredClone(schema));

    expect(result.properties.tuple.items.type).toBe("string");
    expect(result.properties.tuple.prefixItems).toBeUndefined();
  });
});
