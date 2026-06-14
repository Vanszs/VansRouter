import { PROVIDER_MODELS, PROVIDER_ID_TO_ALIAS } from "@/shared/constants/models";
import {
  AI_PROVIDERS,
  FREE_PROVIDERS,
  getProviderAlias,
  isAnthropicCompatibleProvider,
  isOpenAICompatibleProvider,
} from "@/shared/constants/providers";
import { getProviderConnections, getCombos, getCustomModels, getModelAliases } from "@/lib/localDb";
import { getDisabledModels } from "@/lib/disabledModelsDb";

const UPSTREAM_CONNECTION_RE = /[-_][0-9a-f]{8,}$/i;
const LLM_KIND = "llm";
const ALL_KINDS = [LLM_KIND, "tts", "embedding", "image", "imageToText", "stt", "webSearch", "webFetch"];

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

function providerMatchesKinds(providerId, kindFilter) {
  const provider = AI_PROVIDERS[providerId];
  const kinds = Array.isArray(provider?.serviceKinds) && provider.serviceKinds.length > 0
    ? provider.serviceKinds
    : [LLM_KIND];
  return kinds.some((k) => kindFilter.has(k));
}

function comboMatchesKinds(combo, kindFilter) {
  const kind = combo?.kind || LLM_KIND;
  return kindFilter.has(kind);
}

let _modelsFetcherCache = {};
let _modelsFetcherCacheExpiry = {};
const MODELS_FETCHER_CACHE_TTL_MS = 300000;

export async function fetchModelsFetcherIds(providerId, providerInfo) {
  const fetcher = providerInfo?.modelsFetcher;
  if (!fetcher?.url) return [];

  const now = Date.now();
  if (_modelsFetcherCache[providerId] && now < (_modelsFetcherCacheExpiry[providerId] || 0)) {
    return _modelsFetcherCache[providerId];
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);
    const response = await fetch(fetcher.url, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    if (!response.ok) return [];

    const data = await response.json();
    const rawModels = Array.isArray(data) ? data : (data?.data || data?.models || data?.results || []);

    let ids;
    if (fetcher.type === "opencode-free") {
      ids = rawModels.reduce((acc, m) => {
        const id = m?.id || m?.name || m?.model;
        if (typeof id === "string" && id.trim() !== "" && id.endsWith("-free")) acc.push(id);
        return acc;
      }, []);
    } else {
      ids = rawModels.reduce((acc, m) => {
        const id = m?.id || m?.name || m?.model;
        if (typeof id === "string" && id.trim() !== "") acc.push(id);
        return acc;
      }, []);
    }

    const result = Array.from(new Set(ids));
    _modelsFetcherCache[providerId] = result;
    _modelsFetcherCacheExpiry[providerId] = now + MODELS_FETCHER_CACHE_TTL_MS;
    return result;
  } catch {
    return _modelsFetcherCache[providerId] || [];
  }
}

