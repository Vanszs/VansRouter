import { PROVIDER_MODELS, PROVIDER_ID_TO_ALIAS } from "@/shared/constants/models";
import {
  AI_PROVIDERS,
  getProviderAlias,
  isAnthropicCompatibleProvider,
  isOpenAICompatibleProvider,
} from "@/shared/constants/providers";
import { getProviderConnections, getCombos, getCustomModels, getModelAliases, getSettings } from "@/lib/localDb";
import { getDisabledModels } from "@/lib/disabledModelsDb";
import { resolveKiroModels } from "open-sse/services/kiroModels.js";
import { resolveQoderModels } from "open-sse/services/qoderModels.js";
import { extractApiKey, isValidApiKey, isProviderAllowed, isComboAllowed, isKindAllowed } from "@/sse/services/auth.js";
import { stripComboPrefix } from "open-sse/services/combo.js";
import { fetchModelsFetcherIds } from "@/sse/services/allowedModels.js";

// Per-provider live model resolvers. Each receives a connection record and
// returns { models: [{ id, name? }, ...] } | null on failure.
// Adding a provider here makes /v1/models prefer the live catalog for it.
const LIVE_MODEL_RESOLVERS = {
  kiro: async (conn) => {
    const result = await resolveKiroModels({
      accessToken: conn.accessToken,
      refreshToken: conn.refreshToken,
      providerSpecificData: conn.providerSpecificData || {}
    }, { log: console });
    return result?.models?.length ? { models: result.models } : null;
  },
  qoder: async (conn) => {
    const result = await resolveQoderModels({
      accessToken: conn.accessToken,
      refreshToken: conn.refreshToken,
      email: conn.email,
      displayName: conn.displayName,
      providerSpecificData: conn.providerSpecificData || {}
    });
    if (!result?.models?.length) return null;
    return {
      models: result.models.map((m) => ({ id: m.id, name: m.name })),
    };
  }
};


const LLM_KIND = "llm";

// Map per-model `type` field (in PROVIDER_MODELS) to service kind.
// Models without `type` are treated as LLM.
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

// For dynamic/unknown model IDs (compatible providers, alias map, custom models)
// fall back to provider-level kind matching when per-model type is unavailable.
function inferKindFromUnknownModelId(modelId) {
  const lower = String(modelId).toLowerCase();
  if (/embed/.test(lower)) return "embedding";
  if (/tts|speech|audio|voice/.test(lower)) return "tts";
  if (/image|imagen|dall-?e|flux|sdxl|sd-|stable-diffusion/.test(lower)) return "image";
  return LLM_KIND;
}

