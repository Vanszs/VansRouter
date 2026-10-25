export default {
  id: "tavily",
  alias: "tavily",
  display: {
    name: "Tavily",
    icon: "search",
    color: "#5B21B6",
    textIcon: "TV",
    website: "https://tavily.com",
    notice: {
      apiKeyUrl: "https://app.tavily.com/home"
    }
  },
  category: "apikey",
  authType: "apikey",
  serviceKinds: [
    "webSearch",
    "webFetch"
  ],
  searchConfig: {
    baseUrl: "https://api.tavily.com/search",
    method: "POST",
    authType: "apikey",
    authHeader: "bearer",
    costPerQuery: 0.008,
    searchTypes: [
      "web",
      "news"
    ],
    defaultMaxResults: 5,
    maxMaxResults: 20,
    timeoutMs: 10000
  },
  fetchConfig: {
    baseUrl: "https://api.tavily.com/extract",
    method: "POST",
    authType: "apikey",
    authHeader: "bearer",
    costPerQuery: 0.008,
    formats: [
      "markdown",
      "text"
    ],
    maxCharacters: 100000,
    timeoutMs: 15000
  }
};