async function fetchCompatibleModelIds(connection) {
  if (!connection?.apiKey) return [];

  const baseUrl = typeof connection?.providerSpecificData?.baseUrl === "string"
    ? connection.providerSpecificData.baseUrl.trim().replace(/\/$/, "")
    : "";

  if (!baseUrl) return [];

  let url = `${baseUrl}/models`;
  const headers = { "Content-Type": "application/json" };

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
    const rawModels = Array.isArray(data) ? data : (data?.data || data?.models || data?.results || []);
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

async function loadDbData() {
  let dbAvailable = false;
  let connections = [];
  try {
    connections = await getProviderConnections();
    dbAvailable = true;
    connections = connections.filter(c => c.isActive !== false);
  } catch { /* empty */ }

  let combos = [];
  try { combos = await getCombos(); dbAvailable = true; } catch { /* empty */ }

  let customModels = [];
  try { customModels = await getCustomModels(); } catch { /* empty */ }

  let modelAliases = {};
  try { modelAliases = await getModelAliases(); } catch { /* empty */ }

  let disabledByAlias = {};
  try { disabledByAlias = await getDisabledModels(); } catch { /* empty */ }

  const isDisabled = (alias, modelId) => Array.isArray(disabledByAlias[alias]) && disabledByAlias[alias].includes(modelId);

  const activeConnectionByProvider = new Map();
  for (const conn of connections) {
    if (!activeConnectionByProvider.has(conn.provider)) {
      activeConnectionByProvider.set(conn.provider, conn);
    }
  }

  return { connections, combos, customModels, modelAliases, isDisabled, activeConnectionByProvider, dbAvailable };
}

// Internal: returns array of model entries as { id, kind? } objects
// kind is set only for webSearch/webFetch pseudo-models
async function buildModelEntries(kindFilter, customModels, modelAliases, isDisabled, activeConnectionByProvider, dbAvailable) {
  const entries = [];

  const { combos } = await loadDbData().then(d => d).catch(() => ({ combos: [] }));
  // Reload combos from the caller's data if available; we receive it separately below

  return entries;
}

// Core model-building logic shared by buildModelsList and getAllowedModelIds.
// Returns { id, kind? }[] — kind is set for webSearch/webFetch only.
async function buildAllModelEntries(kindFilter, combos, customModels, modelAliases, isDisabled, activeConnectionByProvider, dbAvailable) {
  // Convert to Set for O(1) lookups
  kindFilter = new Set(kindFilter);
  const entries = [];

  for (const combo of combos) {
    if (!comboMatchesKinds(combo, kindFilter)) continue;
    const entry = { id: `combo/${combo.name}` };
    if (combo.kind === "webSearch" || combo.kind === "webFetch") {
      entry.kind = combo.kind;
    }
    entries.push(entry);
  }

  if (!dbAvailable) {
    const aliasToProviderId = Object.fromEntries(
      Object.entries(PROVIDER_ID_TO_ALIAS).map(([id, alias]) => [alias, id])
    );
    for (const [alias, providerModels] of Object.entries(PROVIDER_MODELS)) {
      const providerId = aliasToProviderId[alias] || alias;
      if (!providerMatchesKinds(providerId, kindFilter)) continue;
      for (const model of providerModels) {
        if (!kindFilter.has(modelKind(model))) continue;
        if (isDisabled(alias, model.id)) continue;
        entries.push({ id: `${alias}/${model.id}` });
      }
    }
    for (const customModel of customModels) {
      if (!customModel?.id || (customModel.type && customModel.type !== "llm")) continue;
      if (!kindFilter.has(LLM_KIND)) continue;
      const providerAlias = customModel.providerAlias;
      if (!providerAlias) continue;
      const modelId = String(customModel.id).trim();
      if (!modelId) continue;
      entries.push({ id: `${providerAlias}/${modelId}` });
    }
  } else {
    const connResults = await Promise.all(
      [...activeConnectionByProvider.entries()].reduce((acc, [providerId, conn]) => {
        if (providerMatchesKinds(providerId, kindFilter)) acc.push(buildConnectedProviderIds(providerId, conn, kindFilter, customModels, modelAliases, isDisabled));
        return acc;
      }, [])
    );
    for (const ids of connResults) entries.push(...ids);
  }

  // noAuth providers always included — they work without user connections
  const noAuthResults = await Promise.all(
    Object.entries(AI_PROVIDERS).reduce((acc, [providerId, providerInfo]) => {
      if (!activeConnectionByProvider.has(providerId) && providerInfo.noAuth && providerMatchesKinds(providerId, kindFilter)) {
        acc.push(buildFreeProviderIds(providerId, providerInfo, kindFilter, customModels, modelAliases, isDisabled));
      }
      return acc;
    }, [])
  );
  for (const ids of noAuthResults) entries.push(...ids);

  return entries;
}

async function buildConnectedProviderIds(providerId, conn, kindFilter, customModels, modelAliases, isDisabled) {
  const entries = [];
  const staticAlias = PROVIDER_ID_TO_ALIAS[providerId] || providerId;
  const outputAlias = (
    conn?.providerSpecificData?.prefix
    || getProviderAlias(providerId)
    || staticAlias
  ).trim();
  const providerModels = PROVIDER_MODELS[staticAlias] || [];
  const enabledModels = conn?.providerSpecificData?.enabledModels;
  const hasExplicitEnabledModels = Array.isArray(enabledModels) && enabledModels.length > 0;
  const isCompatibleProvider =
    isOpenAICompatibleProvider(providerId) || isAnthropicCompatibleProvider(providerId);

  const staticModelKindById = new Map(providerModels.map((m) => [m.id, modelKind(m)]));

  let rawModelIds = hasExplicitEnabledModels
    ? Array.from(new Set(enabledModels.filter((id) => typeof id === "string" && id.trim() !== "")))
    : providerModels.map((m) => m.id);

  if (isCompatibleProvider && rawModelIds.length === 0 && !UPSTREAM_CONNECTION_RE.test(providerId)) {
    rawModelIds = await fetchCompatibleModelIds(conn);
  }

  // For noAuth providers with connection, also include modelsFetcher results
  const providerInfo = AI_PROVIDERS[providerId];
  if (providerInfo?.noAuth && providerInfo?.modelsFetcher) {
    const fetcherIds = await fetchModelsFetcherIds(providerId, providerInfo);
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
    const kind = staticModelKindById.get(modelId) || inferKindFromUnknownModelId(modelId);
    if (!kindFilter.has(kind)) continue;
    if (isDisabled(outputAlias, modelId) || isDisabled(staticAlias, modelId)) continue;
    entries.push({ id: `${outputAlias}/${modelId}` });
  }

  if (kindFilter.has("tts") && Array.isArray(providerInfo?.ttsConfig?.models)) {
    for (const m of providerInfo.ttsConfig.models) {
      if (m?.id && !isDisabled(outputAlias, m.id) && !isDisabled(staticAlias, m.id)) {
        entries.push({ id: `${outputAlias}/${m.id}` });
      }
    }
  }
  if (kindFilter.has("embedding") && Array.isArray(providerInfo?.embeddingConfig?.models)) {
    for (const m of providerInfo.embeddingConfig.models) {
      if (m?.id && !isDisabled(outputAlias, m.id) && !isDisabled(staticAlias, m.id)) {
        entries.push({ id: `${outputAlias}/${m.id}` });
      }
    }
  }
  if (kindFilter.has("webSearch") && providerInfo?.searchConfig) {
    entries.push({ id: `${outputAlias}/search`, kind: "webSearch" });
  }
  if (kindFilter.has("webFetch") && providerInfo?.fetchConfig) {
    entries.push({ id: `${outputAlias}/fetch`, kind: "webFetch" });
  }

  return entries;
}

async function buildFreeProviderIds(providerId, providerInfo, kindFilter, customModels, modelAliases, isDisabled) {
  const entries = [];
  const outputAlias = getProviderAlias(providerId) || providerInfo.alias || providerId;
  const staticModelKindById = new Map(
    (PROVIDER_MODELS[outputAlias] || []).map((m) => [m.id, modelKind(m)])
  );

  const modelIds = (PROVIDER_MODELS[outputAlias] || []).map((m) => m.id);

  let fetcherModelIds = [];
  if (providerInfo.modelsFetcher) {
    fetcherModelIds = await fetchModelsFetcherIds(providerId, providerInfo);
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

  const mergedModelIds = Array.from(new Set([...modelIds, ...fetcherModelIds, ...customModelIds, ...aliasModelIds]));
  for (const modelId of mergedModelIds) {
    const kind = staticModelKindById.get(modelId) || inferKindFromUnknownModelId(modelId);
    if (!kindFilter.has(kind)) continue;
    if (isDisabled(outputAlias, modelId)) continue;
    entries.push({ id: `${outputAlias}/${modelId}` });
  }

  if (kindFilter.has("tts") && Array.isArray(providerInfo?.ttsConfig?.models)) {
    for (const m of providerInfo.ttsConfig.models) {
      if (m?.id && !isDisabled(outputAlias, m.id)) {
        entries.push({ id: `${outputAlias}/${m.id}` });
      }
    }
  }
  if (kindFilter.has("embedding") && Array.isArray(providerInfo?.embeddingConfig?.models)) {
    for (const m of providerInfo.embeddingConfig.models) {
      if (m?.id && !isDisabled(outputAlias, m.id)) {
        entries.push({ id: `${outputAlias}/${m.id}` });
      }
    }
  }
  if (kindFilter.has("webSearch") && providerInfo?.searchConfig) {
    entries.push({ id: `${outputAlias}/search`, kind: "webSearch" });
  }
  if (kindFilter.has("webFetch") && providerInfo?.fetchConfig) {
    entries.push({ id: `${outputAlias}/fetch`, kind: "webFetch" });
  }

  return entries;
}

export async function buildModelsList(kindFilter) {
  const { combos, customModels, modelAliases, isDisabled, activeConnectionByProvider, dbAvailable } = await loadDbData();
  const entries = await buildAllModelEntries(kindFilter, combos, customModels, modelAliases, isDisabled, activeConnectionByProvider, dbAvailable);

  const seen = new Set();
  const dedupedModels = [];
  for (const entry of entries) {
    if (!entry?.id || seen.has(entry.id)) continue;
    seen.add(entry.id);
    const model = { id: entry.id, object: "model", owned_by: entry.id.includes("/") ? entry.id.split("/")[0] : "combo" };
    if (entry.kind) model.kind = entry.kind;
    dedupedModels.push(model);
  }
  return dedupedModels;
}

let _allowedCache = null;
let _allowedCacheExpiry = 0;
const ALLOWED_CACHE_TTL_MS = 30000;

async function getAllowedModelIds() {
  const now = Date.now();
  if (_allowedCache && now < _allowedCacheExpiry) return _allowedCache;

  const { combos, customModels, modelAliases, isDisabled, activeConnectionByProvider, dbAvailable } = await loadDbData();
  const entries = await buildAllModelEntries(ALL_KINDS, combos, customModels, modelAliases, isDisabled, activeConnectionByProvider, dbAvailable);

  const allIds = new Set();
  for (const entry of entries) {
    if (entry?.id) allIds.add(entry.id);
  }

  _allowedCache = allIds;
  _allowedCacheExpiry = now + ALLOWED_CACHE_TTL_MS;
  return allIds;
}

function invalidateAllowedModelsCache() {
  _allowedCache = null;
  _allowedCacheExpiry = 0;
}

export async function isModelAllowed(modelStr, apiKeyInfo = null) {
  if (!apiKeyInfo) return true;
  const allowed = await getAllowedModelIds();
  return allowed.has(modelStr);
}
