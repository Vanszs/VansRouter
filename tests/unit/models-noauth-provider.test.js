import { describe, it, expect, vi, beforeEach } from "vitest";

const AI_PROVIDERS = {
  claude: { id: "claude", alias: "cc", name: "Claude Code", noAuth: false },
  opencode: { id: "opencode", alias: "oc", name: "OpenCode Free", noAuth: true, passthroughModels: true, modelsFetcher: { url: "https://opencode.ai/zen/v1/models", type: "opencode-free" } },
  searxng: { id: "searxng", alias: "searxng", name: "SearXNG", noAuth: true, serviceKinds: ["webSearch"], searchConfig: {} },
  edgeTts: { id: "edge-tts", alias: "edge-tts", name: "Edge TTS", noAuth: true, serviceKinds: ["tts"], ttsConfig: { models: [{ id: "edge-tts" }] } },
  glm: { id: "glm", alias: "glm", name: "GLM", noAuth: false },
};

const PROVIDER_ID_TO_ALIAS = { claude: "cc", opencode: "oc", glm: "glm" };
const PROVIDER_MODELS = {
  cc: [{ id: "claude-opus-4-8", name: "Claude Opus 4.8" }],
  oc: [],
  glm: [{ id: "glm-5.1", name: "GLM 5.1" }],
};

const LLM_KIND = "llm";

const MODEL_TYPE_TO_KIND = {
  image: "image",
  tts: "tts",
  embedding: "embedding",
  stt: "stt",
  imageToText: "imageToText",
};

function modelKind(model) {
  if (!model?.type) return LLM_KIND;
  return MODEL_TYPE_TO_KIND[model.type] || LLM_KIND;
}

function inferKindFromUnknownModelId(modelId) {
  const lower = String(modelId).toLowerCase();
  if (/embed/.test(lower)) return "embedding";
  if (/tts|speech|audio|voice/.test(lower)) return "tts";
  if (/image|imagen|dall-?e|flux|sdxl|sd-|stable-diffusion/.test(lower)) return "image";
  return LLM_KIND;
}

function getProviderAlias(providerId) {
  return AI_PROVIDERS[providerId]?.alias || providerId;
}

function providerMatchesKinds(providerId, kindFilter) {
  const provider = AI_PROVIDERS[providerId];
  const kinds = Array.isArray(provider?.serviceKinds) && provider.serviceKinds.length > 0
    ? provider.serviceKinds
    : [LLM_KIND];
  return kindFilter.some((k) => kinds.includes(k));
}

function isProviderAllowed(apiKeyInfo, providerIdOrAlias) {
  if (!apiKeyInfo) return true;
  const allowed = apiKeyInfo.allowedProviders;
  if (allowed === null || allowed === undefined) return true;
  if (!Array.isArray(allowed) || allowed.length === 0) return false;
  return allowed.includes(providerIdOrAlias);
}

const mockFetcherIds = ["deepseek-v4-flash-free", "mimo-v2.5-free", "qwen3.6-plus-free", "minimax-m3-free", "nemotron-3-super-free"];

async function fetchModelsFetcherIds(providerId, providerInfo) {
  if (providerInfo?.modelsFetcher?.type === "opencode-free") {
    return mockFetcherIds;
  }
  return [];
}

