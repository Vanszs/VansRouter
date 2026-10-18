export default {
  id: "opencode",
  priority: 40,
  hasFree: true,
  alias: "oc",
  uiAlias: "oc",
  display: {
    name: "OpenCode Free",
    icon: "terminal",
    color: "#E87040",
    textIcon: "OC",
  },
  category: "free",
  noAuth: true,
  transport: {
    baseUrl: "https://opencode.ai",
    headers: {
      "x-opencode-client": "desktop",
    },
    noAuth: true,
    // The free tier always answers in SSE; let chatCore aggregate it.
    forceStream: true,
    quirks: {
      // /responses answers 400 unless tool_choice is "auto" (measured on
      // muse-spark-1.2-contributor-free: none, required, and a named choice all fail).
      forceAutoToolChoiceModels: ["muse-spark-1.2-contributor-free"],
    },
  },
  models: [
    // Endpoint formats differ per model, so declare non-chat models explicitly.
    // The catalogue still serves muse-spark-1.2-contributor-free on /responses
    // only. muse-spark-1.3-contributor-free answers 410 ModelDeprecated and
    // union-alpha answers "Model is unavailable" on every lane, so neither is
    // seeded. A passthrough id still routes: the family regex sends muse-spark
    // to /responses and everything else to /chat/completions.
    { id: "space-bunny-free", name: "Space Bunny Free" },
    { id: "muse-spark-1.2-contributor-free", name: "Muse Spark 1.2 Contributor Free", targetFormat: "openai-responses" },
  ],
  modelsFetcher: { url: "https://opencode.ai/zen/v1/models", type: "opencode-free" },
  passthroughModels: true,
};
