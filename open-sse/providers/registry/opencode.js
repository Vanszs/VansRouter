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
      "x-opencode-client": "cli",
    },
    noAuth: true,
    // The free tier always answers in SSE; let chatCore aggregate it.
    forceStream: true,
    reasoningInject: { scope: "all" },
  },
  serviceKinds: ["llm", "systemone"],
  systemoneConfig: {
    baseUrl: "https://opencode.ai/zen/v1/systemone",
    headers: {
      "x-opencode-client": "cli",
      "User-Agent": "opencode/latest/2.0.29/cli",
    },
  },
  models: [
    { id: "beam-free", name: "Beam Free" },
    // A decision model, not a chat model: it is served through the
    // SystemOne endpoint with a state/questions payload.
    { id: "jev-1.13-free", name: "Jev 1.13 Free", kind: "systemone" },
    { id: "mimo-v2.6-flash-free", name: "MiMo V2.6 Flash Free" },
    { id: "nemotron-3.5-super-vl-free", name: "Nemotron 3.5 Super VL Free" },

    { id: "deepseek-v4.1-flash-free", name: "DeepSeek V4.1 Flash Free" },
    { id: "glm-5.3-flash-free", name: "GLM 5.3 Flash Free" },
    { id: "nemotron-3.5-lightning-free", name: "Nemotron 3.5 Lightning Free" },
    { id: "minimax-m3.1-flash-free", name: "MiniMax M3.1 Flash Free" },
  ],
  modelsFetcher: { url: "https://opencode.ai/zen/v1/models", type: "opencode-free" },
  liveCatalog: true,
  passthroughModels: true,
};
