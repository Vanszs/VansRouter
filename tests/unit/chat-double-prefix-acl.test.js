// Verify chat.js ACL accepts the double-prefix model form ("nvidia/nvidia/model")
// when the allowlist only contains the stripped form ("nvidia/model").
// Same normalization embeddings.js already does (see CUSTOM_LOGIC.md §10).
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  extractApiKey: vi.fn((req) => {
    const auth = req?.headers?.get?.("Authorization");
    if (auth?.startsWith("Bearer ")) return auth.slice(7);
    return req?.headers?.get?.("x-api-key") || null;
  }),
  isValidApiKey: vi.fn(() => true),
  isProviderAllowed: vi.fn(() => true),
  isComboAllowed: vi.fn(() => true),
  isKindAllowed: vi.fn(() => true),
  isTrustedInternalRequest: vi.fn(() => false),
  getProviderCredentials: vi.fn(),
  markAccountUnavailable: vi.fn(),
  clearAccountError: vi.fn(),
  isModelAllowed: vi.fn(() => true),
  getSettings: vi.fn(() => Promise.resolve({ requireApiKey: true })),
  getModelInfo: vi.fn((model) => Promise.resolve({ provider: "openai", model })),
  getComboModels: vi.fn(() => Promise.resolve(null)),
  handleChatCore: vi.fn(() => Promise.resolve({ success: true, response: new Response("ok") })),
  handleBypassRequest: vi.fn(() => null),
  handleComboChat: vi.fn(() => new Response("combo-ok")),
  handleFusionChat: vi.fn(() => new Response("fusion-ok")),
  updateProviderCredentials: vi.fn(),
  checkAndRefreshToken: vi.fn((_p, c) => Promise.resolve(c)),
  getProjectIdForConnection: vi.fn(),
  logRequest: vi.fn(),
  logInfo: vi.fn(),
  logWarn: vi.fn(),
  logDebug: vi.fn(),
  cacheClaudeHeaders: vi.fn(),
  detectFormatByEndpoint: vi.fn(() => null),
  isProviderFullyBlocked: vi.fn(() => false),
  getProviderShortestCooldownMs: vi.fn(() => 0),
  recordProviderFailure: vi.fn(),
  clearProviderFailure: vi.fn(),
  clearProviderFailureDedup: vi.fn(),
}));

vi.mock("@/sse/services/auth.js", () => ({
  extractApiKey: mocks.extractApiKey,
  isValidApiKey: mocks.isValidApiKey,
  isProviderAllowed: mocks.isProviderAllowed,
  isComboAllowed: mocks.isComboAllowed,
  isKindAllowed: mocks.isKindAllowed,
  isTrustedInternalRequest: mocks.isTrustedInternalRequest,
  getProviderCredentials: mocks.getProviderCredentials,
  markAccountUnavailable: mocks.markAccountUnavailable,
  clearAccountError: mocks.clearAccountError,
}));
vi.mock("../../src/sse/services/auth.js", () => ({
  extractApiKey: mocks.extractApiKey,
  isValidApiKey: mocks.isValidApiKey,
  isProviderAllowed: mocks.isProviderAllowed,
  isComboAllowed: mocks.isComboAllowed,
  isKindAllowed: mocks.isKindAllowed,
  isTrustedInternalRequest: mocks.isTrustedInternalRequest,
  getProviderCredentials: mocks.getProviderCredentials,
  markAccountUnavailable: mocks.markAccountUnavailable,
  clearAccountError: mocks.clearAccountError,
}));

vi.mock("@/sse/services/allowedModels.js", () => ({ isModelAllowed: mocks.isModelAllowed }));
vi.mock("../../src/sse/services/allowedModels.js", () => ({ isModelAllowed: mocks.isModelAllowed }));

vi.mock("@/lib/localDb", () => ({
  getSettings: mocks.getSettings,
  getProviderConnections: vi.fn(() => []),
  validateApiKey: vi.fn(),
  getProviderNodeById: vi.fn(),
}));
vi.mock("../../src/lib/localDb.js", () => ({
  getSettings: mocks.getSettings,
  getProviderConnections: vi.fn(() => []),
  validateApiKey: vi.fn(),
  getProviderNodeById: vi.fn(),
}));

vi.mock("@/sse/services/model.js", () => ({
  getModelInfo: mocks.getModelInfo,
  getComboModels: mocks.getComboModels,
}));
vi.mock("../../src/sse/services/model.js", () => ({
  getModelInfo: mocks.getModelInfo,
  getComboModels: mocks.getComboModels,
}));