async function fetchCompatibleModelIds(connection) {
  if (!connection?.apiKey) return [];

  const baseUrl = typeof connection?.providerSpecificData?.baseUrl === "string"
    ? connection.providerSpecificData.baseUrl.trim().replace(/\/$/, "")
    : "";

  if (!baseUrl) return [];

  let url = `${baseUrl}/models`;
  const headers = {
    "Content-Type": "application/json",
  };

  if (isOpenAICompatibleProvider(connection.provider)) {
    headers.Authorization = `Bearer ${connection.apiKey}`;
  } else if (isAnthropicCompatibleProvider(connection.provider)) {
    if (url.endsWith("/messages/models")) {
      url = url.slice(0, -9);
    } else if (url.endsWith("/messages")) {
      url = `${url.slice(0, -9)}/models`;
    }
    headers["x-api-key"] = connection.apiKey;
    headers["anthropic-version"] = "2023-06-01";
    headers.Authorization = `Bearer ${connection.apiKey}`;
  } else {
    return [];
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    const response = await fetch(url, {
      method: "GET",
      headers,
      cache: "no-store",
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!response.ok) return [];

    const data = await response.json();
    const rawModels = parseOpenAIStyleModels(data);

    return Array.from(
      new Set(
        rawModels.reduce((acc, model) => {
          const modelId = model?.id || model?.name || model?.model;
          if (typeof modelId === "string" && modelId.trim() !== "") acc.push(modelId);
          return acc;
        }, [])
      )
    );
  } catch {
    return [];
  }
}

// Provider matches kindFilter when its serviceKinds intersect the requested kinds.
// LLM is the default kind for providers missing serviceKinds.
function providerMatchesKinds(providerId, kindFilter) {
  const provider = AI_PROVIDERS[providerId];
  const kinds = Array.isArray(provider?.serviceKinds) && provider.serviceKinds.length > 0
    ? provider.serviceKinds
    : [LLM_KIND];
  return kinds.some((k) => kindFilter.has(k));
}

// Combo matches kindFilter when its `kind` field is in the list.
// Combos with no kind are treated as LLM.
function comboMatchesKinds(combo, kindFilter) {
  const kind = combo?.kind || LLM_KIND;
  return kindFilter.has(kind);
}

/**
 * Build OpenAI-format models list filtered by service kinds.
 * @param {string[]} kindFilter - List of service kinds to include (e.g. ["llm"], ["webSearch","webFetch"]).
 */
export async function buildModelsList(kindFilter) {
  // Convert to Set for O(1) lookups throughout this function
  kindFilter = new Set(kindFilter);
  let connections = [];
  try {
    connections = await getProviderConnections();
    connections = connections.filter(c => c.isActive !== false);
  } catch (e) {
    console.log("Could not fetch providers, returning all models");
  }

  let combos = [];
  try {
    combos = await getCombos();
  } catch (e) {
    console.log("Could not fetch combos");
  }

  let customModels = [];
  try {
    customModels = await getCustomModels();
  } catch (e) {
    console.log("Could not fetch custom models");
  }

  let modelAliases = {};
  try {
    modelAliases = await getModelAliases();
  } catch (e) {
    console.log("Could not fetch model aliases");
  }

  let disabledByAlias = {};
  try {
    disabledByAlias = await getDisabledModels();
  } catch (e) {
    console.log("Could not fetch disabled models");
  }
  const disabledSets = {};
  for (const [alias, arr] of Object.entries(disabledByAlias)) {
    if (Array.isArray(arr)) disabledSets[alias] = new Set(arr);
  }
  const isDisabled = (alias, modelId) => disabledSets[alias]?.has(modelId) ?? false;

  const activeConnectionByProvider = new Map();
  for (const conn of connections) {
    if (!activeConnectionByProvider.has(conn.provider)) {
      activeConnectionByProvider.set(conn.provider, conn);
    }
  }

  const models = [];

  // Combos first (filtered by kind). Web combos expose `kind` so AI knows search vs fetch.
  for (const combo of combos) {
    if (!comboMatchesKinds(combo, kindFilter)) continue;
    const entry = {
      id: `combo/${combo.name}`,
      object: "model",
      owned_by: "combo",
    };
    if (combo.kind === "webSearch" || combo.kind === "webFetch") {
      entry.kind = combo.kind;
    }
    models.push(entry);
  }

  if (connections.length === 0) {
    // DB unavailable -> return static models, filtered by per-model kind
    const aliasToProviderId = Object.fromEntries(
      Object.entries(PROVIDER_ID_TO_ALIAS).map(([id, alias]) => [alias, id])
    );
    for (const [alias, providerModels] of Object.entries(PROVIDER_MODELS)) {
      const providerId = aliasToProviderId[alias] || alias;
      if (!providerMatchesKinds(providerId, kindFilter)) continue;
      for (const model of providerModels) {
        if (!kindFilter.has(modelKind(model))) continue;
        if (isDisabled(alias, model.id)) continue;
        models.push({
          id: `${alias}/${model.id}`,
          object: "model",
          owned_by: alias,
        });
      }
    }

    for (const customModel of customModels) {
      if (!customModel?.id || (customModel.type && customModel.type !== "llm")) continue;
      // Custom models without active connection are LLM-only by current schema
      if (!kindFilter.has(LLM_KIND)) continue;
      const providerAlias = customModel.providerAlias;
      if (!providerAlias) continue;

      const modelId = String(customModel.id).trim();
      if (!modelId) continue;

      models.push({
        id: `${providerAlias}/${modelId}`,
        object: "model",
        owned_by: providerAlias,
      });
    }

    // noAuth providers included even when DB unavailable
    // Pre-fetch modelsFetcher results in parallel
    const noAuthEntries = Object.entries(AI_PROVIDERS).filter(
      ([pid, pi]) => pi.noAuth && providerMatchesKinds(pid, kindFilter)
    );
    const fetcherResults = await Promise.all(
      noAuthEntries.map(([pid, pi]) =>
        pi.modelsFetcher ? fetchModelsFetcherIds(pid, pi).catch(() => []) : Promise.resolve([])
      )
    );
    for (let idx = 0; idx < noAuthEntries.length; idx++) {
      const [providerId, providerInfo] = noAuthEntries[idx];

      const outputAlias = getProviderAlias(providerId) || providerInfo.alias || providerId;
      const providerModels = PROVIDER_MODELS[outputAlias] || [];
      const staticModelKindById = new Map(providerModels.map((m) => [m.id, modelKind(m)]));
      let rawModelIds = providerModels.map((m) => m.id);

      if (providerInfo.modelsFetcher) {
        rawModelIds = Array.from(new Set([...rawModelIds, ...fetcherResults[idx]]));
      }

      for (const modelId of rawModelIds) {
        const kind = staticModelKindById.get(modelId) || inferKindFromUnknownModelId(modelId);
        if (!kindFilter.has(kind)) continue;
        if (isDisabled(outputAlias, modelId)) continue;
        models.push({
          id: `${outputAlias}/${modelId}`,
          object: "model",
          owned_by: outputAlias,
        });
      }

      if (kindFilter.has("tts") && Array.isArray(providerInfo?.ttsConfig?.models)) {
        for (const m of providerInfo.ttsConfig.models) {
          if (m?.id && !isDisabled(outputAlias, m.id)) {
            models.push({ id: `${outputAlias}/${m.id}`, object: "model", owned_by: outputAlias });
          }
        }
      }
      if (kindFilter.has("embedding") && Array.isArray(providerInfo?.embeddingConfig?.models)) {
        for (const m of providerInfo.embeddingConfig.models) {
          if (m?.id && !isDisabled(outputAlias, m.id)) {
            models.push({ id: `${outputAlias}/${m.id}`, object: "model", owned_by: outputAlias });
          }
        }
      }
      if (kindFilter.has("webSearch") && providerInfo?.searchConfig) {
        models.push({ id: `${outputAlias}/search`, object: "model", kind: "webSearch", owned_by: outputAlias });
      }
      if (kindFilter.has("webFetch") && providerInfo?.fetchConfig) {
        models.push({ id: `${outputAlias}/fetch`, object: "model", kind: "webFetch", owned_by: outputAlias });
      }
    }
  } else {
    // Pre-compute async fetches per provider in parallel
    const activeEntries = [...activeConnectionByProvider.entries()].filter(
      ([pid]) => providerMatchesKinds(pid, kindFilter)
    );
    const asyncResults = await Promise.all(activeEntries.map(async ([providerId, conn]) => {
      const staticAlias = PROVIDER_ID_TO_ALIAS[providerId] || providerId;
      const providerModels = PROVIDER_MODELS[staticAlias] || [];
      const enabledModels = conn?.providerSpecificData?.enabledModels;
      const hasExplicitEnabledModels = Array.isArray(enabledModels) && enabledModels.length > 0;
      const isCompatibleProvider = isOpenAICompatibleProvider(providerId) || isAnthropicCompatibleProvider(providerId);

      let baseModelIds = hasExplicitEnabledModels
        ? Array.from(new Set(enabledModels.filter((m) => typeof m === "string" && m.trim() !== "")))
        : providerModels.map((model) => model.id);

      let compatibleIds = null;
      if (isCompatibleProvider && baseModelIds.length === 0 && !UPSTREAM_CONNECTION_RE.test(providerId)) {
        compatibleIds = await fetchCompatibleModelIds(conn).catch(() => []);
      }

      let liveIds = null;
      const liveResolver = LIVE_MODEL_RESOLVERS[providerId];
      if (liveResolver && !hasExplicitEnabledModels) {
        try {
          const live = await liveResolver(conn);
          if (live?.models?.length) liveIds = live.models.map((m) => m.id);
        } catch (err) {
          console.log(`Live model fetch failed for ${providerId}: ${err?.message || err}`);
        }
      }

      let fetcherIds = null;
      const connectedProviderInfo = AI_PROVIDERS[providerId];
      if (connectedProviderInfo?.noAuth && connectedProviderInfo?.modelsFetcher) {
        fetcherIds = await fetchModelsFetcherIds(providerId, connectedProviderInfo).catch(() => []);
      }

      return { compatibleIds, liveIds, fetcherIds };
    }));

    for (let aeIdx = 0; aeIdx < activeEntries.length; aeIdx++) {
      const [providerId, conn] = activeEntries[aeIdx];
      const { compatibleIds, liveIds, fetcherIds } = asyncResults[aeIdx];

      const staticAlias = PROVIDER_ID_TO_ALIAS[providerId] || providerId;
      const outputAlias = (
        conn?.providerSpecificData?.prefix
        || getProviderAlias(providerId)
        || staticAlias
      ).trim();
      const providerModels = PROVIDER_MODELS[staticAlias] || [];
      const enabledModels = conn?.providerSpecificData?.enabledModels;
      const hasExplicitEnabledModels =
        Array.isArray(enabledModels) && enabledModels.length > 0;

      // Build kind lookup for static models so we can filter even when only IDs are exposed
      const staticModelKindById = new Map(
        providerModels.map((m) => [m.id, modelKind(m)])
      );

      let rawModelIds = hasExplicitEnabledModels
        ? Array.from(
            new Set(
              enabledModels.filter(
                (modelId) => typeof modelId === "string" && modelId.trim() !== "",
              ),
            ),
          )
        : providerModels.map((model) => model.id);

      if (compatibleIds) {
        rawModelIds = compatibleIds;
      }

      if (liveIds) {
        rawModelIds = liveIds;
      }

      if (fetcherIds) {
        rawModelIds = Array.from(new Set([...rawModelIds, ...fetcherIds]));
      }

      const modelIds = rawModelIds.reduce((acc, modelId) => {
          let id = modelId;
          if (id.startsWith(`${outputAlias}/`)) id = id.slice(outputAlias.length + 1);
          else if (id.startsWith(`${staticAlias}/`)) id = id.slice(staticAlias.length + 1);
          else if (id.startsWith(`${providerId}/`)) id = id.slice(providerId.length + 1);
          if (typeof id === "string" && id.trim() !== "") acc.push(id);
          return acc;
        }, []);

      const customModelIds = customModels.reduce((acc, m) => {
          if (!m?.id || (m.type && m.type !== "llm")) return acc;
          const alias = m.providerAlias;
          if (alias !== staticAlias && alias !== outputAlias && alias !== providerId) return acc;
          const id = String(m.id).trim();
          if (id !== "") acc.push(id);
          return acc;
        }, []);

      const aliasModelIds = Object.values(modelAliases || {}).reduce((acc, fullModel) => {
          if (typeof fullModel !== "string" || !fullModel.includes("/")) return acc;
          if (!fullModel.startsWith(`${outputAlias}/`) && !fullModel.startsWith(`${staticAlias}/`) && !fullModel.startsWith(`${providerId}/`)) return acc;
          let id;
          if (fullModel.startsWith(`${outputAlias}/`)) id = fullModel.slice(outputAlias.length + 1);
          else if (fullModel.startsWith(`${staticAlias}/`)) id = fullModel.slice(staticAlias.length + 1);
          else id = fullModel.slice(providerId.length + 1);
          if (typeof id === "string" && id.trim() !== "") acc.push(id);
          return acc;
        }, []);

      const mergedModelIds = Array.from(new Set([...modelIds, ...customModelIds, ...aliasModelIds]));

      for (const modelId of mergedModelIds) {
        // Resolve kind: prefer static metadata, otherwise infer from ID heuristics
        const kind = staticModelKindById.get(modelId) || inferKindFromUnknownModelId(modelId);
        if (!kindFilter.has(kind)) continue;
        if (isDisabled(outputAlias, modelId) || isDisabled(staticAlias, modelId)) continue;

        models.push({
          id: `${outputAlias}/${modelId}`,
          object: "model",
          owned_by: outputAlias,
        });
      }

      // Merge sub-config models (TTS / embedding) that live on AI_PROVIDERS, not PROVIDER_MODELS
      const providerInfo = AI_PROVIDERS[providerId];
      const subConfigModels = [];
      if (kindFilter.has("tts") && Array.isArray(providerInfo?.ttsConfig?.models)) {
        for (const m of providerInfo.ttsConfig.models) {
          if (m?.id) subConfigModels.push(m.id);
        }
      }
      if (kindFilter.has("embedding") && Array.isArray(providerInfo?.embeddingConfig?.models)) {
        for (const m of providerInfo.embeddingConfig.models) {
          if (m?.id) subConfigModels.push(m.id);
        }
      }
      for (const subId of subConfigModels) {
        if (isDisabled(outputAlias, subId) || isDisabled(staticAlias, subId)) continue;
        models.push({
          id: `${outputAlias}/${subId}`,
          object: "model",
          owned_by: outputAlias,
        });
      }

      // Web search/fetch — provider IS the model, expose as {alias}/search and/or {alias}/fetch with explicit kind
      if (kindFilter.has("webSearch") && providerInfo?.searchConfig) {
        models.push({
          id: `${outputAlias}/search`,
          object: "model",
          kind: "webSearch",
          owned_by: outputAlias,
        });
      }
      if (kindFilter.has("webFetch") && providerInfo?.fetchConfig) {
        models.push({
          id: `${outputAlias}/fetch`,
          object: "model",
          kind: "webFetch",
          owned_by: outputAlias,
        });
      }
    }

    // noAuth providers always included — they work without user connections
    // Pre-fetch modelsFetcher results in parallel
    const noAuthEntries2 = Object.entries(AI_PROVIDERS).filter(
      ([pid, pi]) => !activeConnectionByProvider.has(pid) && pi.noAuth && providerMatchesKinds(pid, kindFilter)
    );
    const fetcherResults2 = await Promise.all(
      noAuthEntries2.map(([pid, pi]) =>
        pi.modelsFetcher ? fetchModelsFetcherIds(pid, pi).catch(() => []) : Promise.resolve([])
      )
    );
    for (let idx2 = 0; idx2 < noAuthEntries2.length; idx2++) {
      const [providerId, providerInfo] = noAuthEntries2[idx2];

      const outputAlias = getProviderAlias(providerId) || providerInfo.alias || providerId;
      const providerModels = PROVIDER_MODELS[outputAlias] || [];
      const staticModelKindById = new Map(providerModels.map((m) => [m.id, modelKind(m)]));

      let rawModelIds = providerModels.map((m) => m.id);

      if (providerInfo.modelsFetcher) {
        rawModelIds = Array.from(new Set([...rawModelIds, ...fetcherResults2[idx2]]));
      }

      const customModelIds = customModels.reduce((acc, m) => {
          if (!m?.id || (m.type && m.type !== "llm")) return acc;
          const alias = m.providerAlias;
          if (alias !== outputAlias && alias !== providerId) return acc;
          const id = String(m.id).trim();
          if (id !== "") acc.push(id);
          return acc;
        }, []);

      const aliasModelIds = Object.values(modelAliases || {}).reduce((acc, fullModel) => {
          if (typeof fullModel !== "string" || !fullModel.includes("/")) return acc;
          if (!fullModel.startsWith(`${outputAlias}/`) && !fullModel.startsWith(`${providerId}/`)) return acc;
          let id;
          if (fullModel.startsWith(`${outputAlias}/`)) id = fullModel.slice(outputAlias.length + 1);
          else id = fullModel.slice(providerId.length + 1);
          if (typeof id === "string" && id.trim() !== "") acc.push(id);
          return acc;
        }, []);

      const mergedModelIds = Array.from(new Set([...rawModelIds, ...customModelIds, ...aliasModelIds]));
      for (const modelId of mergedModelIds) {
        const kind = staticModelKindById.get(modelId) || inferKindFromUnknownModelId(modelId);
        if (!kindFilter.has(kind)) continue;
        if (isDisabled(outputAlias, modelId)) continue;
        models.push({
          id: `${outputAlias}/${modelId}`,
          object: "model",
          owned_by: outputAlias,
        });
      }

      if (kindFilter.has("tts") && Array.isArray(providerInfo?.ttsConfig?.models)) {
        for (const m of providerInfo.ttsConfig.models) {
          if (m?.id && !isDisabled(outputAlias, m.id)) {
            models.push({ id: `${outputAlias}/${m.id}`, object: "model", owned_by: outputAlias });
          }
        }
      }
      if (kindFilter.has("embedding") && Array.isArray(providerInfo?.embeddingConfig?.models)) {
        for (const m of providerInfo.embeddingConfig.models) {
          if (m?.id && !isDisabled(outputAlias, m.id)) {
            models.push({ id: `${outputAlias}/${m.id}`, object: "model", owned_by: outputAlias });
          }
        }
      }
      if (kindFilter.has("webSearch") && providerInfo?.searchConfig) {
        models.push({ id: `${outputAlias}/search`, object: "model", kind: "webSearch", owned_by: outputAlias });
      }
      if (kindFilter.has("webFetch") && providerInfo?.fetchConfig) {
        models.push({ id: `${outputAlias}/fetch`, object: "model", kind: "webFetch", owned_by: outputAlias });
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

/**
 * Handle CORS preflight
 */
export async function OPTIONS() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "*",
    },
  });
}

export async function GET(request) {
  try {
    const settings = await getSettings();
    let apiKeyInfo = null;

    if (settings.requireApiKey) {
      const apiKey = extractApiKey(request);
      if (!apiKey) {
        return Response.json(
          { error: { message: "Missing API key", type: "authentication_error" } },
          { status: 401, headers: { "Access-Control-Allow-Origin": "*" } }
        );
      }
      apiKeyInfo = await isValidApiKey(apiKey);
      if (!apiKeyInfo) {
        return Response.json(
          { error: { message: "Invalid API key", type: "authentication_error" } },
          { status: 401, headers: { "Access-Control-Allow-Origin": "*" } }
        );
      }
    }

    if (apiKeyInfo && !isKindAllowed(apiKeyInfo, "llm")) {
      return Response.json({ object: "list", data: [] }, { headers: { "Access-Control-Allow-Origin": "*" } });
    }

    let data = await buildModelsList([LLM_KIND]);

    if (apiKeyInfo) {
      data = data.filter((model) => {
        const isCombo = model.owned_by === "combo";
        if (isCombo) {
          const comboName = stripComboPrefix(model.id);
          return isComboAllowed(apiKeyInfo, comboName);
        }
        const providerAlias = model.id.includes("/") ? model.id.split("/")[0] : model.owned_by;
        return isProviderAllowed(apiKeyInfo, providerAlias);
      });
    }


    return Response.json({ object: "list", data }, {
      headers: { "Access-Control-Allow-Origin": "*" },
    });
  } catch (error) {
    console.log("Error fetching models:", error);
    return Response.json(
      { error: { message: error.message, type: "server_error" } },
      { status: 500 }
    );
  }
}
