// AgentRouter — multi-model routing gateway.
// Config aligned 100% with OmniRoute: Claude format, x-api-key auth,
// full Claude CLI header spoofing (required by AgentRouter for auth).
// Passthrough provider: accepts any model ID, no fixed model list.
// Free tier: $200 credits on signup, no credit card required.

// Claude CLI header constants (must match OmniRoute's anthropicHeaders.ts)
const CLAUDE_CLI_VERSION = "2.1.187";
const CLAUDE_CLI_USER_AGENT = `claude-cli/${CLAUDE_CLI_VERSION} (external, cli)`;
const ANTHROPIC_BETA = [
  "claude-code-20250219",
  "oauth-2025-04-20",
  "interleaved-thinking-2025-05-14",
  "fine-grained-tool-streaming-2025-05-14",
  "context-management-2025-06-27",
  "prompt-caching-scope-2026-01-05",
  "advanced-tool-use-2025-11-20",
  "effort-2025-11-24",
  "structured-outputs-2025-12-15",
  "fast-mode-2026-02-01",
  "redact-thinking-2026-02-12",
  "token-efficient-tools-2026-03-28",
  "advisor-tool-2026-03-01",
  "extended-cache-ttl-2025-04-11",
  "cache-diagnosis-2026-04-07",
].join(",");

function mapStainlessOs() {
  const p = process.platform;
  if (p === "win32") return "Windows";
  if (p === "darwin") return "MacOS";
  return "Linux";
}

function mapStainlessArch() {
  const a = process.arch;
  if (a === "arm64") return "arm64";
  if (a === "ia32") return "x86";
  return "x64";
}

export default {
  id: "agentrouter",
  alias: "agentrouter",
  uiAlias: "agentrouter",
  display: {
    name: "AgentRouter",
    icon: "router",
    color: "#10B981",
    textIcon: "AR",
    website: "https://agentrouter.org",
    notice: {
      apiHint: "Get $200 free credits at https://agentrouter.org/register — no credit card required.",
      text: "Get $200 free credits at https://agentrouter.org/register — no credit card required.",
      apiKeyUrl: "https://agentrouter.org/register",
    },
  },
  category: "freeTier",
  authType: "apikey",
  hasOAuth: false,
  authModes: ["apikey"],
  serviceKinds: ["llm"],
  transport: {
    baseUrl: "https://agentrouter.org/v1/messages",
    format: "claude",
    timeoutMs: 600000,
    headers: {
      "Anthropic-Version": "2023-06-01",
      "Anthropic-Beta": ANTHROPIC_BETA,
      "Anthropic-Dangerous-Direct-Browser-Access": "true",
      "User-Agent": CLAUDE_CLI_USER_AGENT,
      "X-App": "cli",
      "X-Stainless-Helper-Method": "stream",
      "X-Stainless-Retry-Count": "0",
      "X-Stainless-Package-Version": "0.94.0",
      "X-Stainless-Runtime": "node",
      "X-Stainless-Runtime-Version": "v24.3.0",
      "X-Stainless-Lang": "js",
      "X-Stainless-Arch": mapStainlessArch(),
      "X-Stainless-Os": mapStainlessOs(),
      "X-Stainless-Timeout": "600",
    },
    auth: {
      apiKey: {
        header: "x-api-key",
        scheme: "raw",
      },
    },
    forceStream: false,
    preserveAccept: true,
    retry: {
      429: { attempts: 3, delayMs: 500 },
      502: { attempts: 3, delayMs: 500 },
      503: { attempts: 3, delayMs: 1000 },
    },
  },
  models: [
    { id: "claude-opus-4-6", name: "Claude 4.6 Opus" },
    { id: "claude-opus-4-7", name: "Claude 4.7 Opus" },
    { id: "claude-opus-4-8", name: "Claude 4.8 Opus" },
    { id: "glm-5.2", name: "GLM 5.2" },
    { id: "gpt-5.5", name: "GPT 5.5" },
  ],
  passthroughModels: true,
};
