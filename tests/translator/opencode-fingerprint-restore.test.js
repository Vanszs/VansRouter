/**
 * Streaming counterpart of tests/unit/opencode-fingerprint.test.js.
 *
 * The OpenCode free tier only accepts the lowercase file-search quartet, so an
 * agent's `Read`/`Bash` tool goes upstream as `read`/`bash`. translateResponse()
 * must rename it back on the way out — a Claude Code / ZCode client rejects a
 * tool call whose name it never registered as an unknown tool.
 */
import { describe, expect, it } from "vitest";
import "./registerAll.js";
import { translateResponse, initState } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { OpenCodeExecutor } from "../../open-sse/executors/opencode.js";
import { takeRenamedToolNames } from "../../open-sse/utils/opencodeFingerprint.js";

const CREDS = { connectionId: "opencode-fingerprint-stream-test" };
const CC_TOOLS = [
  { type: "function", function: { name: "Bash", description: "cc" } },
  { type: "function", function: { name: "Read", description: "cc" } },
];

// Mirrors chatCore: the executor renames tools on the body it was handed, and
// that same map is threaded into the response state.
function fingerprintMapFor(model) {
  const body = { messages: [{ role: "user", content: "hi" }], tools: structuredClone(CC_TOOLS) };
  new OpenCodeExecutor().transformRequest(model, body, true, CREDS);
  return takeRenamedToolNames(body);
}

const openaiToolChunk = (name) => ({
  choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "call_1", function: { name, arguments: "{}" } }] } }]
});

describe("OpenCode fingerprint rename → client stream", () => {
  it("restores the original name in an OpenAI stream (same-format passthrough)", () => {
    const state = { toolNameMap: fingerprintMapFor("big-pickle") };
    const [out] = translateResponse(FORMATS.OPENAI, FORMATS.OPENAI, openaiToolChunk("bash"), state);

    expect(out.choices[0].delta.tool_calls[0].function.name).toBe("Bash");
  });

  it("restores the original name in a Claude stream (openai → claude pivot)", () => {
    const state = { ...initState(FORMATS.CLAUDE), toolNameMap: fingerprintMapFor("big-pickle") };
    const results = translateResponse(FORMATS.OPENAI, FORMATS.CLAUDE, openaiToolChunk("read"), state);
    const start = results.find((chunk) => chunk?.type === "content_block_start");

    expect(start.content_block.type).toBe("tool_use");
    expect(start.content_block.name).toBe("Read");
  });

  it("leaves the stream untouched when the provider renamed nothing", () => {
    const [out] = translateResponse(FORMATS.OPENAI, FORMATS.OPENAI, openaiToolChunk("bash"), {});
    expect(out.choices[0].delta.tool_calls[0].function.name).toBe("bash");
  });
});
