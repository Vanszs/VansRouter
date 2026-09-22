/**
 * OpenCode Zen free tier requires the lowercase file-search quartet on every
 * request. Agent clients declare the same tools capitalised (Claude Code's
 * Bash/Glob/Grep/Read), so the request side canonicalises those spellings and the
 * response side must hand the caller its own names back — otherwise the client
 * rejects the tool call as an unknown tool.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/usageDb.js", () => ({
  appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
  saveRequestUsage: vi.fn(async () => {})
}));

const {
  OPENCODE_FINGERPRINT_TOOLS,
  applyFingerprintToolNames,
  concealFingerprintToolNames,
  fingerprintToolKey,
  restoreToolNames,
  takeRenamedToolNames,
} = await import("../../open-sse/utils/opencodeFingerprint.js");
const { OpenCodeExecutor } = await import("../../open-sse/executors/opencode.js");
const { FORMATS } = await import("../../open-sse/translator/formats.js");
const { handleForcedSSEToJson } = await import("../../open-sse/handlers/chatCore/sseToJsonHandler.js");

const CREDS = { connectionId: "opencode-fingerprint-test" };
const CC_TOOLS = ["Task", "Bash", "Glob", "Grep", "Read", "Edit"];
const chatTools = (names) => names.map((name) => ({ type: "function", function: { name } }));
const decoy = (name) => ({ type: "function", name });

describe("opencodeFingerprint — request side", () => {
  it("canonicalises capitalised quartet members and keeps the original spelling", () => {
    const { tools, map } = concealFingerprintToolNames(chatTools(["Bash", "Read", "Edit"]));

    expect(tools.map((tool) => tool.function.name)).toEqual(["bash", "read", "Edit"]);
    expect(map.get("bash")).toBe("Bash");
    expect(map.get("read")).toBe("Read");
    expect(map.has("Edit")).toBe(false);
  });

  it("drops duplicate quartet spellings but keeps unrelated case variants", () => {
    const { tools } = concealFingerprintToolNames(chatTools(["Bash", "bash", "Foo", "foo"]));
    const names = tools.map((tool) => tool.function.name);

    expect(names.filter((name) => name === "bash")).toHaveLength(1);
    expect(names).toContain("Foo");
    expect(names).toContain("foo");
  });

  it("appends only the members the caller does not declare", () => {
    const body = { tools: [{ type: "function", name: "Bash" }, { type: "function", name: "terminal" }] };
    applyFingerprintToolNames(body, decoy);

    expect(body.tools.map((tool) => tool.name)).toEqual(["bash", "terminal", "glob", "grep", "read"]);
  });

  it("points a forced tool_choice at the canonical name", () => {
    const body = { tools: chatTools(["Bash"]), tool_choice: { type: "function", function: { name: "Bash" } } };
    applyFingerprintToolNames(body, decoy);

    expect(body.tool_choice.function.name).toBe("bash");
  });

  it("records the rename map against the body for the response side", () => {
    const body = { tools: chatTools(CC_TOOLS) };
    const map = applyFingerprintToolNames(body, decoy);

    expect(takeRenamedToolNames(body)).toBe(map);
    expect(map.get("glob")).toBe("Glob");
  });

  it("never throws on malformed tools", () => {
    for (const tools of [null, undefined, "nope", [null, 42, []], [{}, { name: "" }]]) {
      expect(() => concealFingerprintToolNames(tools)).not.toThrow();
      expect(() => applyFingerprintToolNames({ tools }, decoy)).not.toThrow();
    }
  });
});

describe("opencodeFingerprint — response side", () => {
  const map = new Map([["bash", "Bash"], ["grep", "Grep"], ["read", "Read"]]);

  it("restores Claude content_block_start chunks", () => {
    const chunk = { type: "content_block_start", content_block: { type: "tool_use", name: "bash", id: "t1" } };
    const out = restoreToolNames(chunk, map);

    expect(out.content_block.name).toBe("Bash");
    expect(chunk.content_block.name).toBe("bash");
  });

  it("restores names inside arrays of chunks", () => {
    const chunks = [{ choices: [{ delta: { tool_calls: [{ function: { name: "grep" } }] } }] }];

    expect(restoreToolNames(chunks, map)[0].choices[0].delta.tool_calls[0].function.name).toBe("Grep");
  });

  it("restores Claude non-streaming bodies and Responses items", () => {
    expect(restoreToolNames({ content: [{ type: "tool_use", name: "bash" }] }, map).content[0].name).toBe("Bash");
    expect(restoreToolNames({ output: [{ type: "function_call", name: "read" }] }, map).output[0].name).toBe("Read");
    expect(restoreToolNames({ item: { type: "function_call", name: "read" } }, map).item.name).toBe("Read");
  });

  it("is a no-op without a map and leaves unrenamed names untouched", () => {
    const body = { choices: [{ message: { tool_calls: [{ function: { name: "bash" } }] } }] };

    expect(restoreToolNames(body, null)).toBe(body);
    expect(restoreToolNames(body, new Map())).toBe(body);
    expect(restoreToolNames({ output: [{ type: "function_call", name: "Edit" }] }, map).output[0].name).toBe("Edit");
  });

  it("maps only quartet case/whitespace variants", () => {
    expect(fingerprintToolKey("Bash")).toBe("bash");
    expect(fingerprintToolKey(" GLOB ")).toBe("glob");
    expect(fingerprintToolKey("Edit")).toBe("");
    expect(fingerprintToolKey(null)).toBe("");
  });
});

describe("opencode free-tier fingerprint round trip", () => {
  it("sends the lowercase quartet but returns the caller's own spelling", () => {
    const body = { messages: [{ role: "user", content: "hi" }], tools: chatTools(CC_TOOLS) };
    const out = new OpenCodeExecutor().transformRequest("big-pickle", body, true, CREDS);
    const map = takeRenamedToolNames(body);

    expect(out.tools.map((tool) => tool.function.name)).toEqual(["Task", "bash", "glob", "grep", "read", "Edit"]);
    expect([...map]).toEqual([["bash", "Bash"], ["glob", "Glob"], ["grep", "Grep"], ["read", "Read"]]);
    expect(OPENCODE_FINGERPRINT_TOOLS).toEqual(["bash", "glob", "grep", "read"]);
  });

  it("non-streaming Responses client gets function_call items under the original names", async () => {
    const body = { messages: [{ role: "user", content: "hi" }], tools: chatTools(CC_TOOLS) };
    const transformed = new OpenCodeExecutor().transformRequest("muse-spark-1.2-contributor-free", body, true, CREDS);
    const toolNameMap = takeRenamedToolNames(body);

    const sse = [
      'event: response.output_item.done\ndata: {"output_index":0,"item":{"type":"function_call","name":"bash","call_id":"c1","arguments":"{}"}}',
      'event: response.completed\ndata: {"response":{"id":"resp_1","status":"completed","output":[],"usage":{"input_tokens":5,"output_tokens":2}}}',
      ""
    ].join("\n\n");
    const result = await handleForcedSSEToJson({
      providerResponse: new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(sse));
          controller.close();
        }
      }), { headers: { "content-type": "text/event-stream" } }),
      sourceFormat: FORMATS.OPENAI_RESPONSES,
      provider: "opencode",
      model: "muse-spark-1.2-contributor-free",
      body,
      stream: false,
      translatedBody: transformed,
      requestStartTime: Date.now(),
      connectionId: "test-connection",
      clientRawRequest: { endpoint: "/v1/responses" },
      toolNameMap,
      trackDone: vi.fn(),
      appendLog: vi.fn()
    });

    const json = await result.response.json();
    expect(json.output[0].name).toBe("Bash");
    expect(json.output[0].arguments).toBe("{}");
  });
});