async function buildModelsList(kindFilter, { connections = [], customModels = [], modelAliases = {}, disabledByAlias = {} }) {
  const isDisabled = (alias, modelId) => Array.isArray(disabledByAlias[alias]) && disabledByAlias[alias].includes(modelId);

  const activeConnectionByProvider = new Map();
  for (const conn of connections) {
    if (!activeConnectionByProvider.has(conn.provider)) {
      activeConnectionByProvider.set(conn.provider, conn);
    }
  }

  const models = [];

  if (connections.length === 0) {
    const aliasToProviderId = Object.fromEntries(
      Object.entries(PROVIDER_ID_TO_ALIAS).map(([id, alias]) => [alias, id])
    );
    for (const [alias, providerModels] of Object.entries(PROVIDER_MODELS)) {
      const providerId = aliasToProviderId[alias] || alias;
      if (!providerMatchesKinds(providerId, kindFilter)) continue;
      for (const model of providerModels) {
        if (!kindFilter.includes(modelKind(model))) continue;
        if (isDisabled(alias, model.id)) continue;
        models.push({ id: `${alias}/${model.id}`, object: "model", owned_by: alias });
      }
    }

    // noAuth providers included even when DB unavailable
    for (const [providerId, providerInfo] of Object.entries(AI_PROVIDERS)) {
      if (!providerInfo.noAuth) continue;
      if (!providerMatchesKinds(providerId, kindFilter)) continue;
      const outputAlias = getProviderAlias(providerId) || providerInfo.alias || providerId;
      const providerModels = PROVIDER_MODELS[outputAlias] || [];
      const staticModelKindById = new Map(providerModels.map((m) => [m.id, modelKind(m)]));
      let rawModelIds = providerModels.map((m) => m.id);
      if (providerInfo.modelsFetcher) {
        const fetcherIds = await fetchModelsFetcherIds(providerId, providerInfo);
        rawModelIds = Array.from(new Set([...rawModelIds, ...fetcherIds]));
      }
      for (const modelId of rawModelIds) {
        const kind = staticModelKindById.get(modelId) || inferKindFromUnknownModelId(modelId);
        if (!kindFilter.includes(kind)) continue;
        if (isDisabled(outputAlias, modelId)) continue;
        models.push({ id: `${outputAlias}/${modelId}`, object: "model", owned_by: outputAlias });
      }
    }
  } else {
    for (const [providerId, conn] of activeConnectionByProvider.entries()) {
      if (!providerMatchesKinds(providerId, kindFilter)) continue;
      const staticAlias = PROVIDER_ID_TO_ALIAS[providerId] || providerId;
      const outputAlias = (conn?.providerSpecificData?.prefix || getProviderAlias(providerId) || staticAlias).trim();
      const providerModels = PROVIDER_MODELS[staticAlias] || [];
      const staticModelKindById = new Map(providerModels.map((m) => [m.id, modelKind(m)]));
      let rawModelIds = providerModels.map((model) => model.id);

      // For noAuth providers with connection, also include modelsFetcher results
      const connectedProviderInfo = AI_PROVIDERS[providerId];
      if (connectedProviderInfo?.noAuth && connectedProviderInfo?.modelsFetcher) {
        const fetcherIds = await fetchModelsFetcherIds(providerId, connectedProviderInfo);
        rawModelIds = Array.from(new Set([...rawModelIds, ...fetcherIds]));
      }

      const modelIds = rawModelIds.filter((modelId) => typeof modelId === "string" && modelId.trim() !== "");
      const mergedModelIds = Array.from(new Set([...modelIds]));
      for (const modelId of mergedModelIds) {
        const kind = staticModelKindById.get(modelId) || inferKindFromUnknownModelId(modelId);
        if (!kindFilter.includes(kind)) continue;
        if (isDisabled(outputAlias, modelId) || isDisabled(staticAlias, modelId)) continue;
        models.push({ id: `${outputAlias}/${modelId}`, object: "model", owned_by: outputAlias });
      }
    }

    // noAuth providers always included — they work without user connections
    for (const [providerId, providerInfo] of Object.entries(AI_PROVIDERS)) {
      if (activeConnectionByProvider.has(providerId)) continue;
      if (!providerInfo.noAuth) continue;
      if (!providerMatchesKinds(providerId, kindFilter)) continue;

      const outputAlias = getProviderAlias(providerId) || providerInfo.alias || providerId;
      const providerModels = PROVIDER_MODELS[outputAlias] || [];
      const staticModelKindById = new Map(providerModels.map((m) => [m.id, modelKind(m)]));

      let rawModelIds = providerModels.map((m) => m.id);

      if (providerInfo.modelsFetcher) {
        const fetcherIds = await fetchModelsFetcherIds(providerId, providerInfo);
        rawModelIds = Array.from(new Set([...rawModelIds, ...fetcherIds]));
      }

      const customModelIds = customModels
        .filter((m) => {
          if (!m?.id || (m.type && m.type !== "llm")) return false;
          const alias = m.providerAlias;
          return alias === outputAlias || alias === providerId;
        })
        .map((m) => String(m.id).trim())
        .filter((id) => id !== "");

      const aliasModelIds = Object.values(modelAliases || {})
        .filter((fullModel) => {
          if (typeof fullModel !== "string" || !fullModel.includes("/")) return false;
          return fullModel.startsWith(`${outputAlias}/`) || fullModel.startsWith(`${providerId}/`);
        })
        .map((fullModel) => {
          if (fullModel.startsWith(`${outputAlias}/`)) return fullModel.slice(outputAlias.length + 1);
          if (fullModel.startsWith(`${providerId}/`)) return fullModel.slice(providerId.length + 1);
          return fullModel;
        })
        .filter((id) => typeof id === "string" && id.trim() !== "");

      const mergedModelIds = Array.from(new Set([...rawModelIds, ...customModelIds, ...aliasModelIds]));
      for (const modelId of mergedModelIds) {
        const kind = staticModelKindById.get(modelId) || inferKindFromUnknownModelId(modelId);
        if (!kindFilter.includes(kind)) continue;
        if (isDisabled(outputAlias, modelId)) continue;
        models.push({
          id: `${outputAlias}/${modelId}`,
          object: "model",
          owned_by: outputAlias,
        });
      }

      if (kindFilter.includes("tts") && Array.isArray(providerInfo?.ttsConfig?.models)) {
        for (const m of providerInfo.ttsConfig.models) {
          if (m?.id && !isDisabled(outputAlias, m.id)) {
            models.push({ id: `${outputAlias}/${m.id}`, object: "model", owned_by: outputAlias });
          }
        }
      }
      if (kindFilter.includes("webSearch") && providerInfo?.searchConfig) {
        models.push({ id: `${outputAlias}/search`, object: "model", kind: "webSearch", owned_by: outputAlias });
      }
    }
  }

  const dedupedModels = [];
  const seenModelIds = new Set();
  for (const model of models) {
    if (!model?.id || seenModelIds.has(model.id)) continue;
    seenModelIds.add(model.id);
    dedupedModels.push(model);
  }
  return dedupedModels;
}

