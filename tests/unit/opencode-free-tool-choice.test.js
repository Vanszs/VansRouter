import { describe, expect, it, vi } from "vitest";
import { PROVIDERS } from "../../open-sse/config/providers.js";
import { OpenCodeExecutor } from "../../open-sse/executors/opencode.js";
import { proxyAwareFetch } from "../../open-sse/utils/proxyFetch.js";

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: vi.fn(async () => ({ ok: true, status: 200, headers: { get: () => "" } })),
}));

// OpenCode Free answers 400 for muse-spark-1.3-contributor-free unless
// tool_choice is "auto", so named/required/none must be demoted.
const FREE_13 = "muse-spark-1.3-contributor-free";
const CREDS = { connectionId: "opencode-free-tool-choice-test" };
const INPUT = [{ type: "message", role: "user", content: [{ type: "input_text", text: "hi" }] }];
const TOOLS = [{ type: "function", name: "get_weather", description: "w", parameters: { type: "object", properties: {} } }];
const QUARTET = ["bash", "glob", "grep", "read"];

function responsesBody(model, tool_choice) {
  const body = { model, input: structuredClone(INPUT), tools: structuredClone(TOOLS) };
  if (tool_choice !== undefined) body.tool_choice = tool_choice;
  return body;
}

describe("opencode Free 1.3 tool_choice auto-only", () => {
  it("declares the quirk for the 1.3-Free model only", () => {
    expect(PROVIDERS.opencode.quirks?.forceAutoToolChoiceModels).toEqual([FREE_13]);
  });

  it.each([
    ["Responses named", { type: "function", name: "get_weather" }],
    ["Chat function named", { type: "function", function: { name: "get_weather" } }],
    ["Claude tool named", { type: "tool", name: "get_weather" }],
    ["required", "required"],
    ["none", "none"],
  ])("demotes %s to auto (plain and thinking variant)", (_label, choice) => {
    for (const model of [FREE_13, `${FREE_13}(max)`]) {
      const body = responsesBody(model, structuredClone(choice));
      const out = new OpenCodeExecutor().transformRequest(model, body, true, CREDS);
      expect(out.tool_choice).toBe("auto");
      expect(out.input).toEqual(INPUT);
    }
  });

  it("leaves tool_choice of other models untouched", () => {
    const choice = { type: "function", name: "get_weather" };
    for (const model of ["muse-spark-1.2-contributor-free", "muse-spark-1.4-contributor-free", "big-pickle"]) {
      const body = responsesBody(model, structuredClone(choice));
      const out = new OpenCodeExecutor().transformRequest(model, body, true, CREDS);
      expect(out.tool_choice).toEqual(choice);
    }
  });

  it("wire: execute sends the demoted choice to /zen/v1/responses", async () => {
    proxyAwareFetch.mockClear();
    const body = responsesBody(FREE_13, { type: "function", name: "get_weather" });
    const { url, transformedBody } = await new OpenCodeExecutor().execute({
      model: FREE_13, body, stream: true, credentials: CREDS,
    });
    expect(url).toBe("https://opencode.ai/zen/v1/responses");
    expect(transformedBody.tool_choice).toBe("auto");
    expect(proxyAwareFetch).toHaveBeenCalledTimes(1);
    const [actualUrl, actualInit] = proxyAwareFetch.mock.calls[0];
    expect(actualUrl).toBe("https://opencode.ai/zen/v1/responses");
    const sent = JSON.parse(actualInit.body);
    expect(sent.tool_choice).toBe("auto");
    expect(sent.model).toBe(FREE_13);
    expect(sent.input).toEqual(INPUT);
  });
});

describe("opencode free-tier fingerprint tools", () => {
  const executor = new OpenCodeExecutor();

  it("appends the flat quartet to Responses requests beside client tools", () => {
    const body = responsesBody(FREE_13, undefined);
    const out = executor.transformRequest(FREE_13, body, true, CREDS);
    expect(out.tools[0]).toEqual(TOOLS[0]);
    expect(out.tools).toHaveLength(TOOLS.length + QUARTET.length);
    for (const name of QUARTET) {
      expect(out.tools.find((tool) => tool.name === name)).toMatchObject({
        type: "function",
        parameters: { type: "object", properties: {} },
      });
    }
    expect(out.tool_choice).toBe("auto");
  });

  it("never duplicates a quartet member the caller already declares", () => {
    for (const spelling of ["bash", "Bash"]) {
      const body = {
        messages: [{ role: "user", content: "hi" }],
        tools: [{ type: "function", function: { name: spelling, description: "client", parameters: { type: "object" } } }],
      };
      const out = executor.transformRequest("big-pickle", body, true, CREDS);
      const named = out.tools.filter((tool) => tool.function.name.toLowerCase() === "bash");
      expect(named).toHaveLength(1);
      expect(named[0].function.description).toBe("client");
      expect(out.tools.some((tool) => tool.function.name === "glob")).toBe(true);
    }
  });

  it("does not mutate the caller's tools array", () => {
    const tools = [{ type: "function", function: { name: "get_weather", parameters: { type: "object" } } }];
    const body = { messages: [{ role: "user", content: "hi" }], tools };
    const out = executor.transformRequest("big-pickle", body, true, CREDS);
    expect(tools).toHaveLength(1);
    expect(out.tools).toHaveLength(1 + QUARTET.length);
  });

  it("uses nested decoys and tool_choice none for chat requests without tools", () => {
    const out = executor.transformRequest("big-pickle", { messages: [{ role: "user", content: "hi" }] }, true, CREDS);
    expect(out.tools.map((tool) => tool.function.name)).toEqual(QUARTET);
    expect(out.tool_choice).toBe("none");
  });

  it("keeps the caller tool_choice for chat requests that already have tools", () => {
    const body = {
      messages: [{ role: "user", content: "hi" }],
      tools: [{ type: "function", function: { name: "get_weather", parameters: { type: "object" } } }],
      tool_choice: "required",
    };
    const out = executor.transformRequest("big-pickle", body, true, CREDS);
    expect(out.tool_choice).toBe("required");
    expect(out.tools.map((tool) => tool.function.name)).toEqual(["get_weather", ...QUARTET]);
  });

  it("uses Anthropic decoy shape for the Messages lane and leaves tool_choice alone", () => {
    const body = {
      messages: [{ role: "user", content: "hi" }],
      tools: [{ name: "get_weather", description: "w", input_schema: { type: "object", properties: {} } }],
    };
    const out = executor.transformRequest("union-alpha", body, true, CREDS);
    expect(out.tools.map((tool) => tool.name)).toEqual(["get_weather", ...QUARTET]);
    expect(out.tools[1]).toMatchObject({ name: "bash", input_schema: { type: "object", properties: {} } });
    expect("tool_choice" in out).toBe(false);
  });
});
