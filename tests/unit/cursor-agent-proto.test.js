import { describe, expect, it } from "vitest";
import {
  decodeMessage,
  encodeField,
  wrapConnectRPCFrame,
  encodeAgentValue,
  decodeAgentValue,
  encodeMcpToolDefinition,
  encodeMcpTools,
  decodeMcpArgs,
  encodeMcpResultSuccess,
  encodeMcpResultError,
  encodeMcpResultToolNotFound,
} from "../../open-sse/utils/cursorProtobuf.js";
import {
  CursorExecutor,
  isAgentCapableRequest,
  buildAgentRunFrame,
  resolveCursorUpstreamModel,
  tailOnlyCursorMessages,
  decodeAgentFrames,
} from "../../open-sse/executors/cursor.js";

// AgentService (agent.v1) codec tests — validate the production implementation
// in cursorProtobuf.js + the executor's frame builders. Pure round-trip, no network.
// Field numbers verified against Cursor's agent.proto (extracted via @oh-my-pi).

const LEN = 2;
const VALUE = { NULL: 1, NUMBER: 2, STRING: 3, BOOL: 4, STRUCT: 5, LIST: 6 };
// McpArgs.args map entry { field1: key, field2: Value }
const entry = (k, v) => Buffer.concat([
  Buffer.from(encodeField(2, LEN,
    Buffer.concat([Buffer.from(encodeField(1, LEN, k)), Buffer.from(encodeField(2, LEN, encodeAgentValue(v)))])
  )),
]);

