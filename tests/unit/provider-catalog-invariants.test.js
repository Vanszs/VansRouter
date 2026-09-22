import { describe, expect, it } from "vitest";
import REGISTRY from "../../open-sse/providers/registry/index.js";
import { CLI_TOOLS } from "../../src/shared/constants/cliTools.js";
import { isValidModel } from "../../src/shared/constants/models.js";

const REQUIRED_ALIASES = ["gitlab", "mmf"];
const PROTECTED = {
  kimchi: {
    category: "freeTier",
    authType: "apikey",
    hasOAuth: true,
    authModes: ["apikey", "oauth"],
    serviceKinds: ["llm", "webSearch"],
    modelIds: ["kimi-k2.7", "minimax-m3", "nemotron-3-ultra-fp4", "deepseek-v4-flash"],
  },
  nvidia: {
    category: "freeTier",
    authType: "apikey",
    authModes: ["apikey"],
    serviceKinds: ["llm", "embedding"],
    modelIds: [
      "minimaxai/minimax-m2.7",
      "minimaxai/minimax-m3",
      "z-ai/glm-5.2",
      "deepseek-ai/deepseek-v4-pro",
      "deepseek-ai/deepseek-v4-flash",
      "openai/gpt-oss-120b",
      "openai/gpt-oss-20b",
      "meta/llama-4-maverick-17b-128e-instruct",
      "stepfun-ai/step-3.7-flash",
      "nvidia/nemotron-3-ultra-550b-a55b",
      "nvidia/nemotron-3-super-120b-a12b",
      "nvidia/nv-embedqa-e5-v5",
    ],
  },
  agentrouter: {
    category: "freeTier",
    authType: "apikey",
    hasOAuth: false,
    authModes: ["apikey"],
    serviceKinds: ["llm"],
    modelIds: ["claude-opus-4-6", "claude-opus-4-8", "glm-5.2", "gpt-5.5", "gpt-5.6-sol", "kimi-k3"],
  },
  claude: {
    category: "oauth",
    alias: "cc",
    uiAlias: "cc",
    modelIds: [
      "claude-opus-4-8",
      "claude-opus-4-7",
      "claude-opus-4-6",
      "claude-sonnet-4-6",
      "claude-opus-4-5-20251101",
      "claude-sonnet-4-5-20250929",
      "claude-haiku-4-5-20251001",
      "claude-opus-5",
      "claude-sonnet-5",
      "claude-fable-5-1",
      "claude-fable-5",
    ],
  },
  kiro: {
    category: "free",
    alias: "kr",
    uiAlias: "kr",
    modelIds: [
      "claude-opus-5",
      "claude-opus-5-thinking",
      "claude-opus-5-agentic",
      "claude-opus-5-thinking-agentic",
      "claude-opus-4.8",
      "claude-opus-4.8-thinking",
      "claude-opus-4.8-agentic",
      "claude-opus-4.8-thinking-agentic",
      "claude-opus-4.7",
      "claude-opus-4.7-thinking",
      "claude-opus-4.7-agentic",
      "claude-opus-4.7-thinking-agentic",
      "claude-opus-4.5",
      "claude-opus-4.5-thinking",
      "claude-opus-4.5-agentic",
      "claude-opus-4.5-thinking-agentic",
      "claude-sonnet-5",
      "claude-sonnet-4.5",
      "claude-haiku-4.5",
      "deepseek-3.2",
      "qwen3-coder-next",
      "glm-5",
      "MiniMax-M2.5",
      "gpt-5.6-sol",
      "gpt-5.6-terra",
      "gpt-5.6-luna",
      "claude-sonnet-5-thinking",
      "claude-sonnet-4.5-thinking",
      "claude-haiku-4.5-thinking",
      "gpt-5.6-sol-thinking",
      "gpt-5.6-terra-thinking",
      "gpt-5.6-luna-thinking",
      "claude-sonnet-5-agentic",
      "claude-sonnet-4.5-agentic",
      "claude-haiku-4.5-agentic",
      "gpt-5.6-sol-agentic",
      "gpt-5.6-terra-agentic",
      "gpt-5.6-luna-agentic",
      "claude-sonnet-5-thinking-agentic",
      "claude-sonnet-4.5-thinking-agentic",
      "claude-haiku-4.5-thinking-agentic",
      "gpt-5.6-sol-thinking-agentic",
      "gpt-5.6-terra-thinking-agentic",
      "gpt-5.6-luna-thinking-agentic",
    ],
  },
  sambanova: {
    category: "apikey",
    authType: "apikey",
    modelIds: [
      "MiniMax-M2.7",
      "DeepSeek-V3.2",
      "Llama-4-Maverick-17B-128E-Instruct",
      "Meta-Llama-3.3-70B-Instruct",
      "gpt-oss-120b",
    ],
  },
};

