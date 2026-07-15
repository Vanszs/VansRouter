export default {
  id: "muse-spark-web",
  priority: 150,
  alias: "muse-spark-web",
  aliases: [
    "muse",
  ],
  uiAlias: "muse",
  display: {
    name: "Muse Spark Web (Meta AI)",
    icon: "psychology",
    color: "#0064FF",
    textIcon: "MS",
    website: "https://www.meta.ai",
  },
  category: "webCookie",
  authType: "cookie",
  authHint: "Paste your ecto_1_sess= cookie value from meta.ai",
  transport: {
    baseUrl: "https://www.meta.ai/api/graphql",
    format: "muse-spark-web",
    authType: "cookie",
  },
  models: [
    { id: "muse-spark", name: "Muse Spark" },
    { id: "muse-spark-thinking", name: "Muse Spark (Thinking)" },
    { id: "muse-spark-contemplating", name: "Muse Spark (Contemplating)" },
  ],
  passthroughModels: true,
};