describe("Cursor AgentService codec (cursorProtobuf.js)", () => {
  for (const [model, effort, key, value] of [
    ["gpt-5.2", "high", "reasoning", "high"],
    ["claude-4.6-opus", "minimal", "effort", "low"],
    ["composer-2.5", "ultra", "effort", "max"],
  ]) {
    it(`forwards ${effort} as a RequestedModel parameter for ${model}`, () => {
      const frame = buildAgentRunFrame([{ role: "user", content: "hi" }], model, [], effort);
      const run = decodeMessage(decodeMessage(frame.subarray(5)).get(1)[0].value);
      const requested = decodeMessage(run.get(9)[0].value);
      const parameter = decodeMessage(requested.get(3)[0].value);
      expect(Buffer.from(parameter.get(1)[0].value).toString()).toBe(key);
      expect(Buffer.from(parameter.get(2)[0].value).toString()).toBe(value);
      expect(Buffer.from(requested.get(1)[0].value).toString()).toBe(model);
      expect(run.has(3)).toBe(true);
    });
  }
  for (const effort of [null, "none", ""]) {
    it(`does not invent a RequestedModel parameter for ${String(effort)}`, () => {
      const frame = buildAgentRunFrame([{ role: "user", content: "hi" }], "gpt-5.2", [], effort);
      const run = decodeMessage(decodeMessage(frame.subarray(5)).get(1)[0].value);
      expect(decodeMessage(run.get(9)[0].value).has(3)).toBe(false);
    });
  }
  describe("google.protobuf.Value round-trip", () => {
    const cases = [
      ["null", null],
      ["bool true", true],
      ["bool false", false],
      ["string", "hello"],
      ["integer", 42],
      ["float", 3.14],
      ["empty object", {}],
      ["flat object", { a: 1, b: "x", c: true }],
      ["nested object", { outer: { inner: [1, 2, "three"] } }],
      ["array of mixed", [1, "two", false, null]],
      ["deeply nested", { a: { b: { c: { d: 1 } } } }],
    ];
    for (const [label, value] of cases) {
      it(`encodes/decodes ${label}`, () => {
        expect(decodeAgentValue(encodeAgentValue(value))).toEqual(value);
      });
    }

    it("returns null when no known field matches", () => {
      const unknownField = encodeField(99, VARINT, 1);
      expect(decodeAgentValue(unknownField)).toBeNull();
      expect(decodeAgentValue(new Uint8Array())).toBeNull();
    });

    it("defensively skips struct entries missing key or value", () => {
      // Entry with only key (missing field 2)
      const missingVal = encodeField(VALUE.STRUCT, LEN, encodeField(1, LEN, encodeField(1, LEN, "orphan")));
      expect(decodeAgentValue(missingVal)).toEqual({});

      // Entry with only value (missing field 1)
      const missingKey = encodeField(VALUE.STRUCT, LEN, encodeField(1, LEN, encodeField(2, LEN, encodeAgentValue("val"))));
      expect(decodeAgentValue(missingKey)).toEqual({});
    });
  });

  describe("McpToolDefinition", () => {
    it("encodes name, description, input_schema (Value), provider, tool_name", () => {
      const schema = { type: "object", properties: { city: { type: "string" } }, required: ["city"] };
      const def = encodeMcpToolDefinition({ function: { name: "get_weather", description: "Get weather", parameters: schema } });
      const msg = decodeMessage(def);
      expect(Buffer.from(msg.get(1)[0].value).toString("utf8")).toBe("get_weather");
      expect(Buffer.from(msg.get(2)[0].value).toString("utf8")).toBe("Get weather");
      expect(Buffer.from(msg.get(4)[0].value).toString("utf8")).toBe("9router");
      expect(Buffer.from(msg.get(5)[0].value).toString("utf8")).toBe("get_weather");
      expect(decodeAgentValue(msg.get(3)[0].value)).toEqual(schema);
    });

    it("preserves nested JSON-schema types", () => {
      const schema = {
        type: "object",
        properties: {
          query: { type: "string", description: "search query" },
          opts: { type: "array", items: { type: "string" } },
        },
        required: ["query"],
      };
      const def = encodeMcpToolDefinition({ function: { name: "search", parameters: schema } });
      const msg = decodeMessage(def);
      expect(decodeAgentValue(msg.get(3)[0].value)).toEqual(schema);
    });

    it("accepts flat tool shape (no .function wrapper)", () => {
      const def = encodeMcpToolDefinition({ name: "noop", description: "d", inputSchema: { type: "object" } });
      const msg = decodeMessage(def);
      expect(Buffer.from(msg.get(1)[0].value).toString("utf8")).toBe("noop");
    });
  });

  describe("encodeMcpTools", () => {
    it("produces empty bytes for no tools", () => {
      expect(encodeMcpTools([]).length).toBe(0);
      expect(encodeMcpTools().length).toBe(0);
    });

    it("wraps multiple tool defs as repeated field 1", () => {
      const tools = [
        { function: { name: "get_weather", parameters: { type: "object" } } },
        { function: { name: "calculate", parameters: { type: "object" } } },
      ];
      const mcpTools = encodeMcpTools(tools);
      const inner = decodeMessage(mcpTools);
      expect(inner.get(1).length).toBe(2);
    });
  });

  describe("McpArgs decode", () => {
    it("decodes name, toolName, toolCallId, and typed args map", () => {
      const argsBytes = Buffer.concat([
        entry("city", "Hanoi"),
        entry("count", 5),
        entry("flag", true),
        entry("nested", { a: [1, 2] }),
      ]);
      const mcpArgs = Buffer.concat([
        Buffer.from(encodeField(1, LEN, "get_weather")),
        argsBytes,
        Buffer.from(encodeField(3, LEN, "call_abc")),
        Buffer.from(encodeField(5, LEN, "get_weather")),
      ]);
      const decoded = decodeMcpArgs(mcpArgs);
      expect(decoded.name).toBe("get_weather");
      expect(decoded.toolName).toBe("get_weather");
      expect(decoded.toolCallId).toBe("call_abc");
      expect(decoded.args).toEqual({ city: "Hanoi", count: 5, flag: true, nested: { a: [1, 2] } });
    });

    it("handles empty args map", () => {
      const mcpArgs = Buffer.concat([
        Buffer.from(encodeField(1, LEN, "noop")),
        Buffer.from(encodeField(5, LEN, "noop")),
      ]);
      expect(decodeMcpArgs(mcpArgs).args).toEqual({});
    });

    it("defensively skips malformed map entries missing key or value", () => {
      const incompleteEntries = Buffer.concat([
        Buffer.from(encodeField(2, LEN, encodeField(1, LEN, "keyOnly"))),
        Buffer.from(encodeField(2, LEN, encodeField(2, LEN, encodeAgentValue("valOnly")))),
        entry("valid", "ok"),
      ]);
      const mcpArgs = Buffer.concat([
        Buffer.from(encodeField(1, LEN, "test_tool")),
        incompleteEntries,
      ]);
      expect(decodeMcpArgs(mcpArgs).args).toEqual({ valid: "ok" });
    });
  });

  describe("McpResult success", () => {
    it("builds success with single text content", () => {
      const bytes = encodeMcpResultSuccess({ textItems: ['{"temp":32}'], isError: false });
      const msg = decodeMessage(bytes); // McpResult level
      expect(msg.has(1)).toBe(true); // success variant
      const success = decodeMessage(msg.get(1)[0].value);
      expect(success.get(1).length).toBe(1);
      expect(success.get(2)[0].value).toBe(0); // is_error=false
      const item = decodeMessage(success.get(1)[0].value);
      const textContent = decodeMessage(item.get(1)[0].value);
      expect(Buffer.from(textContent.get(1)[0].value).toString("utf8")).toBe('{"temp":32}');
    });

    it("builds success with multiple text items", () => {
      const bytes = encodeMcpResultSuccess({ textItems: ["line1", "line2"] });
      const success = decodeMessage(decodeMessage(bytes).get(1)[0].value);
      expect(success.get(1).length).toBe(2);
    });

    it("marks is_error=true", () => {
      const bytes = encodeMcpResultSuccess({ textItems: ["fail"], isError: true });
      const success = decodeMessage(decodeMessage(bytes).get(1)[0].value);
      expect(success.get(2)[0].value).toBe(1);
    });
  });

  describe("McpResult image content", () => {
    it("builds image item with raw bytes + mime type", () => {
      const imgBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
      const bytes = encodeMcpResultSuccess({ imageItems: [{ data: imgBytes, mimeType: "image/png" }] });
      const success = decodeMessage(decodeMessage(bytes).get(1)[0].value);
      const item = decodeMessage(success.get(1)[0].value);
      expect(item.has(2)).toBe(true); // image variant
      const img = decodeMessage(item.get(2)[0].value);
      expect(Buffer.from(img.get(1)[0].value)).toEqual(Buffer.from(imgBytes));
      expect(Buffer.from(img.get(2)[0].value).toString("utf8")).toBe("image/png");
    });

    it("builds mixed text + image content", () => {
      const imgBytes = new Uint8Array([1, 2, 3]);
      const bytes = encodeMcpResultSuccess({ textItems: ["see image"], imageItems: [{ data: imgBytes, mimeType: "image/jpeg" }] });
      const success = decodeMessage(decodeMessage(bytes).get(1)[0].value);
      expect(success.get(1).length).toBe(2);
      expect(decodeMessage(success.get(1)[0].value).has(1)).toBe(true); // text
      expect(decodeMessage(success.get(1)[1].value).has(2)).toBe(true); // image
    });
  });

  describe("McpResult error / toolNotFound", () => {
    it("builds error result (field 2)", () => {
      const bytes = encodeMcpResultError("tool crashed");
      const msg = decodeMessage(bytes);
      expect(msg.has(2)).toBe(true);
      const err = decodeMessage(msg.get(2)[0].value);
      expect(Buffer.from(err.get(1)[0].value).toString("utf8")).toBe("tool crashed");
    });

    it("builds toolNotFound result (field 5)", () => {
      const bytes = encodeMcpResultToolNotFound("missing_tool");
      const msg = decodeMessage(bytes);
      expect(msg.has(5)).toBe(true);
      const tnf = decodeMessage(msg.get(5)[0].value);
      expect(Buffer.from(tnf.get(1)[0].value).toString("utf8")).toBe("missing_tool");
    });
  });
});

