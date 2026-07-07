export default {
  id: "autoclaw",
  alias: "ac",
  uiAlias: "ac",
  display: {
    name: "AutoClaw",
    icon: "smart_toy",
    color: "#10A37F",
    website: "https://autoclaw.z.ai",
    notice: null,
  },
  category: "free",
  authModes: ["access_token"],
  hasOAuth: false,
  transport: {
    baseUrl: "https://autoglm-api.autoglm.ai/autoclaw-proxy/proxy/autoclaw/chat/completions",
    format: "openai",
    forceStream: true,
    headers: {
      "content-type": "application/json",
      "origin": "https://autoclaw.z.ai",
      "referer": "https://autoclaw.z.ai/",
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36",
      "x-product": "autoclaw",
      "x-version": "1.10.0",
      "x-tm": "web",
      "x-channel": "official",
      "x-client-type": "web",
      "x-lang": "zh-CN",
    },
    auth: { header: "X-Authorization", scheme: "bearer", combined: true },
  },
  models: [
    {
      id: "glm-5.2",
      name: "GLM-5.2",
      alias: "glm52",
      upstreamModelId: "openrouter_glm-5.2",
    },
    {
      id: "glm-5-turbo",
      name: "GLM-5 Turbo",
      alias: "glm5t",
      upstreamModelId: "zai_glm-5-turbo",
    },
  ],
  features: { usage: true },
};
