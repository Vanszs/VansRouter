// OpenCode Go is account-scoped: HTTP refusals must not bench egress pools or
// return the rotation wait response. Only the free `opencode` lane rotates.
import { describe, it, expect, vi, beforeEach } from "vitest";

const { executeMock, markPoolUnfitMock, resolveProxyMock } = vi.hoisted(() => ({
  executeMock: vi.fn(),
  markPoolUnfitMock: vi.fn(async () => {}),
  resolveProxyMock: vi.fn(async () => ({
    proxyPoolId: "pool-b",
    connectionProxyEnabled: true,
    connectionProxyUrl: "http://b",
  })),
}));

vi.mock("../../open-sse/executors/index.js", () => ({
  getExecutor: () => ({
    noAuth: false,
    execute: executeMock,
    parseError: (response, bodyText) => executor.parseError(response, bodyText),
  }),
}));

vi.mock("../../open-sse/services/proxyPoolFitness.js", () => ({
  markPoolUnfit: markPoolUnfitMock,
  loadPoolFitness: vi.fn(async () => {}),
  isPoolFit: vi.fn(() => true),
  earliestPoolUnfitUntil: vi.fn(() => null),
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
const { OpenCodeGoExecutor } = await import("../../open-sse/executors/opencode-go.js");

const executor = new OpenCodeGoExecutor();
const MODEL = "deepseek-v4.1-flash";
const SCOPE = `opencode-go::${MODEL}`;

function credentials() {
  return {
    apiKey: "test-key",
    connectionId: "go-connection",
    providerSpecificData: {
      proxyPoolId: "pool-a",
      proxyPoolIds: ["pool-a", "pool-b"],
      proxyRotationStrategy: "round-robin",
      proxyPoolScope: SCOPE,
      connectionProxyEnabled: true,
      connectionProxyUrl: "http://a",
    },
  };
}

async function run(status, body) {
  executeMock.mockResolvedValueOnce({
    response: new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    }),
    url: "https://opencode.ai/inference/go/openai/v1/chat/completions",
    headers: {},
    transformedBody: null,
  });
  return handleChatCore({
    body: { model: `opencode-go/${MODEL}`, stream: false, messages: [{ role: "user", content: "hi" }] },
    modelInfo: { provider: "opencode-go", model: MODEL },
    credentials: credentials(),
    connectionId: "go-connection",
    resolveProxyConfig: resolveProxyMock,
    log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn() },
  });
}

beforeEach(() => {
  executeMock.mockReset();
  markPoolUnfitMock.mockClear();
  resolveProxyMock.mockClear();
});

describe("OpenCode Go account scope", () => {
  it("does not rotate or bench on an abusive 403", async () => {
    const result = await run(403, {
      error: { type: "FreeTierError", message: "we've detected abusive traffic from this IP address" },
    });

    expect(result.errorCode).not.toBe("ROTATION_IN_PROGRESS");
    expect(result.response?.headers?.get?.("x-vansroute-rotation")).toBeFalsy();
    expect(executeMock).toHaveBeenCalledTimes(1);
    expect(markPoolUnfitMock).not.toHaveBeenCalled();
    expect(resolveProxyMock).not.toHaveBeenCalled();
  });

  it("does not rotate on a 5xx", async () => {
    const result = await run(503, { error: { message: "Service unavailable" } });

    expect(result.errorCode).not.toBe("ROTATION_IN_PROGRESS");
    expect(markPoolUnfitMock).not.toHaveBeenCalled();
  });

  it("does not rotate a model error", async () => {
    const result = await run(401, { error: { message: "Model foo is not supported" } });

    expect(result.errorCode).not.toBe("ROTATION_IN_PROGRESS");
    expect(markPoolUnfitMock).not.toHaveBeenCalled();
  });
});