describe("Cursor AgentService executor helpers (cursor.js)", () => {
  describe("isAgentCapableRequest", () => {
    it("accepts plain text content", () => {
      expect(isAgentCapableRequest({ messages: [{ role: "user", content: "hi" }] })).toBe(true);
    });

    it("accepts array text content", () => {
      expect(isAgentCapableRequest({ messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }] })).toBe(true);
    });

    it("accepts request with tools declared", () => {
      expect(isAgentCapableRequest({ messages: [{ role: "user", content: "hi" }], tools: [{ function: { name: "t" } }] })).toBe(true);
    });

    it("accepts history with assistant tool_calls + tool results", () => {
      expect(isAgentCapableRequest({
        messages: [
          { role: "user", content: "weather?" },
          { role: "assistant", content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "get_weather", arguments: "{}" } }] },
          { role: "tool", tool_call_id: "c1", content: "sunny" },
          { role: "user", content: "thanks" },
        ],
      })).toBe(true);
    });

    it("rejects non-text (image) content", () => {
      expect(isAgentCapableRequest({ messages: [{ role: "user", content: [{ type: "image_url" }] }] })).toBe(false);
    });

    it("rejects missing messages", () => {
      expect(isAgentCapableRequest({})).toBe(false);
      expect(isAgentCapableRequest(null)).toBe(false);
    });
  });

  describe("buildAgentRunFrame", () => {
    // buildAgentRunFrame returns a wrapped Connect-RPC frame (5-byte header + AgentClientMessage).
    const unwrap = (frame) => frame.subarray(5);

    it("encodes a text-only run request with system folded into the user message", () => {
      const frame = unwrap(buildAgentRunFrame(
        [{ role: "system", content: "be brief" }, { role: "user", content: "hi" }],
        "gpt-5.2",
      ));
      const clientMsg = decodeMessage(frame);
      expect(clientMsg.has(1)).toBe(true); // run_request
      const run = decodeMessage(clientMsg.get(1)[0].value);
      expect(run.has(2)).toBe(true); // action
      expect(run.has(9)).toBe(true); // requested_model
      // custom_system_prompt (field 8) makes AgentService return an empty turn.
      expect(run.has(8)).toBe(false);
      expect(run.has(3)).toBe(true); // ModelDetails — required for thinking variants
      const action = decodeMessage(run.get(2)[0].value);
      const userAction = decodeMessage(action.get(1)[0].value);
      const userMessage = decodeMessage(userAction.get(1)[0].value);
      const userText = Buffer.from(userMessage.get(1)[0].value).toString("utf8");
      expect(userText).toContain("be brief");
      expect(userText).toContain("hi");
      expect(userMessage.get(4)[0].value).toBe(1); // mode=1
    });

    it("encodes mcp_tools (field 4) when tools are provided", () => {
      const tools = [{ function: { name: "get_weather", description: "weather", parameters: { type: "object", properties: { city: { type: "string" } } } } }];
      const frame = unwrap(buildAgentRunFrame([{ role: "user", content: "weather?" }], "gpt-5.2", tools));
      const run = decodeMessage(decodeMessage(frame).get(1)[0].value);
      expect(run.has(4)).toBe(true); // mcp_tools
      const mcpTools = decodeMessage(run.get(4)[0].value);
      expect(mcpTools.get(1).length).toBe(1);
    });

    it("omits mcp_tools when no tools provided", () => {
      const frame = unwrap(buildAgentRunFrame([{ role: "user", content: "hi" }], "gpt-5.2", []));
      const run = decodeMessage(decodeMessage(frame).get(1)[0].value);
      expect(run.has(4)).toBe(false);
    });

    it("encodes conversation_history from prior turns including tool calls/results", () => {
      const messages = [
        { role: "user", content: "weather in Tokyo?" },
        { role: "assistant", content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "get_weather", arguments: '{"city":"Tokyo"}' } }] },
        { role: "tool", tool_call_id: "c1", content: "18C cloudy" },
        { role: "user", content: "thanks" },
      ];
      const frame = unwrap(buildAgentRunFrame(messages, "gpt-5.2", []));
      const run = decodeMessage(decodeMessage(frame).get(1)[0].value);
      const action = decodeMessage(run.get(2)[0].value);
      const userAction = decodeMessage(action.get(1)[0].value);
      expect(userAction.has(7)).toBe(true); // conversation_history (field 7)
      const history = decodeMessage(userAction.get(7)[0].value);
      expect(history.get(1).length).toBeGreaterThanOrEqual(2); // prior turns
    });
  });

  describe("resolveCursorUpstreamModel", () => {
    it("resolves cu/default and cu/auto to a valid upstream model instead of passing raw default", () => {
      const defaultResolved = resolveCursorUpstreamModel("cu/default");
      const autoResolved = resolveCursorUpstreamModel("cu/auto");
      expect(defaultResolved).not.toBe("default");
      expect(autoResolved).not.toBe("auto");
      expect(defaultResolved).toBe("claude-4.5-sonnet");
      expect(autoResolved).toBe("claude-4.5-sonnet");
    });
  });
});

