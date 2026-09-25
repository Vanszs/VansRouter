export default {
  id: "meta",
  priority: 119,
  alias: "meta",
  uiAlias: "meta",
  aliases: ["meta", "meta-ai"],
  display: {
    name: "Meta",
    icon: "psychology",
    color: "#0081FB",
    textIcon: "META",
    website: "https://dev.meta.ai",
    notice: {
      text: "Meta Model API: Models including Muse Spark, Muse Image, and Muse Voice.",
      apiKeyUrl: "https://dev.meta.ai",
    },
  },
  category: "apikey",
  authType: "apikey",
  authModes: ["apikey"],
  transport: {
    baseUrl: "https://api.meta.ai/v1/chat/completions",
    validateUrl: "https://api.meta.ai/v1/models",
  },
  transports: [
    {
      format: "openai",
      baseUrl: "https://api.meta.ai/v1/chat/completions",
      auth: { combined: true, header: "Authorization", scheme: "bearer" },
    },
    {
      format: "claude",
      baseUrl: "https://api.meta.ai/v1/messages",
      auth: { combined: true, header: "Authorization", scheme: "bearer" },
    },
    {
      format: "openai-responses",
      baseUrl: "https://api.meta.ai/v1/responses",
      auth: { combined: true, header: "Authorization", scheme: "bearer" },
    },
  ],
  serviceKinds: ["llm", "image", "stt"],
  imageConfig: {
    baseUrl: "https://api.meta.ai/v1/images/generations",
  },
  sttConfig: {
    baseUrl: "https://api.meta.ai/v1/audio/transcriptions",
  },
  models: [
    { id: "muse-spark", name: "Muse Spark" },
    { id: "muse-image-1.0", name: "Muse Image 1.0", kind: "image" },
    { id: "muse-voice-transcribe-1.0", name: "Muse Voice Transcribe 1.0", kind: "stt" },
    { id: "sam-3.1", name: "SAM 3.1" },
    { id: "llama-3.3-70b-instruct", name: "Llama 3.3 70B Instruct" },
  ],
  modelsFetcher: { url: "https://api.meta.ai/v1/models", type: "openai" },
  passthroughModels: true,
};