describe("buildModelsList — noAuth providers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("includes opencode (noAuth LLM) models when claude connection exists but opencode has no connection", async () => {
    const result = await buildModelsList(["llm"], {
      connections: [{ provider: "claude", apiKey: "test-key" }],
    });

    const ocModels = result.filter((m) => m.id.startsWith("oc/"));
    expect(ocModels.length).toBeGreaterThan(0);
    expect(ocModels.map((m) => m.id)).toContain("oc/deepseek-v4-flash-free");
    expect(ocModels.map((m) => m.id)).toContain("oc/mimo-v2.5-free");
  });

  it("includes claude models from active connection alongside noAuth models", async () => {
    const result = await buildModelsList(["llm"], {
      connections: [{ provider: "claude", apiKey: "test-key" }],
    });

    const ccModels = result.filter((m) => m.id.startsWith("cc/"));
    const ocModels = result.filter((m) => m.id.startsWith("oc/"));
    expect(ccModels.length).toBeGreaterThan(0);
    expect(ocModels.length).toBeGreaterThan(0);
    expect(ccModels.map((m) => m.id)).toContain("cc/claude-opus-4-8");
  });

  it("includes opencode models when opencode has an active connection (modelsFetcher from connection loop)", async () => {
    const result = await buildModelsList(["llm"], {
      connections: [{ provider: "opencode", apiKey: "test-key" }],
    });

    const ocModels = result.filter((m) => m.id.startsWith("oc/"));
    expect(ocModels.length).toBeGreaterThan(0);
    expect(ocModels.map((m) => m.id)).toContain("oc/deepseek-v4-flash-free");
  });

  it("skips noAuth providers that don't match kindFilter (searxng is webSearch, not LLM)", async () => {
    const result = await buildModelsList(["llm"], {
      connections: [{ provider: "claude", apiKey: "test-key" }],
    });

    const sxModels = result.filter((m) => m.id.startsWith("searxng/"));
    expect(sxModels.length).toBe(0);
  });

  it("includes noAuth webSearch provider when kindFilter includes webSearch", async () => {
    const result = await buildModelsList(["webSearch"], {
      connections: [{ provider: "claude", apiKey: "test-key" }],
    });

    const sxModels = result.filter((m) => m.id.startsWith("searxng/"));
    expect(sxModels.length).toBeGreaterThan(0);
    expect(sxModels.map((m) => m.id)).toContain("searxng/search");
  });

  it("includes all noAuth LLM models even with no connections at all", async () => {
    const result = await buildModelsList(["llm"], {
      connections: [],
    });

    const ocModels = result.filter((m) => m.id.startsWith("oc/"));
    expect(ocModels.length).toBeGreaterThan(0);
    expect(ocModels.map((m) => m.id)).toContain("oc/deepseek-v4-flash-free");
  });

  it("respects disabledByAlias for noAuth models", async () => {
    const result = await buildModelsList(["llm"], {
      connections: [{ provider: "claude", apiKey: "test-key" }],
      disabledByAlias: { oc: ["deepseek-v4-flash-free"] },
    });

    const ocModels = result.filter((m) => m.id.startsWith("oc/"));
    expect(ocModels.map((m) => m.id)).not.toContain("oc/deepseek-v4-flash-free");
    expect(ocModels.map((m) => m.id)).toContain("oc/mimo-v2.5-free");
  });

  it("respects custom models for noAuth provider", async () => {
    const result = await buildModelsList(["llm"], {
      connections: [{ provider: "claude", apiKey: "test-key" }],
      customModels: [{ id: "custom-free-model", providerAlias: "oc", type: "llm" }],
    });

    const ocModels = result.filter((m) => m.id.startsWith("oc/"));
    expect(ocModels.map((m) => m.id)).toContain("oc/custom-free-model");
  });

  it("respects model aliases for noAuth provider", async () => {
    const result = await buildModelsList(["llm"], {
      connections: [{ provider: "claude", apiKey: "test-key" }],
      modelAliases: { alias1: "oc/big-pickle" },
    });

    const ocModels = result.filter((m) => m.id.startsWith("oc/"));
    expect(ocModels.map((m) => m.id)).toContain("oc/big-pickle");
  });
});

