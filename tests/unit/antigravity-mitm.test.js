import { describe, expect, it } from "vitest";
import { createRequire } from "module";
import { MITM_TOOLS } from "../../src/shared/constants/cliTools.js";

// config.js is the CJS MITM bundle module (dependency-isolated for the runtime copy).
const require = createRequire(import.meta.url);
const { MODEL_NO_MAP } = require("../../src/mitm/config.js");

// All assertions below are grounded in a live MITM dump capture of Antigravity's
// streamGenerateContent requests (see AI_JOURNAL): the agent loop sends
// `gemini-3.5-flash-low`, tab-autocomplete sends `tab_jump_flash_lite_preview` /
// `tab_flash_lite_preview`.
describe("Antigravity MITM model handling", () => {
  const ag = MITM_TOOLS.antigravity;

  it("flags the out-of-box agent/Default model mandatory", () => {
    expect(ag.defaultModels.find((m) => m.id === "gemini-3.8-flash-medium")?.mandatory).toBe(true);
  });

  it("leaves models not proven auto-sent optional", () => {
    for (const id of ["gemini-3.1-pro-low", "claude-sonnet-4-6", "gpt-oss-120b-medium"]) {
      expect(ag.defaultModels.find((m) => m.id === id)?.mandatory).toBeFalsy();
    }
  });

  // Tab-autocomplete is latency-critical inline completion — it must passthrough natively,
  // never get re-routed onto a chat-model mapping by the broad `flash` pattern.
  it.each(["tab_jump_flash_lite_preview", "tab_flash_lite_preview"])(
    "excludes tab-autocomplete model '%s' from re-routing",
    (id) => {
      expect((MODEL_NO_MAP.antigravity || []).some((re) => re.test(id))).toBe(true);
    }
  );

  it("does not exclude real agent models from re-routing", () => {
    for (const id of ["gemini-3.8-flash-medium", "gemini-3.8-flash-high", "claude-sonnet-4-6"]) {
      expect((MODEL_NO_MAP.antigravity || []).some((re) => re.test(id))).toBe(false);
    }
  });
});

// Passthrough forwards raw Gemini bodies straight to Google whenever the model is not
// re-routed, so the provider-side schema cleanup never sees them (issue #134).
const { scrubSchemaKeywords, UNSUPPORTED_SCHEMA_KEYWORDS } = require("../../src/mitm/scrubSchemaKeywords.cjs");

