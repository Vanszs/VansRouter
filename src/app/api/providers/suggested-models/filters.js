// Free OpenCode models that don't use the "-free" id suffix
const KNOWN_FREE_OPENCODE_MODELS = ["big-pickle"];

export const FILTERS = {
  "openrouter-free": (models) =>
    models
      .reduce((acc, m) => {
        if (m.pricing?.prompt === "0" && m.pricing?.completion === "0" && m.context_length >= 200000) {
          acc.push({ id: m.id, name: m.name, contextLength: m.context_length });
        }
        return acc;
      }, [])
      .sort((a, b) => b.contextLength - a.contextLength),

  "opencode-free": (models) =>
    models.reduce((acc, m) => {
      if (m.id?.endsWith("-free") || KNOWN_FREE_OPENCODE_MODELS.includes(m.id)) {
        acc.push({ id: m.id, name: m.id });
      }
      return acc;
    }, []),

  // models.dev returns a large catalog; keep only mimo models
  "mimo-free": (models) =>
    (Array.isArray(models) ? models : []).reduce((acc, m) => {
      if (m.id?.startsWith("mimo") || m.name?.toLowerCase().includes("mimo")) {
        acc.push({ id: m.id, name: m.name || m.id });
      }
      return acc;
    }, []),
};
