import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getProviderConnectionById: vi.fn(),
  updateProviderConnection: vi.fn(),
  resolveConnectionProxyConfig: vi.fn(),
  testProxyUrl: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  getProviderConnectionById: mocks.getProviderConnectionById,
  updateProviderConnection: mocks.updateProviderConnection,
}));

vi.mock("@/lib/network/connectionProxy", () => ({
  resolveConnectionProxyConfig: mocks.resolveConnectionProxyConfig,
}));

vi.mock("@/lib/network/proxyTest", () => ({
  testProxyUrl: mocks.testProxyUrl,
}));

const originalFetch = global.fetch;
const { testSingleConnection } = await import("../../src/app/api/providers/[id]/test/testUtils.js");

const makeResponse = (status, body = {}) => new Response(JSON.stringify(body), {
  status,
  headers: { "Content-Type": "application/json" },
});

describe("CodeBuddy manually added access token connection test", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
    mocks.resolveConnectionProxyConfig.mockResolvedValue({});
    mocks.testProxyUrl.mockResolvedValue({ ok: true });
    mocks.updateProviderConnection.mockResolvedValue(undefined);
    mocks.getProviderConnectionById.mockResolvedValue({
      id: "cb-intl",
      provider: "codebuddy-intl",
      authType: "apikey",
      apiKey: "pasted-access-token",
      providerSpecificData: {},
    });
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  it("probes the billing endpoint so a working pasted token is accepted", async () => {
    global.fetch.mockResolvedValue(makeResponse(200, { code: 0, data: {} }));

    const result = await testSingleConnection("cb-intl");

    expect(result.valid).toBe(true);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, options] = global.fetch.mock.calls[0];
    expect(url).toBe("https://www.codebuddy.ai/v2/billing/meter/get-user-resource");
    expect(options).toMatchObject({
      method: "POST",
      body: "{}",
      headers: expect.objectContaining({
        Authorization: "Bearer pasted-access-token",
        "X-Product": "SaaS",
      }),
    });
    expect(mocks.updateProviderConnection).toHaveBeenCalledWith(
      "cb-intl",
      expect.objectContaining({ testStatus: "active", lastError: null }),
    );
  });

  it("rejects a revoked token instead of reporting 'not supported'", async () => {
    global.fetch.mockResolvedValue(makeResponse(401));

    const result = await testSingleConnection("cb-intl");

    expect(result.valid).toBe(false);
    expect(result.error).toBe("CodeBuddy access token invalid or expired");
    expect(result.error).not.toContain("not supported");
    expect(mocks.updateProviderConnection).toHaveBeenCalledWith(
      "cb-intl",
      expect.objectContaining({ testStatus: "error" }),
    );
  });

  it("uses the CN billing endpoint for a codebuddy-cn manual token", async () => {
    mocks.getProviderConnectionById.mockResolvedValue({
      id: "cb-cn",
      provider: "codebuddy-cn",
      authType: "apikey",
      apiKey: "cn-token",
      providerSpecificData: {},
    });
    global.fetch.mockResolvedValue(makeResponse(200, { code: 0 }));

    const result = await testSingleConnection("cb-cn");

    expect(result.valid).toBe(true);
    expect(global.fetch.mock.calls[0][0]).toBe(
      "https://copilot.tencent.com/v2/billing/meter/get-user-resource",
    );
  });
});