describe("isProviderAllowed + buildModelsList — API key with all providers", () => {
  it("apiKey with allowedProviders=null should see noAuth models after filtering", async () => {
    const apiKeyInfo = { allowedProviders: null };
    const models = await buildModelsList(["llm"], {
      connections: [{ provider: "claude", apiKey: "test-key" }],
    });

    const filtered = models.filter((model) => {
      const providerAlias = model.id.includes("/") ? model.id.split("/")[0] : model.owned_by;
      return isProviderAllowed(apiKeyInfo, providerAlias);
    });

    const ocModels = filtered.filter((m) => m.id.startsWith("oc/"));
    expect(ocModels.length).toBeGreaterThan(0);
    expect(ocModels.map((m) => m.id)).toContain("oc/deepseek-v4-flash-free");
  });

  it("apiKey with allowedProviders=[cc] should NOT see opencode models", async () => {
    const apiKeyInfo = { allowedProviders: ["cc"] };
    const models = await buildModelsList(["llm"], {
      connections: [{ provider: "claude", apiKey: "test-key" }],
    });

    const filtered = models.filter((model) => {
      const providerAlias = model.id.includes("/") ? model.id.split("/")[0] : model.owned_by;
      return isProviderAllowed(apiKeyInfo, providerAlias);
    });

    const ocModels = filtered.filter((m) => m.id.startsWith("oc/"));
    expect(ocModels.length).toBe(0);
    const ccModels = filtered.filter((m) => m.id.startsWith("cc/"));
    expect(ccModels.length).toBeGreaterThan(0);
  });

  it("apiKey with allowedProviders=[cc,oc] should see both claude and opencode models", async () => {
    const apiKeyInfo = { allowedProviders: ["cc", "oc"] };
    const models = await buildModelsList(["llm"], {
      connections: [{ provider: "claude", apiKey: "test-key" }],
    });

    const filtered = models.filter((model) => {
      const providerAlias = model.id.includes("/") ? model.id.split("/")[0] : model.owned_by;
      return isProviderAllowed(apiKeyInfo, providerAlias);
    });

    const ccModels = filtered.filter((m) => m.id.startsWith("cc/"));
    const ocModels = filtered.filter((m) => m.id.startsWith("oc/"));
    expect(ccModels.length).toBeGreaterThan(0);
    expect(ocModels.length).toBeGreaterThan(0);
  });
});