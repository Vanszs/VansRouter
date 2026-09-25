export default {
  id: "alibaba",
  priority: 50,
  alias: "ali",
  display: {
    name: "Alibaba DashScope",
    icon: "cloud_queue",
    color: "#FF6600",
    textIcon: "AL",
    website: "https://dashscope-intl.aliyuncs.com",
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions",
    validateUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1/models",
  },
  models: [
    { id: "qwen-max", name: "qwen-max" },
    { id: "qwen-max-2025-01-25", name: "qwen-max-2025-01-25" },
    { id: "qwen-plus", name: "qwen-plus" },
    { id: "qwen-plus-2025-07-14", name: "qwen-plus-2025-07-14" },
    { id: "qwen-turbo", name: "qwen-turbo" },
    { id: "qwen-turbo-2025-11-01", name: "qwen-turbo-2025-11-01" },
    { id: "qwen3-coder-plus", name: "qwen3-coder-plus" },
    { id: "qwen3-coder-flash", name: "qwen3-coder-flash" },
    { id: "qwq-plus", name: "qwq-plus" },
    { id: "qwq-32b", name: "qwq-32b" },
    { id: "qwen3-32b", name: "qwen3-32b" },
    { id: "qwen3-235b-a22b", name: "qwen3-235b-a22b" }
  ],
};
