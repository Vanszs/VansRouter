export default {
  id: "exa",
  alias: "exa",
  display: {
    name: "Exa",
    icon: "manage_search",
    color: "#2563EB",
    textIcon: "EX",
    website: "https://exa.ai",
    notice: {
      apiKeyUrl: "https://dashboard.exa.ai/api-keys"
    }
  },
  category: "apikey",
  authType: "apikey",
  serviceKinds: [
    "webSearch",
    "webFetch"
  ],
  searchConfig: {
    baseUrl: "https://api.exa.ai/search",
    method: "POST",
    authType: "apikey",
    authHeader: "bearer",
    costPerQuery: 0.007,
    searchTypes: [
      "web",
      "news"
    ],
    exaSearchTypes: ["instant", "fast", "auto", "deep-lite", "deep", "deep-reasoning"],
    defaultMaxResults: 5,
    maxMaxResults: 100,
    timeoutMs: 10000
  },
  fetchConfig: {
    baseUrl: "https://api.exa.ai/contents",
    method: "POST",
    authType: "apikey",
    authHeader: "x-api-key",
    costPerQuery: 0.001,
    formats: [
      "text",
      "markdown"
    ],
    maxCharacters: 100000,
    timeoutMs: 15000
  }
};
