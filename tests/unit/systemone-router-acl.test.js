import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  getModelInfo: vi.fn(async () => ({ provider: "opencode", model: "jev-1.13-free" })),
  getProviderCredentials: vi.fn(async () => ({ apiKey: "k" })),
  isProviderAllowed: vi.fn(async () => false),
  checkAndRefreshToken: vi.fn(async (_p, c) => c),
  core: vi.fn(async () => ({ success: false })),
}));

vi.mock("../../src/sse/services/model.js", () => ({ getModelInfo: mocks.getModelInfo }));
vi.mock("../../src/sse/services/auth.js", () => ({
  getProviderCredentials: mocks.getProviderCredentials,
  isProviderAllowed: mocks.isProviderAllowed,
}));
vi.mock("../../src/sse/services/tokenRefresh.js", () => ({ checkAndRefreshToken: mocks.checkAndRefreshToken }));
vi.mock("../../open-sse/handlers/systemoneCore.js", () => ({ handleSystemoneCore: mocks.core }));
vi.mock("../../open-sse/services/systemoneRouter.js", () => ({
  DEFAULT_SYSTEMONE_ROUTER_MODEL: "oc/jev-1.13-free",
  DEFAULT_SYSTEMONE_TIMEOUT_MS: 1000,
  extractPromptState: () => ({ prompt: "route me" }),
  buildChoiceCriteria: () => ({ a: "x" }),
  parseSystemOneRouteAnswer: () => ({ choice: "a/b" }),
}));

const { resolveSmartChoice } = await import("../../src/sse/services/systemoneRouter.js");

describe("resolveSmartChoice ACL", () => {
  beforeEach(() => {
    mocks.isProviderAllowed.mockResolvedValue(false);
    mocks.getProviderCredentials.mockClear();
    mocks.core.mockClear();
  });

  it("refuses a router provider the API key is not allowed to use", async () => {
    const result = await resolveSmartChoice({
      body: { messages: [{ role: "user", content: "hi" }] },
      models: ["a/b", "c/d"],
      apiKeyInfo: { id: "key-1", allowedProviders: ["anthropic"] },
      log: { warn: vi.fn(), debug: vi.fn() },
    });

    expect(result).toBeNull();
    expect(mocks.getProviderCredentials).not.toHaveBeenCalled();
    expect(mocks.core).not.toHaveBeenCalled();
  });

});
