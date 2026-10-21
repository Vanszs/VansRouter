import { PROVIDERS } from "open-sse/config/providers.js";
import { CODEX_CLI_VERSION } from "open-sse/config/appConstants.js";
import { GROK_CLI_PAGER_USER_AGENT, GROK_CLI_VERSION } from "open-sse/config/grokCli.js";
import { NOUS_CHAT_COMPLETIONS_URL, NOUS_VALIDATION_MODEL } from "open-sse/services/nous.js";
import { KILOCODE_CONFIG, KIMCHI_CONFIG } from "@/lib/oauth/constants/oauth";

// Per-provider test endpoints: which URL to probe, which auth header to
// use, and which response codes still count as a live connection.
// Pure data — the probing itself lives in testUtils.js.

// OAuth provider test endpoints
export const OAUTH_TEST_CONFIG = {
  claude: { checkExpiry: true, refreshable: true },
  codex: {
    url: "https://chatgpt.com/backend-api/codex/responses",
    method: "POST",
    authHeader: "Authorization",
    authPrefix: "Bearer ",
    extraHeaders: { "Content-Type": "application/json", "originator": "codex_cli_rs", "User-Agent": `codex_cli_rs/${CODEX_CLI_VERSION}` },
    // Minimal invalid body — triggers fast 400 without consuming quota
    body: JSON.stringify({ model: "gpt-5.3-codex", input: [], stream: false, store: false }),
    // 400 (bad request) means auth succeeded; only 401/403 means token is bad
    acceptStatuses: [400],
    refreshable: true,
  },
  "gemini-cli": {
    url: "https://www.googleapis.com/oauth2/v1/userinfo?alt=json",
    method: "GET",
    authHeader: "Authorization",
    authPrefix: "Bearer ",
    refreshable: true,
  },
  antigravity: {
    url: "https://www.googleapis.com/oauth2/v1/userinfo?alt=json",
    method: "GET",
    authHeader: "Authorization",
    authPrefix: "Bearer ",
    refreshable: true,
  },
  github: {
    url: "https://api.github.com/user",
    method: "GET",
    authHeader: "Authorization",
    authPrefix: "Bearer ",
    extraHeaders: { "User-Agent": "9Router", "Accept": "application/vnd.github+json" },
  },
  iflow: {
    // iFlow getUserInfo requires accessToken as query param, not header
    buildUrl: (token) => `https://iflow.cn/api/oauth/getUserInfo?accessToken=${encodeURIComponent(token)}`,
    method: "GET",
    noAuth: true,
  },
  kiro: { checkExpiry: true, refreshable: true },
  qoder: {
    // Test by hitting Qoder's userinfo endpoint with the device token.
    // refreshable: false because the device-flow refresh endpoint returns
    // 403 for our flow (users re-login when expired). No checkExpiry —
    // we want the actual URL probe to run so revoked tokens surface.
    url: "https://openapi.qoder.sh/api/v1/userinfo",
    method: "GET",
    authHeader: "Authorization",
    authPrefix: "Bearer ",
    refreshable: false,
  },
  "qoder-cn": {
    // Same shape as intl qoder, CN host.
    url: "https://openapi.qoder.com.cn/api/v1/userinfo",
    method: "GET",
    authHeader: "Authorization",
    authPrefix: "Bearer ",
    refreshable: false,
  },
  kimi: { checkExpiry: true, refreshable: true },
  "kimi-coding": { checkExpiry: true, refreshable: true },
  cursor: { tokenExists: true },
  kilocode: {
    url: `${KILOCODE_CONFIG.apiBaseUrl}/api/profile`,
    method: "GET",
    authHeader: "Authorization",
    authPrefix: "Bearer ",
  },
  cline: { refreshable: true },
  gitlab: {
    // Test by hitting the GitLab user API — requires api or read_user scope
    url: "https://gitlab.com/api/v4/user",
    method: "GET",
    authHeader: "Authorization",
    authPrefix: "Bearer ",
  },
  "codebuddy-cn": { tokenExists: true },
  // codebuddy-intl uses the same JWT token structure as codebuddy-cn
  // (access + refresh token pair, ~1-year expiry) — same test strategy (#4232).
  "codebuddy-intl": { tokenExists: true },
  kimchi: {
    url: KIMCHI_CONFIG.validationUrl || "https://api.cast.ai/v1/llm/openai/supported-providers",
    method: "GET",
    authHeader: "Authorization",
    authPrefix: "Bearer ",
    extraHeaders: {
      Accept: "application/json",
      "User-Agent": "kimchi/0.1.40",
    },
    refreshable: false,
  },
  // Grok CLI / Grok Build — probe /v1/user (no inference quota). Headers mirror official CLI.
  "grok-cli": {
    url: PROVIDERS["grok-cli"]?.userUrl || "https://cli-chat-proxy.grok.com/v1/user",
    method: "GET",
    authHeader: "Authorization",
    authPrefix: "Bearer ",
    extraHeaders: {
      Accept: "application/json",
      ...(PROVIDERS["grok-cli"]?.headers || {
        "User-Agent": GROK_CLI_PAGER_USER_AGENT,
        "x-xai-token-auth": "xai-grok-cli",
        "x-grok-client-identifier": "grok-pager",
        "x-grok-client-version": GROK_CLI_VERSION,
      }),
    },
    refreshable: true,
    // Subscription spending-limit is not an auth failure — token is fine, credits aren't.
    // Accept 402 so the connection stays "active" with a warning (same idea as Codex 400).
    acceptStatuses: [402],
    softFailMessage: {
      402: "Connected, but Grok Build credits are exhausted (spending limit). Add credits or upgrade SuperGrok.",
    },
  },
  // Muse Code subscription — probe /v1/models with the minted LLM|… key
  "muse": {
    url: "https://api.meta.ai/v1/models",
    method: "GET",
    authHeader: "Authorization",
    authPrefix: "Bearer ",
    extraHeaders: { "x-api-version": "1.0.0" },
    refreshable: false,
  },
  nous: {
    url: NOUS_CHAT_COMPLETIONS_URL,
    method: "POST",
    authHeader: "Authorization",
    authPrefix: "Bearer ",
    extraHeaders: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: NOUS_VALIDATION_MODEL,
      messages: [{ role: "user", content: "ping" }],
      max_tokens: 1,
      stream: false,
    }),
    refreshable: true,
    useApiKey: true,
  },
};
