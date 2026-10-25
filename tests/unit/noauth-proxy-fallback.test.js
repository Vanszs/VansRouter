import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getProxyPools: vi.fn(),
  getProviderConnections: vi.fn(),
  getSettings: vi.fn(),
  resolveConnectionProxyConfig: vi.fn(),
  pickProxyPoolId: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  getProxyPools: mocks.getProxyPools,
  getProviderConnections: mocks.getProviderConnections,
  getSettings: mocks.getSettings,
  validateApiKey: vi.fn(),
  updateProviderConnection: vi.fn(),
  getProviderNodeById: vi.fn(),
}));
vi.mock("@/lib/network/connectionProxy", () => ({
  resolveConnectionProxyConfig: mocks.resolveConnectionProxyConfig,
  pickProxyPoolId: mocks.pickProxyPoolId,
  getProxyHash: () => "direct",
}));
vi.mock("@/shared/constants/providers.js", () => ({
  FREE_PROVIDERS: { opencode: { id: "opencode", noAuth: true } },
  resolveProviderId: (provider) => provider,
  FREE_TIER_PROVIDERS: {},
  OAUTH_PROVIDERS: {},
  APIKEY_PROVIDERS: {},
  WEB_COOKIE_PROVIDERS: {},
  getProviderAlias: (provider) => provider,
  getProviderByAlias: () => null,
  isAnthropicCompatibleProvider: () => false,
  isOpenAICompatibleProvider: () => false,
  isCustomEmbeddingProvider: () => false,
}));

const { getProviderCredentials, markAccountUnavailable } = await import("../../src/sse/services/auth.js");

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getSettings.mockResolvedValue({
    providerStrategies: { opencode: { rotateStrategy: "round-robin" } },
  });
  mocks.getProxyPools.mockResolvedValue([
    { id: "pool-a", name: "Pool A", proxyUrl: "http://a", isActive: true },
    { id: "pool-b", name: "Pool B", proxyUrl: "http://b", isActive: true },
  ]);
  mocks.pickProxyPoolId.mockImplementation((ids) => ids[0] || null);
  mocks.resolveConnectionProxyConfig.mockImplementation(async ({ proxyPoolId }) => ({
    proxyPoolId,
    proxyPool: { id: proxyPoolId, name: proxyPoolId === "pool-a" ? "Pool A" : "Pool B" },
    connectionProxyEnabled: true,
    connectionProxyUrl: `http://${proxyPoolId}`,
  }));
});

describe("no-auth provider proxy fallback", () => {
  it("returns only the chosen pool as retryable for rotation", async () => {
    const result = await getProviderCredentials("opencode", null, "deepseek-v4.1-flash-free");
    expect(result.providerSpecificData.proxyPoolIds).toEqual(["pool-a"]);
  });

  it("does not choose an excluded proxy pool", async () => {
    mocks.pickProxyPoolId.mockImplementation((ids) => ids.at(-1) || null);
    const result = await getProviderCredentials("opencode", new Set(["proxy:pool-b"]), "deepseek-v4.1-flash-free");
    expect(mocks.pickProxyPoolId).toHaveBeenCalledWith(["pool-a"], "round-robin", "opencode", expect.anything());
    expect(result).toMatchObject({ id: "proxy:pool-a", connectionId: "proxy:pool-a" });
    expect(result.providerSpecificData.proxyPoolIds).toEqual(["pool-a"]);
  });

  it("does not fall back to direct egress after all rotated proxies fail", async () => {
    mocks.getProxyPools.mockResolvedValue([
      { id: "pool-a", proxyUrl: "http://a", isActive: true },
      { id: "pool-b", proxyUrl: "http://b", isActive: true },
    ]);
    const credentials = await getProviderCredentials(
      "opencode",
      new Set(["proxy:pool-a", "proxy:pool-b"]),
      "deepseek-v4.1-flash-free",
    );
    expect(credentials).toBeNull();
  });

  it("does not rotate away from an explicitly configured single pool", async () => {
    mocks.getSettings.mockResolvedValue({
      providerStrategies: { opencode: { proxyPoolId: "pool-a", rotateStrategy: "none" } },
    });
    const credentials = await getProviderCredentials("opencode", new Set(["proxy:pool-a"]), "deepseek-v4.1-flash-free");
    expect(credentials).toBeNull();
  });

  it("allows retry for a proxy-backed no-auth connection without database account rows", async () => {
    await expect(markAccountUnavailable("proxy:pool-a", 403, "FreeTierError", "opencode", "model"))
      .resolves.toMatchObject({ shouldFallback: true });
  });
});