describe("Antigravity MITM tool-schema scrubbing", () => {
  const geminiBody = (parameters, declarationKey = "functionDeclarations") =>
    Buffer.from(JSON.stringify({
      request: {
        contents: [{ role: "user", parts: [{ text: "hi" }] }],
        tools: [{ [declarationKey]: [{ name: "search", description: "search", parameters }] }],
      },
    }));

  const nestedParameters = () => ({
    type: "object",
    properties: {
      q: { type: "string", optional: true },
      opts: {
        type: "object",
        properties: { value: { type: "string", optional: true } },
      },
    },
    required: ["q"],
  });

  it("strips 'optional' nested two levels deep and returns a shorter body", () => {
    const body = geminiBody(nestedParameters());

    const scrubbed = scrubSchemaKeywords(body);

    // New buffer identity is what makes passthrough() refresh content-length.
    expect(scrubbed).not.toBe(body);
    expect(scrubbed.length).toBeLessThan(body.length);
    expect(scrubbed.includes('"optional"', 0, "latin1")).toBe(false);

    const forwarded = JSON.parse(scrubbed.toString());
    const params = forwarded.request.tools[0].functionDeclarations[0].parameters;
    expect(params.properties.q).toEqual({ type: "string" });
    expect(params.properties.opts.properties.value).toEqual({ type: "string" });
    // Only the offending keywords go — required stays intact (unlike the provider path).
    expect(params.required).toEqual(["q"]);
  });

  it("scrubs the snake_case declarations the IDE sends on the wire", () => {
    const body = geminiBody(nestedParameters(), "function_declarations");

    const forwarded = JSON.parse(scrubSchemaKeywords(body).toString());
    const params = forwarded.request.tools[0].function_declarations[0].parameters;
    expect(params.properties.q).toEqual({ type: "string" });
    expect(params.properties.opts.properties.value).toEqual({ type: "string" });
  });

  it("types a node that carries items but no type as an array (issue #163)", () => {
    // The exact shape of the reported GenerateContentRequest failure:
    // operations[].items.properties.{expectedValue,value}.items, where both
    // array parameters lost their `type` but kept `items`.
    // Native Antigravity bodies carry the proto enum names ("ARRAY", "OBJECT").
    const body = geminiBody({
      type: "OBJECT",
      properties: {
        operations: {
          type: "ARRAY",
          items: {
            type: "OBJECT",
            properties: {
              expectedValue: { items: { type: "STRING" } },
              value: { items: { type: "NUMBER" } },
            },
          },
        },
      },
    }, "function_declarations");

    const forwarded = JSON.parse(scrubSchemaKeywords(body).toString());
    const params = forwarded.request.tools[0].function_declarations[0].parameters;
    expect(params.properties.operations.items.properties.expectedValue).toEqual({
      type: "array",
      items: { type: "STRING" },
    });
    expect(params.properties.operations.items.properties.value).toEqual({
      type: "array",
      items: { type: "NUMBER" },
    });
  });

  it("keeps items on a valid array sent with the proto enum casing", () => {
    const body = geminiBody({
      type: "OBJECT",
      properties: { tags: { type: "ARRAY", items: { type: "STRING" } } },
    });

    expect(scrubSchemaKeywords(body)).toBe(body);
  });

  it("drops items from a node that is not an array", () => {
    const body = geminiBody({
      type: "object",
      properties: {
        expectedValue: {
          type: "object",
          properties: { id: { type: "string" } },
          items: { type: "string" },
        },
      },
    });

    const params = JSON.parse(scrubSchemaKeywords(body).toString()).request.tools[0].functionDeclarations[0].parameters;
    expect(params.properties.expectedValue).toEqual({
      type: "object",
      properties: { id: { type: "string" } },
    });
  });

  it("does not treat a properties map as a schema node when a parameter is named items", () => {
    const body = geminiBody({
      type: "object",
      properties: {
        items: { type: "array", items: { type: "string" } },
        list: {
          type: "array",
          items: {
            type: "object",
            properties: { items: { type: "array", items: { type: "number" } } },
          },
        },
      },
    });

    const params = JSON.parse(scrubSchemaKeywords(body).toString()).request.tools[0].functionDeclarations[0].parameters;
    expect(params.properties.type).toBeUndefined();
    expect(params.properties.items).toEqual({ type: "array", items: { type: "string" } });
    expect(params.properties.list.items.properties.type).toBeUndefined();
    expect(params.properties.list.items.properties.items).toEqual({ type: "array", items: { type: "number" } });
  });

  it("forwards a valid array schema byte-identical", () => {
    const body = geminiBody({
      type: "object",
      properties: { tags: { type: "array", items: { type: "string" } } },
    });

    expect(scrubSchemaKeywords(body)).toBe(body);
  });

  it("leaves a body where items only appears in prose untouched", () => {
    const body = geminiBody({
      type: "object",
      properties: { q: { type: "string", description: "items to search" } },
    });

    expect(scrubSchemaKeywords(body)).toBe(body);
  });

  it("forwards bodies with only supported keywords byte-identical", () => {
    const body = geminiBody({
      type: "object",
      properties: { q: { type: "string", description: "query" } },
      required: ["q"],
    });

    const forwarded = scrubSchemaKeywords(body);
    expect(forwarded).toBe(body);
    expect(Buffer.compare(forwarded, body)).toBe(0);
  });

  it("leaves a keyword that only appears inside a description untouched", () => {
    const body = geminiBody({ type: "object", properties: { q: { type: "string", description: "optional filter" } } });

    expect(scrubSchemaKeywords(body)).toBe(body);
  });

  // The host gate itself is `tool === "antigravity"` in server.js passthrough; bodies from the
  // other intercepted tools carry no Gemini function declarations, so nothing here can rewrite them.
  it("leaves non-antigravity tool shapes untouched", () => {
    const body = Buffer.from(JSON.stringify({
      model: "gpt-4o",
      messages: [{ role: "user", content: "hi" }],
      tools: [{ type: "function", function: { name: "search", parameters: { type: "object", properties: { q: { type: "string", optional: true } } } } }],
    }));

    expect(scrubSchemaKeywords(body)).toBe(body);
  });

  it("leaves non-JSON bodies untouched", () => {
    const binary = Buffer.concat([Buffer.from([0x00, 0x01, 0x02, 0xff]), Buffer.from('"optional"', "latin1")]);

    expect(scrubSchemaKeywords(binary)).toBe(binary);
  });

  it("keeps the keyword list in lockstep with the provider path", async () => {
    const { UNSUPPORTED_SCHEMA_CONSTRAINTS } = await import("../../open-sse/translator/formats/gemini.js");

    expect([...UNSUPPORTED_SCHEMA_KEYWORDS].sort()).toEqual([...new Set(UNSUPPORTED_SCHEMA_CONSTRAINTS)].sort());
  });
});
