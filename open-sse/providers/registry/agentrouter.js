// AgentRouter — multi-model routing gateway.
// Config aligned with OmniRoute: Claude format, x-api-key auth.
// Passthrough provider: accepts any model ID, no fixed model list.
// Free tier: $200 credits on signup, no credit card required.
export default {
  id: "agentrouter",
  alias: "agentrouter",
  uiAlias: "agentrouter",
  display: {
    name: "AgentRouter",
    icon: "router",
    color: "10B981",
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
    timeoutMs: 30000,
    headers: {
      "anthropic-version": "2023-06-01",
      "anthropic-beta": "interleaved-thinking-2025-05-14",
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
    { id: "claude-haiku-4-5-20251001", name: "Claude 4.5 Haiku" },
    { id: "glm-5.1", name: "GLM 5.1" },
    { id: "deepseek-v3.2", name: "DeepSeek V3.2" },
  ],
  passthroughModels: true,
};
