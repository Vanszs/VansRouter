import { describe, expect, it, vi } from "vitest";

const { executeMock } = vi.hoisted(() => ({ executeMock: vi.fn() }));

vi.mock("../../open-sse/executors/index.js", () => ({
  getExecutor: () => ({ noAuth: true, execute: executeMock }),
}));
vi.mock("../../open-sse/utils/requestLogger.js", () => ({
  createRequestLogger: async () => ({
    logClientRawRequest: vi.fn(), logRawRequest: vi.fn(), logTargetRequest: vi.fn(),
    logProviderResponse: vi.fn(), logConvertedResponse: vi.fn(), logError: vi.fn(),
  }),
}));
vi.mock("../../open-sse/utils/stream.js", () => ({
  COLORS: { red: "", reset: "" },
  createPassthroughStreamWithLogger: vi.fn(() => new TransformStream()),
}));
vi.mock("uuid", () => ({ v4: () => "00000000-0000-4000-8000-000000000000" }));
vi.mock("@/lib/usageDb.js", () => ({
  trackPendingRequest: vi.fn(), appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}), saveRequestUsage: vi.fn(async () => {}),
}));
vi.mock("../../open-sse/translator/concerns/image.js", () => ({
  encodeDataUri: (mime, data) => `data:${mime};base64,${data}`,
  parseDataUri: () => null, fetchImageAsBase64: async () => null,
}));

const { handleChatCore } = await import("../../open-sse/handlers/chatCore.js");

describe("OpenCode Free provider-level thinking override", () => {
  it("uses OpenAI reasoning_effort without leaking Claude-style thinking to /zen/v1", async () => {
    executeMock.mockImplementationOnce(async ({ body }) => ({
      response: new Response(JSON.stringify({
        id: "chatcmpl-test", object: "chat.completion", model: "glm-5.3-flash-free",
        choices: [{ index: 0, message: { role: "assistant", content: "OK" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }), { status: 200, headers: { "content-type": "application/json" } }),
      url: "https://opencode.ai/zen/v1/chat/completions", headers: {}, transformedBody: body,
    }));

    const result = await handleChatCore({
      body: { model: "oc/glm-5.3-flash-free", messages: [{ role: "user", content: "Say OK." }], stream: false },
      modelInfo: { provider: "opencode", model: "glm-5.3-flash-free" },
      credentials: { connectionId: "oc-thinking-test", accessToken: "public", providerSpecificData: {} },
      connectionId: "oc-thinking-test", providerThinking: { mode: "xhigh" },
      log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn() },
    });

    expect(result.success).toBe(true);
    const sent = executeMock.mock.calls[0][0].body;
    expect(sent.reasoning_effort).toBe("xhigh");
    expect(sent).not.toHaveProperty("thinking");
  });
});
