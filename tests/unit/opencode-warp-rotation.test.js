// Warp mode is terminal: an egress refusal rotates the local WARP container,
// then returns the 503 + Retry-After instead of replaying the request or
// benching a pool that was never used.
import { beforeEach, describe, expect, it, vi } from "vitest";

const { executeMock, rotateMock, markMock, earliestMock } = vi.hoisted(() => ({
  executeMock: vi.fn(),
  rotateMock: vi.fn(async () => ({ ok: true, ip: "203.0.113.9", reused: false })),
  markMock: vi.fn(async () => {}),
  earliestMock: vi.fn(() => null),
}));

vi.mock("../../open-sse/executors/index.js", () => ({
  getExecutor: () => ({ noAuth: true, execute: executeMock }),
}));

vi.mock("../../open-sse/services/warpEgress.js", () => ({
  WARP_EGRESS_ID: "warp:local",
  rotateWarpEgress: rotateMock,
}));

vi.mock("../../open-sse/services/proxyPoolFitness.js", () => ({
  markPoolUnfit: markMock,
  earliestPoolUnfitUntil: earliestMock,
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

vi.mock("uuid", () => ({ v4: () => "00000000-0000-4000-8000-000000000000" }));

vi.mock("@/lib/usageDb.js", () => ({
  trackPendingRequest: vi.fn(),
  appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
  saveRequestUsage: vi.fn(async () => {}),
}));

const { handleChatCore } = await import("../../open-sse/handlers/chatCore.js");

const credentials = {
  apiKey: "public",
  providerSpecificData: {
    connectionProxyEnabled: true,
    connectionProxyUrl: "http://127.0.0.1:9091",
    proxyRotationStrategy: "warp",
    strictProxy: true,
  },
};

const run = () => handleChatCore({
  body: {
    model: "oc/deepseek-v4.1-flash-free",
    stream: false,
    messages: [{ role: "user", content: "hi" }],
  },
  modelInfo: { provider: "opencode", model: "deepseek-v4.1-flash-free" },
  credentials,
  connectionId: "warp:local",
  resolveProxyConfig: vi.fn(),
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn() },
});

beforeEach(() => {
  vi.clearAllMocks();
  rotateMock.mockResolvedValue({ ok: true, ip: "203.0.113.9", reused: false });
});

describe("OpenCode free WARP rotation", () => {
  it("rotates the local egress and returns the wait response", async () => {
    executeMock.mockImplementationOnce(async () => {
      const error = new Error("free usage limit");
      error.poolScoped = { reason: "ip-limit", deferRotation: true };
      throw error;
    });

    const result = await run();

    expect(rotateMock).toHaveBeenCalledOnce();
    expect(result).toMatchObject({
      success: false,
      status: 503,
      errorCode: "ROTATION_IN_PROGRESS",
      rotationPending: { fromPoolId: "warp:local", toPoolId: "warp:local", reason: "ip-limit" },
    });
    expect(result.response.headers.get("retry-after")).toBe("2");
    expect(result.response.headers.get("x-vansroute-rotation")).toBe("warp:local>warp:local");
    expect(await result.response.json()).toMatchObject({
      error: { code: "rotation_in_progress", reason: "ip-limit" },
    });
  });

  it("advertises the cooldown when a rotation was just done", async () => {
    rotateMock.mockResolvedValueOnce({ ok: true, ip: "203.0.113.9", reused: true, retryAfterMs: 12_000 });
    executeMock.mockImplementationOnce(async () => {
      const error = new Error("free usage limit");
      error.poolScoped = { reason: "ip-limit", deferRotation: true };
      throw error;
    });

    const result = await run();

    expect(result.status).toBe(503);
    expect(result.response.headers.get("retry-after")).toBe("12");
  });

  it("does not report a same-pool rotation when every pool is benched", async () => {
    earliestMock.mockReturnValueOnce(Date.now() + 24 * 60 * 60 * 1000);
    executeMock.mockImplementationOnce(async () => {
      const error = new Error("free usage limit");
      error.poolScoped = { reason: "ip-limit", deferRotation: true };
      throw error;
    });

    const result = await handleChatCore({
      body: {
        model: "oc/deepseek-v4.1-flash-free",
        stream: false,
        messages: [{ role: "user", content: "hi" }],
      },
      modelInfo: { provider: "opencode", model: "deepseek-v4.1-flash-free" },
      credentials: {
        apiKey: "public",
        providerSpecificData: {
          connectionProxyEnabled: true,
          connectionProxyUrl: "http://pool",
          proxyRotationStrategy: "round-robin",
          proxyPoolIds: ["aff7", "c120"],
          proxyPoolId: "aff7",
        },
      },
      connectionId: "proxy:aff7",
      resolveProxyConfig: vi.fn(async () => null),
      log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn() },
    });

    expect(markMock).toHaveBeenCalledOnce();
    expect(earliestMock).toHaveBeenCalledWith(["aff7", "c120"], "opencode::*");
    expect(result.rotationPending).toMatchObject({ fromPoolId: "aff7", toPoolId: null });
    expect(result.response.headers.get("x-vansroute-rotation")).toBeNull();
    expect(Number(result.response.headers.get("retry-after"))).toBeGreaterThan(80_000);
  });

  it("advertises the real bench expiry for a static pool with no eligible list", async () => {
    earliestMock.mockReturnValueOnce(Date.now() + 24 * 60 * 60 * 1000);
    executeMock.mockImplementationOnce(async () => {
      const error = new Error("free usage limit");
      error.poolScoped = { reason: "ip-limit", deferRotation: true };
      throw error;
    });

    const result = await handleChatCore({
      body: {
        model: "oc/deepseek-v4.1-flash-free",
        stream: false,
        messages: [{ role: "user", content: "hi" }],
      },
      modelInfo: { provider: "opencode", model: "deepseek-v4.1-flash-free" },
      credentials: {
        apiKey: "public",
        providerSpecificData: {
          connectionProxyEnabled: true,
          connectionProxyUrl: "http://pool",
          proxyRotationStrategy: "none",
          proxyPoolIds: [],
          proxyPoolId: "aff7",
        },
      },
      connectionId: "proxy:aff7",
      resolveProxyConfig: vi.fn(async () => null),
      log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn() },
    });

    expect(earliestMock).toHaveBeenCalledWith(["aff7"], "opencode::*");
    expect(Number(result.response.headers.get("retry-after"))).toBeGreaterThan(80_000);
  });
});
