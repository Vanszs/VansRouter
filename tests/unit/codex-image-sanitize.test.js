// End-to-end guard for the Codex Responses image_url validation failure:
// Invalid 'input[..].content[..].image_url'. Expected a valid URL.
// Drives the real handleChatCore + Responses translator; only HTTP is mocked.
import { describe, it, expect, vi, beforeEach } from "vitest";

const { executeMock } = vi.hoisted(() => ({ executeMock: vi.fn() }));

vi.mock("../../open-sse/executors/index.js", () => ({
  getExecutor: () => ({ noAuth: false, execute: executeMock }),
}));

vi.mock("../../open-sse/utils/requestLogger.js", () => ({
  createRequestLogger: async () => ({
    logClientRawRequest: vi.fn(),
    logRawRequest: vi.fn(),
    logTargetRequest: vi.fn(),
    logProviderResponse: vi.fn(),
    logConvertedResponse: vi.fn(),
    logError: vi.fn(),
  }),
}));

vi.mock("../../open-sse/utils/stream.js", () => ({
  COLORS: { red: "", reset: "" },
  createPassthroughStreamWithLogger: vi.fn(() => new TransformStream()),
  createSSETransformStreamWithLogger: vi.fn(() => new TransformStream()),
}));

vi.mock("uuid", () => ({
  v4: () => "00000000-0000-4000-8000-000000000000",
}));

vi.mock("@/lib/usageDb.js", () => ({
  trackPendingRequest: vi.fn(),
  appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
  saveRequestUsage: vi.fn(async () => {}),
}));

const { handleChatCore } = await import("../../open-sse/handlers/chatCore.js");

const MODEL = "gpt-6-luna";
const RESPONSE = {
  id: "resp_1",
  object: "response",
  created_at: 0,
  status: "completed",
  model: "test",
  output: [{
    type: "message",
    id: "msg_1",
    role: "assistant",
    status: "completed",
    content: [{ type: "output_text", text: "ok", annotations: [] }],
  }],
};

const TINY_PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

async function run(imageUrl) {
  executeMock.mockResolvedValueOnce({
    response: new Response(JSON.stringify(RESPONSE), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
    url: "https://chatgpt.com/backend-api/codex/responses",
    headers: {},
    transformedBody: null,
  });
  await handleChatCore({
    body: {
      model: `codex/${MODEL}`,
      stream: false,
      messages: [{
        role: "user",
        content: [
          { type: "text", text: "what is this?" },
          { type: "image_url", image_url: { url: imageUrl } },
        ],
      }],
    },
    modelInfo: { provider: "codex", model: MODEL },
    credentials: { accessToken: "test-token", providerSpecificData: {} },
    connectionId: "codex-image-test",
    sourceFormatOverride: "openai",
    log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn() },
  });
  return executeMock.mock.calls.at(-1)[0].body;
}

beforeEach(() => {
  executeMock.mockReset();
});

describe("Codex Responses image_url sanitization", () => {
  it("replaces a local file path with a text placeholder", async () => {
    const outbound = await run("file:///tmp/screenshot.png");
    const serialized = JSON.stringify(outbound);
    expect(serialized).not.toContain("file://");
    expect(serialized).toContain("[image omitted");
  });

  it("wraps bare base64 in a data URL", async () => {
    const outbound = await run(TINY_PNG);
    expect(JSON.stringify(outbound)).toContain(`data:image/png;base64,${TINY_PNG}`);
  });

  it("keeps a normal https image URL", async () => {
    const outbound = await run("https://cdn.example.com/cat.png");
    expect(JSON.stringify(outbound)).toContain("https://cdn.example.com/cat.png");
  });
});
