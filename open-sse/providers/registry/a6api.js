export default {
  id: "a6api",
  priority: 115,
  alias: "a6api",
  uiAlias: "a6",
  display: {
    name: "A6API",
    icon: "bolt",
    color: "#EF4444",
    textIcon: "A6",
    website: "https://a6api.com",
    notice: {
      apiKeyUrl: "https://a6api.com",
    },
  },
  category: "apikey",
  transport: {
    baseUrl: "https://a6api.com/v1/chat/completions",
    validateUrl: "https://a6api.com/v1/models",
  },
  serviceKinds: ["llm", "embedding", "image"],
  embeddingConfig: {
    baseUrl: "https://a6api.com/v1/embeddings",
    authType: "apikey",
    authHeader: "bearer",
  },
  imageConfig: {
    baseUrl: "https://a6api.com/v1/images/generations",
  },
  models: [
    // GPT
    { id: "gpt-5.6-sol", name: "GPT-5.6 Sol" },
    { id: "gpt-5.6-terra", name: "GPT-5.6 Terra" },
    { id: "gpt-5.6-luna", name: "GPT-5.6 Luna" },
    { id: "gpt-5.5", name: "GPT-5.5" },
    { id: "gpt-5.4", name: "GPT-5.4" },
    { id: "gpt-4o", name: "GPT-4o" },

    // Claude (Top 5)
    { id: "claude-sonnet-5", name: "Claude Sonnet 5" },
    { id: "claude-opus-4-8", name: "Claude Opus 4.8" },
    { id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6" },
    { id: "claude-fable-5", name: "Claude Fable 5" },
    { id: "claude-haiku-4-5", name: "Claude Haiku 4.5" },

    // Gemini (Top 5)
    { id: "gemini-3.5-flash", name: "Gemini 3.5 Flash" },
    { id: "gemini-3.1-pro-preview", name: "Gemini 3.1 Pro Preview" },
    { id: "gemini-3-pro-preview", name: "Gemini 3 Pro Preview" },
    { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro" },
    { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash" },

    // Grok (Top 5)
    { id: "grok-4.5", name: "Grok 4.5" },
    { id: "grok-4.3", name: "Grok 4.3" },
    { id: "grok-4.20-0309-console", name: "Grok 4.20 Console (0309)" },
    { id: "grok-build-0.1", name: "Grok Build 0.1" },
    { id: "grok-imagine-image", name: "Grok Imagine Image", kind: "image" },

    // DeepSeek & Kimi & Major Models
    { id: "deepseek-v4-pro", name: "DeepSeek V4 Pro" },
    { id: "deepseek-v4-flash", name: "DeepSeek V4 Flash" },
    { id: "kimi-k3", name: "Kimi K3" },
    { id: "kimi-k2.7-code", name: "Kimi K2.7 Code" },
    { id: "qwen3.7-plus", name: "Qwen 3.7 Plus" },
    { id: "glm-5.2", name: "GLM 5.2" },
    { id: "minimax-m3", name: "MiniMax M3" },
    { id: "gpt-image-2", name: "GPT Image 2", kind: "image" },
    { id: "gemini-3.1-flash-image", name: "Gemini 3.1 Flash Image", kind: "image" },
  ],
  modelsFetcher: { url: "https://a6api.com/v1/models", type: "openai" },
  passthroughModels: true,
};
