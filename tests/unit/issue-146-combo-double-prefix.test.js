// Issue #146: a combo member built from a registry id that already carries its
// org prefix (`nvidia/nvidia/nemotron-…`) 404'd, because the connected-provider
// allowlist advertises the single-prefix form and both lookups assumed a single
// canonical string. Two independent sites had to agree; neither did.
// See PR #145.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { getModelUpstreamId } from "open-sse/config/providerModels.js";

const mocks = vi.hoisted(() => ({
  extractApiKey: vi.fn(() => "sk-test"),
  isValidApiKey: vi.fn(() => Promise.resolve({ id: "k1" })),
  isProviderAllowed: vi.fn(() => Promise.resolve(true)),
  isComboAllowed: vi.fn(() => Promise.resolve(true)),
  isKindAllowed: vi.fn(() => Promise.resolve(true)),
  isTrustedInternalRequest: vi.fn(() => false),
  getProviderCredentials: vi.fn(() => Promise.resolve({})),
  isModelAllowed: vi.fn(),
  getSettings: vi.fn(() => Promise.resolve({ requireApiKey: true })),
  getModelInfo: vi.fn(),
  getComboModels: vi.fn(() => Promise.resolve(null)),
  handleChatCore: vi.fn(() => Promise.resolve({ success: true, response: new Response("ok") })),
  handleBypassRequest: vi.fn(() => null),
  cacheClaudeHeaders: vi.fn(),
  detectFormatByEndpoint: vi.fn(() => null),
  unavailableResponse: vi.fn((s, m) => new Response(m, { status: s })),
}));

vi.mock("@/sse/services/auth.js", () => ({
  extractApiKey: mocks.extractApiKey,
  isValidApiKey: mocks.isValidApiKey,
  isProviderAllowed: mocks.isProviderAllowed,
  isComboAllowed: mocks.isComboAllowed,
  isKindAllowed: mocks.isKindAllowed,
  isTrustedInternalRequest: mocks.isTrustedInternalRequest,
  getProviderCredentials: mocks.getProviderCredentials,
  updateProviderCredentials: vi.fn(),
  checkAndRefreshToken: vi.fn((p, c) => Promise.resolve(c)),
  getProjectIdForConnection: vi.fn(),
  markAccountUnavailable: vi.fn(),
  clearAccountError: vi.fn(),
}));

vi.mock("@/sse/services/allowedModels.js", () => ({ isModelAllowed: mocks.isModelAllowed }));
vi.mock("@/sse/services/localDb.js", () => ({ getSettings: mocks.getSettings }));
vi.mock("@/sse/services/model.js", () => ({
  getModelInfo: mocks.getModelInfo,
  getComboModels: mocks.getComboModels,
}));
vi.mock("@/sse/services/bypass.js", () => ({ handleBypassRequest: mocks.handleBypassRequest }));
vi.mock("@/sse/services/claudeHeaderCache.js", () => ({ cacheClaudeHeaders: mocks.cacheClaudeHeaders }));
vi.mock("@/sse/utils/detectFormat.js", () => ({ detectFormatByEndpoint: mocks.detectFormatByEndpoint }));
vi.mock("@/sse/utils/unavailableResponse.js", () => ({ unavailableResponse: mocks.unavailableResponse }));
vi.mock("open-sse/handlers/chatCore.js", () => ({ handleChatCore: mocks.handleChatCore }));

// The real allowlist shape: buildConnectedProviderIds strips one alias prefix, so
// only the single-prefix form is ever advertised by /v1/models.
const ALLOWED = new Set([
  "nvidia/nemotron-3-ultra-550b-a55b",
  "nvidia/nemotron-3-super-120b-a12b",
]);

const modelInfo = (provider, model) => ({ provider, model, isAlias: false, providerAlias: provider });

const request = (body) => new Request("http://127.0.0.1:20128/v1/chat/completions", {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: "Bearer sk-test" },
  body: JSON.stringify(body),
});

describe("issue #146 — combo member with a self-prefixed registry id", () => {
  let handleChat;

  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.isModelAllowed.mockImplementation(async (id) => ALLOWED.has(id));
    mocks.handleChatCore.mockImplementation(() => Promise.resolve({ success: true, response: new Response("ok") }));
    vi.resetModules();
    ({ handleChat } = await import("@/sse/handlers/chat.js"));
  });

  it("accepts the double-prefixed combo member the picker produces", async () => {
    mocks.getModelInfo.mockReturnValue(modelInfo("nvidia", "nvidia/nemotron-3-ultra-550b-a55b"));

    const res = await handleChat(request({ model: "nvidia/nvidia/nemotron-3-ultra-550b-a55b", messages: [] }));

    expect(res.status).not.toBe(404);
    expect(mocks.handleChatCore).toHaveBeenCalled();
  });

  it("still accepts the single-prefixed form", async () => {
    mocks.getModelInfo.mockReturnValue(modelInfo("nvidia", "nemotron-3-ultra-550b-a55b"));

    const res = await handleChat(request({ model: "nvidia/nemotron-3-ultra-550b-a55b", messages: [] }));

    expect(res.status).not.toBe(404);
    expect(mocks.handleChatCore).toHaveBeenCalled();
  });

  it("still 404s a model that is in no provider's registry", async () => {
    mocks.getModelInfo.mockReturnValue(modelInfo("nvidia", "nvidia/not-a-real-model"));

    const res = await handleChat(request({ model: "nvidia/nvidia/not-a-real-model", messages: [] }));

    expect(res.status).toBe(404);
    expect(mocks.handleChatCore).not.toHaveBeenCalled();
  });
});

describe("issue #146 — org-prefixed registry id sent to upstream", () => {
  // Bug 2: the allowlist form (`nvidia/nemotron-…`) is not the registry form
  // (`nvidia/nemotron-…` under a provider whose entries are self-prefixed), so
  // parseModel's bare `model` missed findModel and the bare id went upstream.
  it.each([
    ["nvidia", "nemotron-3-ultra-550b-a55b"],
    ["nvidia", "nemotron-3-super-120b-a12b"],
    ["poolside", "laguna-s-2.1"],
    // fal-ai ids keep their own path segments, so parseModel leaves them intact
    // after the first slash; the retry has to survive that too.
    ["fal-ai", "flux/schnell"],
    ["fal-ai", "recraft-v3"],
  ])("resolves the bare id for %s against the self-prefixed registry", (provider, bare) => {
    const upstream = getModelUpstreamId(provider, bare);
    expect(upstream).not.toBe(bare);
    expect(upstream.startsWith(`${provider}/`)).toBe(true);
  });

  it("still passes through a model that does not exist", () => {
    expect(getModelUpstreamId("nvidia", "nvidia/not-a-real-model")).toBe("nvidia/not-a-real-model");
  });

  it("leaves the Kiro dash/dot tolerance path alone", () => {
    // kr maps to a provider whose entries are NOT self-prefixed, so the retry
    // must not shadow the existing dot-version normalisation.
    expect(getModelUpstreamId("kr", "claude-sonnet-4-5")).toBe("claude-sonnet-4.5");
  });
});