function lookupTokens(entry) {
  return [entry.id, entry.alias, ...(entry.aliases || []), entry.uiAlias].filter(Boolean);
}

function modelKinds(entry, model) {
  if (model.kind) return [model.kind];
  return entry.serviceKinds?.length ? entry.serviceKinds.filter((kind) => kind === "llm") : ["llm"];
}

describe("provider catalog invariants", () => {
  it("has no duplicate model IDs within a provider and service kind", () => {
    const seen = new Map();
    const duplicates = [];

    for (const entry of REGISTRY) {
      for (const model of entry.models || []) {
        for (const kind of modelKinds(entry, model)) {
          const key = `${entry.id}:${kind}:${model.id}`;
          if (seen.has(key)) duplicates.push(key);
          seen.set(key, true);
        }
      }
    }

    expect(duplicates).toEqual([]);
  });

  it("resolves required provider aliases", () => {
    for (const alias of REQUIRED_ALIASES) {
      expect(REGISTRY.some((entry) => lookupTokens(entry).includes(alias)), alias).toBe(true);
    }
  });

  it("preserves protected provider categories, auth, and model IDs", () => {
    for (const [id, expected] of Object.entries(PROTECTED)) {
      const entry = REGISTRY.find((candidate) => candidate.id === id);
      expect(entry, `${id}: registry entry`).toBeDefined();
      expect(entry.category, `${id}: category`).toBe(expected.category);
      if (expected.authType) expect(entry.authType, `${id}: authType`).toBe(expected.authType);
      if (expected.hasOAuth !== undefined) expect(entry.hasOAuth, `${id}: hasOAuth`).toBe(expected.hasOAuth);
      if (expected.authModes) expect(entry.authModes, `${id}: authModes`).toEqual(expected.authModes);
      if (expected.serviceKinds) expect(entry.serviceKinds, `${id}: serviceKinds`).toEqual(expected.serviceKinds);
      if (expected.alias) expect(entry.alias, `${id}: alias`).toBe(expected.alias);
      if (expected.uiAlias) expect(entry.uiAlias, `${id}: uiAlias`).toBe(expected.uiAlias);
      expect((entry.models || []).map(({ id: modelId }) => modelId), `${id}: model IDs`).toEqual(expected.modelIds);
    }
  });

  // The CLI-tool cards write these defaults straight into the client config, so a
  // default naming a model the catalog does not declare is a dead pointer: the id
  // never shows up in the model list, and every lookup keyed on it falls back.
  it("points every provider-qualified CLI-tool default at a declared model", () => {
    const unresolved = [];

    for (const tool of Object.values(CLI_TOOLS)) {
      for (const model of tool.defaultModels || []) {
        const value = model.defaultValue;
        if (typeof value !== "string" || !value.includes("/")) continue;
        const [alias, ...rest] = value.split("/");
        if (!isValidModel(alias, rest.join("/"))) unresolved.push(`${tool.id}: ${value}`);
      }
    }

    expect(unresolved).toEqual([]);
  });
});

export { modelKinds };
