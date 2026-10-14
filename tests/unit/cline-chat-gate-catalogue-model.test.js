// Regression (issue #159): the dashboard lists the live Cline catalogue, but a
// CHAT request for a catalogue-only id is still rejected. With an active cline
// OAuth connection, buildConnectedProviderIds() only merges fetcher ids when
// AI_PROVIDERS[providerId].noAuth is true (cline is OAuth, so it is not) and then
// overwrites rawModelIds with the static list because passthroughModels is set.
// Result: catalogue ids never reach the allowlist that isModelAllowed() consults.
// Static ids must keep working, so both assertions are required.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getProviderConnections: vi.fn(),
  getCombos: vi.fn(),
  getCustomModels: vi.fn(),
  getModelAliases: vi.fn(),
  getCachedProviderModels: vi.fn(),
  saveCachedProviderModels: vi.fn(),
  getDisabledModels: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  getProviderConnections: mocks.getProviderConnections,
  getCombos: mocks.getCombos,
  getCustomModels: mocks.getCustomModels,
  getModelAliases: mocks.getModelAliases,
  getCachedProviderModels: mocks.getCachedProviderModels,
  saveCachedProviderModels: mocks.saveCachedProviderModels,
}));

vi.mock("@/lib/disabledModelsDb", () => ({
  getDisabledModels: mocks.getDisabledModels,
}));

// proxyFetch.js patches globalThis.fetch at import time and would capture the
// real fetch before vi.stubGlobal runs. Same guard the sibling suites use.
vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  default: (url, options) => globalThis.fetch(url, options),
  proxyAwareFetch: (url, options) => globalThis.fetch(url, options),
  resolveAntigravityProxyConfig: vi.fn(),
}));

// Mirrors the live response shape: { object: "list", data: [{ id, object, ... }] }
const catalogueFixture = {
  object: "list",
  data: [
    { id: "meituan/longcat-2.0", object: "model", created: 1791933050, owned_by: "meituan" },
    { id: "z-ai/glm-5.3-flash", object: "model", created: 1791930537, owned_by: "z-ai" },
  ],
};

let originalFetch;

beforeEach(() => {
  originalFetch = globalThis.fetch;
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok: true,
    json: async () => catalogueFixture,
  }));
  mocks.getProviderConnections.mockResolvedValue([
    { id: "conn-cline", provider: "cline", accessToken: "cline-oauth-token", isActive: true },
  ]);
  mocks.getCombos.mockResolvedValue([]);
  mocks.getCustomModels.mockResolvedValue([]);
  mocks.getModelAliases.mockResolvedValue({});
  mocks.getCachedProviderModels.mockResolvedValue([]);
  mocks.saveCachedProviderModels.mockResolvedValue(undefined);
  mocks.getDisabledModels.mockResolvedValue({});
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.unstubAllGlobals();
  vi.resetModules();
}); 

describe("chat-side allowlist for a connected cline provider", () => {
  const loadAllowedModels = async () => {
    vi.resetModules();
    const mod = await import("../../src/sse/services/allowedModels.js");
    mod.invalidateAllowedModelsCache();
    return mod;
  };

  it("allows a catalogue-only cline model even though the connection is OAuth", async () => {
    const { isModelAllowed } = await loadAllowedModels();

    await expect(
      isModelAllowed("cl/meituan/longcat-2.0", { allowedProviders: null }),
    ).resolves.toBe(true);
  });

  it("keeps allowing the static cline models", async () => {
    const { isModelAllowed } = await loadAllowedModels();

    await expect(
      isModelAllowed("cl/anthropic/claude-sonnet-4.6", { allowedProviders: null }),
    ).resolves.toBe(true);
  });
});
