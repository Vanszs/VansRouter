export default {
  id: "cline",
  priority: 80,
  alias: "cl",
  uiAlias: "cl",
  display: {
    name: "Cline",
    icon: "smart_toy",
    color: "#5B9BD5",
    textIcon: "CL",
    website: "https://cline.bot",
    notice: {
      signupUrl: "https://cline.bot",
    },
  },
  category: "oauth",
  hasFree: true,
  transport: {
    baseUrl: "https://api.cline.bot/api/v1/chat/completions",
    headers: {
      "HTTP-Referer": "https://cline.bot",
      "X-Title": "Cline",
    },
    quirks: { clineEnvelope: true },
    tokenUrl: "https://api.cline.bot/api/v1/auth/token",
    refreshUrl: "https://api.cline.bot/api/v1/auth/refresh",
    auth: {
      combined: true,
      header: "Authorization",
      scheme: "bearer",
      hooks: [
        "clineHeaders",
      ],
    },
  },
  models: [
    { id: "anthropic/claude-opus-4.7", name: "Claude Opus 4.7" },
    { id: "anthropic/claude-sonnet-4.6", name: "Claude Sonnet 4.6" },
    { id: "anthropic/claude-opus-4.6", name: "Claude Opus 4.6" },
    { id: "openai/gpt-5.3-codex", name: "GPT-5.3 Codex" },
    { id: "openai/gpt-5.4", name: "GPT-5.4" },
    { id: "google/gemini-3.1-pro-preview", name: "Gemini 3.1 Pro Preview" },
    { id: "google/gemini-3.1-flash-lite-preview", name: "Gemini 3.1 Flash Lite Preview" },
    { id: "kwaipilot/kat-coder-pro", name: "KAT Coder Pro" },
  ],
  // The Cline catalogue (462 models at time of writing) answers this endpoint
  // without any credentials, so the fetcher needs no token. Ids are owner/model
  // and the 8 static entries above stay as the fallback.
  modelsFetcher: { url: "https://api.cline.bot/api/v1/models", type: "openai" },
  // Opt in to feeding the chat allowlist from the live catalogue, so a catalogue
  // id is accepted by the chat gate (issue #159).
  // Deliberately NOT passthroughModels: the picker branches on that flag BEFORE
  // it reads the live catalogue, so setting it would hide the fetched models and
  // show only the static list — the opposite of the intent.
  liveCatalog: true,
  oauth: {
    appBaseUrl: "https://app.cline.bot",
    apiBaseUrl: "https://api.cline.bot",
    authorizeUrl: "https://api.cline.bot/api/v1/auth/authorize",
    tokenExchangeUrl: "https://api.cline.bot/api/v1/auth/token",
    refreshUrl: "https://api.cline.bot/api/v1/auth/refresh",
  },
};