// --- AgentService Run stream: exec requests, thinking deltas, MCP tool calls ---

const VARINT = 0;

// agent.v1.AgentServerMessage.exec_request (field 2) carrying one ExecServerMessage variant.
function execRequestFrame(execField, payload = new Uint8Array()) {
  const execServerMessage = Buffer.from(encodeField(execField, LEN, payload));
  return Buffer.from(wrapConnectRPCFrame(encodeField(2, LEN, execServerMessage)));
}

// ExecServerMessage.id (1, varint) + .exec_id (15, string) + variant field.
function identifiedExecRequestFrame(execField, payload = new Uint8Array()) {
  const parts = Buffer.from(encodeField(1, VARINT, 7));
  const execId = Buffer.from(encodeField(15, LEN, "exec-1"));
  const variant = Buffer.from(encodeField(execField, LEN, payload));
  return Buffer.from(wrapConnectRPCFrame(encodeField(2, LEN, Buffer.concat([parts, execId, variant]))));
}

// agent.v1.AgentServerMessage.interaction_update (field 1) → text_delta (1).
function textFrame(text) {
  const textPart = Buffer.from(encodeField(1, LEN, text));
  const update = Buffer.from(encodeField(1, LEN, textPart));
  return Buffer.from(wrapConnectRPCFrame(encodeField(1, LEN, update)));
}