vi.mock("open-sse/handlers/chatCore.js", () => ({ handleChatCore: mocks.handleChatCore }));
vi.mock("open-sse/utils/bypassHandler.js", () => ({ handleBypassRequest: mocks.handleBypassRequest }));
vi.mock("open-sse/services/combo.js", () => ({
  handleComboChat: mocks.handleComboChat,
  handleFusionChat: mocks.handleFusionChat,
  stripComboPrefix: vi.fn((s) => s),
}));
vi.mock("open-sse/utils/claudeHeaderCache.js", () => ({ cacheClaudeHeaders: mocks.cacheClaudeHeaders }));
vi.mock("open-sse/translator/formats.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    detectFormatByEndpoint: mocks.detectFormatByEndpoint,
  };
});
vi.mock("open-sse/services/accountFallback.js", () => ({
  isProviderFullyBlocked: mocks.isProviderFullyBlocked,
  getProviderShortestCooldownMs: mocks.getProviderShortestCooldownMs,
  recordProviderFailure: mocks.recordProviderFailure,
  clearProviderFailure: mocks.clearProviderFailure,
  clearProviderFailureDedup: mocks.clearProviderFailureDedup,
  isProviderInCooldown: vi.fn(() => false),
  checkFallbackError: vi.fn(() => ({ shouldFallback: true, cooldownMs: 5000 })),
  formatRetryAfter: vi.fn(() => "reset after 5s"),
}));
vi.mock("open-sse/utils/circuitBreaker.js", () => ({
  resetAllCircuitBreakers: vi.fn(),
}));
vi.mock("open-sse/config/runtimeConfig.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    HTTP_STATUS: {
      BAD_REQUEST: 400,
      UNAUTHORIZED: 401,
      FORBIDDEN: 403,
      NOT_FOUND: 404,
      RATE_LIMITED: 429,
      SERVER_ERROR: 500,
      BAD_GATEWAY: 502,
      SERVICE_UNAVAILABLE: 503,
    },
  };
});
vi.mock("@/lib/headroom/detect", () => ({ DEFAULT_HEADROOM_URL: "http://localhost:9999" }));
vi.mock("@/lib/updater/updater", () => ({ checkForUpdates: vi.fn() }));
vi.mock("@/lib/oauth/providers", () => ({ getOAuthClient: vi.fn() }));

const { POST } = await import("../../src/app/api/v1/chat/completions/route.js");

const DOUBLE_MODEL = "nvidia/nvidia/nemotron-3-ultra-550b-a55b";
const STRIPPED_MODEL = "nvidia/nemotron-3-ultra-550b-a55b";

function makeRequest(model) {
  return new Request("http://localhost/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer test-key",
    },
    body: JSON.stringify({ model, messages: [{ role: "user", content: "hi" }] }),
  });
}

describe("chat double-prefix model ACL", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isValidApiKey.mockReturnValue(true);
    mocks.isProviderAllowed.mockReturnValue(true);
    mocks.isKindAllowed.mockReturnValue(true);
    mocks.isProviderFullyBlocked.mockReturnValue(false);
    mocks.getComboModels.mockResolvedValue(null);
    mocks.getProviderCredentials.mockResolvedValue({
      connectionId: "conn-1",
      connectionName: "account-1",
      providerSpecificData: { apiKey: "k" },
    });
    mocks.handleChatCore.mockResolvedValue({ success: true, response: new Response("ok") });
  });

  it("accepts provider/provider/model when the allowlist holds provider/model", async () => {
    // Combo picker stores `${alias}/${registryId}`; the registry id already
    // starts with the alias, and the connected-provider allowlist strips it once.
    mocks.getModelInfo.mockResolvedValue({ provider: "nvidia", model: STRIPPED_MODEL });
    mocks.isModelAllowed.mockImplementation((m) => m === STRIPPED_MODEL);

    const response = await POST(makeRequest(DOUBLE_MODEL));

    expect(response.status).toBe(200);
    expect(mocks.isModelAllowed).toHaveBeenCalledWith(STRIPPED_MODEL, expect.anything());
  });

  it("still returns 404 when neither model form is allowed", async () => {
    mocks.getModelInfo.mockResolvedValue({ provider: "nvidia", model: STRIPPED_MODEL });
    mocks.isModelAllowed.mockResolvedValue(false);

    const response = await POST(makeRequest(DOUBLE_MODEL));

    expect(response.status).toBe(404);
    expect(mocks.getProviderCredentials).not.toHaveBeenCalled();
  });
});