// InteractionUpdate.thinking_delta (field 4) + turn_ended (field 14).
function thinkingFrame(text) {
  const thinkingPart = Buffer.from(encodeField(1, LEN, text));
  const update = Buffer.from(encodeField(4, LEN, thinkingPart));
  return Buffer.from(wrapConnectRPCFrame(encodeField(1, LEN, update)));
}

function turnEndedFrame() {
  const update = Buffer.from(encodeField(14, LEN, new Uint8Array()));
  return Buffer.from(wrapConnectRPCFrame(encodeField(1, LEN, update)));
}

function stubAgentSession(executor, frames) {
  const written = [];
  const queue = [...frames];
  executor.openAgentHttp2Stream = () => ({
    responseHeaders: Promise.resolve({ ":status": 200 }),
    write: (frame) => written.push(Buffer.from(frame)),
    end() {},
    close() {},
    async read() {
      if (!queue.length) return { value: undefined, done: true };
      return { value: queue.shift(), done: false };
    },
  });
  return written;
}

const agentCredentials = {
  accessToken: "test-token",
  providerSpecificData: { machineId: "a".repeat(64) },
};

function parseAgentSSE(text) {
  return text
    .split("\n\n")
    .filter((chunk) => chunk.startsWith("data: "))
    .map((chunk) => chunk.slice("data: ".length))
    .filter((data) => data !== "[DONE]")
    .map((data) => JSON.parse(data));
}

async function runAgent({ frames, stream, model = "gpt-5.2", tools, proxyOptions }) {
  const executor = new CursorExecutor();
  const written = stubAgentSession(executor, frames);
  const result = await executor.executeAgent({
    model,
    body: { messages: [{ role: "user", content: "hi" }], ...(tools ? { tools } : {}) },
    stream,
    credentials: agentCredentials,
    proxyOptions,
  });
  return { result, written };
}

describe("CursorExecutor AgentService exec_request handling", () => {
  it("keeps the latest complete user turn when trimming long-session history", () => {
    const messages = [
      { role: "system", content: "system" },
      { role: "user", content: "old request" },
      { role: "assistant", content: "old answer" },
      { role: "assistant", content: "tool call", tool_calls: [{ id: "call-1" }] },
      { role: "tool", tool_call_id: "call-1", content: "tool output" },
      { role: "user", content: "current request" },
      { role: "assistant", content: "current tool call" },
      { role: "tool", tool_call_id: "call-2", content: "current tool output" },
    ];

    expect(tailOnlyCursorMessages(messages)).toEqual([
      { role: "system", content: "system" },
      { role: "user", content: "current request" },
      { role: "assistant", content: "current tool call" },
      { role: "tool", tool_call_id: "call-2", content: "current tool output" },
    ]);
  });

  it("retries an empty turn once with tail-only history for a long session", async () => {
    const executor = new CursorExecutor();
    const messages = [
      ...Array.from({ length: 79 }, (_, index) => ({
        role: index % 2 === 0 ? "user" : "assistant",
        content: `turn ${index}`,
      })),
      { role: "user", content: "turn 79" },
    ];
    let attempt = 0;
    const written = [];
    executor.openAgentHttp2Stream = () => {
      const frames = attempt++ === 0 ? [turnEndedFrame()] : [textFrame("recovered")];
      return {
        responseHeaders: Promise.resolve({ ":status": 200 }),
        write: (frame) => written.push(Buffer.from(frame)),
        end() {},
        close() {},
        async read() {
          if (!frames.length) return { value: undefined, done: true };
          return { value: frames.shift(), done: false };
        },
      };
    };

    const { response } = await executor.executeAgent({
      model: "gpt-5.2",
      body: { messages },
      stream: false,
      credentials: agentCredentials,
    });

    const payload = await response.json();
    expect(payload.choices[0].message.content).toBe("recovered");
    expect(written).toHaveLength(2);
    const retryRun = decodeMessage(decodeMessage(written[1].subarray(5)).get(1)[0].value);
    const runAction = decodeMessage(retryRun.get(2)[0].value);
    const currentUser = decodeMessage(decodeMessage(runAction.get(1)[0].value).get(1)[0].value);
    expect(Buffer.from(currentUser.get(1)[0].value).toString("utf8")).toContain("turn 79");
    expect(Buffer.from(currentUser.get(1)[0].value).toString("utf8")).not.toContain("turn 0");
  });

  it("fails closed when strict proxy intent would use the direct h2 path", async () => {
    const executor = new CursorExecutor();
    executor.openAgentHttp2Stream = () => { throw new Error("must not open direct h2 session"); };
    await expect(executor.executeAgent({
      model: "gpt-5.2",
      body: { messages: [{ role: "user", content: "hi" }] },
      stream: false,
      credentials: agentCredentials,
      proxyOptions: { strictProxy: true, proxyPoolId: "strict-pool" },
    })).rejects.toThrow(/strict proxy/);
  });

  it("acks request_context with the exec ids and without echoing client tools", async () => {
    const { written, result } = await runAgent({
      tools: [{ function: { name: "read_file", parameters: { type: "object" } } }],
      frames: [identifiedExecRequestFrame(10), textFrame("hello")],
      stream: true,
    });

    expect(written.length).toBe(2); // run frame + request-context ack
    expect(written[1].toString("utf8")).toContain("exec-1");
    expect(written[1].toString("utf8")).not.toContain("read_file");
    const content = parseAgentSSE(await result.response.text())
      .map((e) => e.choices?.[0]?.delta?.content || "")
      .join("");
    expect(content).toBe("hello");
  });

  it("rejects an IDE builtin exec so the model can continue the turn", async () => {
    const { result, written } = await runAgent({
      frames: [textFrame("partial answer"), identifiedExecRequestFrame(2), textFrame(" more")],
      stream: true,
    });

    const body = await result.response.text();
    expect(body).not.toContain("unsupported IDE tool");
    const events = parseAgentSSE(body);
    const content = events.map((e) => e.choices?.[0]?.delta?.content || "").join("");
    expect(content).toBe("partial answer more");
    expect(events.some((e) => e.error)).toBe(false);
    expect(written.length).toBe(2); // run frame + exec rejection

    const clientMsg = decodeMessage(written[1].subarray(5));
    const execClientMessage = decodeMessage(clientMsg.get(2)[0].value);
    expect(execClientMessage.has(2)).toBe(true); // rejected shell_exec result
    expect(Buffer.from(execClientMessage.get(15)[0].value).toString("utf8")).toBe("exec-1");
  });

  it("still emits later text batched behind a rejected IDE exec in the same read", async () => {
    const { result } = await runAgent({
      frames: [Buffer.concat([execRequestFrame(2), textFrame("late")])],
      stream: true,
    });

    const body = await result.response.text();
    expect(body).not.toContain("unsupported IDE tool");
    expect(body).toContain("late");
  });

  it("returns a non-200 error body for a nameless MCP exec request when not streaming", async () => {
    const { result } = await runAgent({
      frames: [execRequestFrame(11)],
      stream: false,
    });

    expect(result.response.status).not.toBe(200);
    const payload = await result.response.json();
    expect(payload.error.message).toContain("unsupported IDE tool");
  });

  it("emits an MCP tool_call with finish_reason tool_calls", async () => {
    const mcpArgs = Buffer.concat([
      Buffer.from(encodeField(1, LEN, "get_weather")),
      Buffer.from(entry("city", "Hanoi")),
      Buffer.from(encodeField(3, LEN, "call_abc")),
      Buffer.from(encodeField(5, LEN, "get_weather")),
    ]);
    const { result } = await runAgent({
      frames: [identifiedExecRequestFrame(11, mcpArgs)],
      stream: true,
    });

    const events = parseAgentSSE(await result.response.text());
    const toolCall = events.map((e) => e.choices?.[0]?.delta?.tool_calls?.[0]).find(Boolean);
    expect(toolCall.function.name).toBe("get_weather");
    expect(toolCall.function.arguments).toBe(JSON.stringify({ city: "Hanoi" }));
    expect(events.at(-1).choices[0].finish_reason).toBe("tool_calls");
  });

  it("streams Composer visible content from thinking_delta after </think>", async () => {
    const { result } = await runAgent({
      model: "composer-2.5",
      frames: [
        thinkingFrame("private reasoning that must not leak</think>OK"),
        turnEndedFrame(),
      ],
      stream: true,
    });

    const events = parseAgentSSE(await result.response.text());
    const content = events.map((e) => e.choices?.[0]?.delta?.content || "").join("");
    expect(content).toBe("OK");
    expect(JSON.stringify(events)).not.toContain("private reasoning");
  });

  it("flushes Grok thinking as visible content when the turn has no text_delta", async () => {
    const { result } = await runAgent({
      model: "grok-4.5",
      frames: [thinkingFrame("hello from grok"), turnEndedFrame()],
      stream: true,
    });

    const events = parseAgentSSE(await result.response.text());
    const content = events.map((e) => e.choices?.[0]?.delta?.content || "").join("");
    expect(content).toBe("hello from grok");
  });

  describe("Connect-RPC trailer error handling", () => {
    function createTrailerFrame(payloadObj = { error: { code: "resource_exhausted", message: "Free tier quota exceeded" } }) {
      const errorPayload = Buffer.from(JSON.stringify(payloadObj));
      const header = Buffer.alloc(5);
      header[0] = 0x02; // Connect-RPC trailer flag
      header.writeUInt32BE(errorPayload.length, 1);
      return Buffer.concat([header, errorPayload]);
    }

    it("surfaces Connect error payload through frame decoder", () => {
      const trailerFrame = createTrailerFrame();
      const frames = [];
      decodeAgentFrames(trailerFrame, (payload, meta) => {
        frames.push({ payload, meta });
      });

      expect(frames.length).toBe(1);
      expect(frames[0].meta?.isTrailer).toBe(true);
      expect(frames[0].meta?.error?.code).toBe("resource_exhausted");
      expect(frames[0].meta?.error?.message).toBe("Free tier quota exceeded");
    });

    it("surfaces Connect trailer error in executor.executeAgent without swallowing into choices with content null", async () => {
      const trailerFrame = createTrailerFrame();
      const { result } = await runAgent({
        frames: [trailerFrame],
        stream: false,
      });

      expect(result.response.status).not.toBe(200);
      expect(result.response.status).toBe(429);
      const payload = await result.response.json();
      expect(payload).not.toHaveProperty("choices");
      expect(payload.error).toBeDefined();
      expect(payload.error.message).toContain("Free tier quota exceeded");
      expect(payload.error.type).toBe("rate_limit_error");
    });

    it("surfaces Connect trailer error in streaming executor.executeAgent without emitting content null", async () => {
      const trailerFrame = createTrailerFrame();
      const { result } = await runAgent({
        frames: [trailerFrame],
        stream: true,
      });

      const bodyText = await result.response.text();
      expect(bodyText).toContain("Free tier quota exceeded");
      const events = parseAgentSSE(bodyText);
      const errorEvent = events.find((e) => e.error);
      expect(errorEvent).toBeDefined();
      expect(errorEvent.error.message).toContain("Free tier quota exceeded");
      const nullChoice = events.find((e) => e.choices?.[0]?.message?.content === null);
      expect(nullChoice).toBeUndefined();
    });

    it("resolves default and cu/default to claude-4.5-sonnet in executeAgent written frame", async () => {
      const { written: writtenDefault } = await runAgent({
        model: "default",
        frames: [textFrame("hi")],
        stream: false,
      });
      expect(writtenDefault.length).toBeGreaterThan(0);
      expect(writtenDefault[0].toString("utf8")).toContain("claude-4.5-sonnet");

      const { written: writtenCuDefault } = await runAgent({
        model: "cu/default",
        frames: [textFrame("hi")],
        stream: false,
      });
      expect(writtenCuDefault.length).toBeGreaterThan(0);
      expect(writtenCuDefault[0].toString("utf8")).toContain("claude-4.5-sonnet");
    });

    it("does not throw Cannot error a closed stream if stream throws after error frame closes controller", async () => {
      const trailerFrame = createTrailerFrame();
      const executor = new CursorExecutor();
      let callCount = 0;
      executor.openAgentHttp2Stream = () => ({
        responseHeaders: Promise.resolve({ ":status": 200 }),
        write: () => {},
        end() {},
        close() {},
        read: async () => {
          callCount++;
          if (callCount === 1) return { value: trailerFrame, done: false };
          throw new Error("HTTP2 session destroyed");
        },
      });
      const { response } = await executor.executeAgent({
        model: "gpt-5.2",
        body: { messages: [{ role: "user", content: "hi" }] },
        stream: true,
        credentials: agentCredentials,
      });
      const bodyText = await response.text();
      expect(bodyText).toContain("Free tier quota exceeded");
    });
  });
});
