import { describe, it, expect } from "vitest";

function isComboAllowed(apiKeyInfo, comboName) {
  if (!apiKeyInfo) return true;
  const name = comboName.startsWith("combo/") ? comboName.slice(6) : comboName;
  const allowed = apiKeyInfo.allowedCombos;
  if (allowed === null || allowed === undefined) return true;
  if (!Array.isArray(allowed) || allowed.length === 0) return false;
  return allowed.includes(name);
}

function isProviderAllowed(apiKeyInfo, providerIdOrAlias) {
  if (!apiKeyInfo) return true;
  const allowed = apiKeyInfo.allowedProviders;
  if (allowed === null || allowed === undefined) return true;
  if (!Array.isArray(allowed) || allowed.length === 0) return false;
  return allowed.includes(providerIdOrAlias);
}

function isKindAllowed(apiKeyInfo, kind) {
  if (!apiKeyInfo) return true;
  const allowed = apiKeyInfo.allowedKinds;
  if (allowed === null || allowed === undefined) return true;
  if (!Array.isArray(allowed) || allowed.length === 0) return false;
  return allowed.includes(kind);
}

function getComboModelsFromData(modelStr, combosData) {
  const name = modelStr.startsWith("combo/") ? modelStr.slice(6) : modelStr;
  if (name.includes("/")) return null;
  const combos = Array.isArray(combosData) ? combosData : (combosData?.combos || []);
  const combo = combos.find(c => c.name === name);
  if (combo && combo.models && combo.models.length > 0) return combo.models;
  return null;
}

function stripComboPrefix(modelStr) {
  return modelStr.startsWith("combo/") ? modelStr.slice(6) : modelStr;
}

function filterModelsByApiKey(models, apiKeyInfo) {
  return models.filter((model) => {
    const isCombo = model.owned_by === "combo";
    if (isCombo) {
      const comboName = model.id.startsWith("combo/") ? model.id.slice(6) : model.id;
      return isComboAllowed(apiKeyInfo, comboName);
    }
    const providerAlias = model.id.includes("/") ? model.id.split("/")[0] : model.owned_by;
    return isProviderAllowed(apiKeyInfo, providerAlias);
  });
}

const COMBOS = [
  { name: "coding-stack", kind: "llm", models: ["glm/glm-4", "openai/gpt-4o"] },
  { name: "free-forever", kind: "llm", models: ["glm/glm-4-flash"] },
  { name: "premium-stack", kind: "llm", models: ["anthropic/claude-3-opus", "openai/gpt-4o"] },
  { name: "web-search-combo", kind: "webSearch", models: ["brave/search"] },
];

const MODELS_LIST = [
  { id: "combo/coding-stack", object: "model", owned_by: "combo" },
  { id: "combo/free-forever", object: "model", owned_by: "combo" },
  { id: "combo/premium-stack", object: "model", owned_by: "combo" },
  { id: "combo/web-search-combo", object: "model", owned_by: "combo" },
  { id: "glm/glm-4", object: "model", owned_by: "glm" },
  { id: "openai/gpt-4o", object: "model", owned_by: "openai" },
  { id: "anthropic/claude-3-opus", object: "model", owned_by: "anthropic" },
];

describe("stripComboPrefix", () => {
  it("strips combo/ prefix from ticker format", () => {
    expect(stripComboPrefix("combo/coding-stack")).toBe("coding-stack");
    expect(stripComboPrefix("combo/free-forever")).toBe("free-forever");
  });

  it("returns plain combo name unchanged", () => {
    expect(stripComboPrefix("coding-stack")).toBe("coding-stack");
    expect(stripComboPrefix("free-forever")).toBe("free-forever");
  });

  it("does not strip other prefixes", () => {
    expect(stripComboPrefix("glm/glm-4")).toBe("glm/glm-4");
    expect(stripComboPrefix("openai/gpt-4o")).toBe("openai/gpt-4o");
  });

  it("handles empty string", () => {
    expect(stripComboPrefix("")).toBe("");
  });

  it("handles combo/ with no name after it", () => {
    expect(stripComboPrefix("combo/")).toBe("");
  });
});

describe("isComboAllowed - combo/ ticker format", () => {
  it("combo/ ticker works with allowedCombos using plain name", () => {
    const key = { allowedCombos: ["coding-stack"] };
    expect(isComboAllowed(key, "combo/coding-stack")).toBe(true);
    expect(isComboAllowed(key, "combo/free-forever")).toBe(false);
    expect(isComboAllowed(key, "combo/premium-stack")).toBe(false);
  });

  it("plain combo name still works (backward compat)", () => {
    const key = { allowedCombos: ["coding-stack"] };
    expect(isComboAllowed(key, "coding-stack")).toBe(true);
    expect(isComboAllowed(key, "free-forever")).toBe(false);
  });

  it("combo/ ticker and plain name are equivalent", () => {
    const key = { allowedCombos: ["coding-stack", "free-forever"] };
    for (const combo of ["coding-stack", "free-forever"]) {
      expect(isComboAllowed(key, combo)).toBe(isComboAllowed(key, `combo/${combo}`));
    }
  });

  it("null apiKeyInfo = unrestricted for ticker format", () => {
    expect(isComboAllowed(null, "combo/coding-stack")).toBe(true);
    expect(isComboAllowed(null, "combo/free-forever")).toBe(true);
  });

  it("allowedCombos=null = all allowed for ticker format", () => {
    expect(isComboAllowed({ allowedCombos: null }, "combo/coding-stack")).toBe(true);
  });

  it("allowedCombos=[] = none allowed for ticker format", () => {
    expect(isComboAllowed({ allowedCombos: [] }, "combo/coding-stack")).toBe(false);
    expect(isComboAllowed({ allowedCombos: [] }, "combo/free-forever")).toBe(false);
  });

  it("multi-combo allowedCombos works for ticker format", () => {
    const key = { allowedCombos: ["coding-stack", "free-forever"] };
    expect(isComboAllowed(key, "combo/coding-stack")).toBe(true);
    expect(isComboAllowed(key, "combo/free-forever")).toBe(true);
    expect(isComboAllowed(key, "combo/premium-stack")).toBe(false);
  });

  it("case-sensitive matching for ticker format", () => {
    expect(isComboAllowed({ allowedCombos: ["coding-stack"] }, "combo/Coding-Stack")).toBe(false);
    expect(isComboAllowed({ allowedCombos: ["Coding-Stack"] }, "combo/coding-stack")).toBe(false);
  });

  it("partial name does not match (security)", () => {
    expect(isComboAllowed({ allowedCombos: ["coding"] }, "combo/coding-stack")).toBe(false);
    expect(isComboAllowed({ allowedCombos: ["coding-stack"] }, "combo/coding")).toBe(false);
  });
});

describe("getComboModelsFromData - combo/ ticker format", () => {
  it("resolves combo/ ticker to models array", () => {
    const result = getComboModelsFromData("combo/coding-stack", COMBOS);
    expect(result).toEqual(["glm/glm-4", "openai/gpt-4o"]);
  });

  it("resolves plain combo name to models array (backward compat)", () => {
    const result = getComboModelsFromData("coding-stack", COMBOS);
    expect(result).toEqual(["glm/glm-4", "openai/gpt-4o"]);
  });

  it("combo/ ticker and plain name give same result", () => {
    for (const combo of COMBOS) {
      const byTicker = getComboModelsFromData(`combo/${combo.name}`, COMBOS);
      const byPlain = getComboModelsFromData(combo.name, COMBOS);
      expect(byTicker).toEqual(byPlain);
    }
  });

  it("returns null for provider/model format (not a combo)", () => {
    expect(getComboModelsFromData("glm/glm-4", COMBOS)).toBeNull();
    expect(getComboModelsFromData("combo/glm/glm-4", COMBOS)).toBeNull();
  });

  it("returns null for unknown combo name", () => {
    expect(getComboModelsFromData("combo/nonexistent", COMBOS)).toBeNull();
    expect(getComboModelsFromData("nonexistent", COMBOS)).toBeNull();
  });

  it("handles object format combosData", () => {
    const data = { combos: COMBOS };
    expect(getComboModelsFromData("combo/coding-stack", data)).toEqual(["glm/glm-4", "openai/gpt-4o"]);
  });

  it("handles empty combos array", () => {
    expect(getComboModelsFromData("combo/coding-stack", [])).toBeNull();
  });
});

describe("filterModelsByApiKey - combo ticker in /models", () => {
  it("no apiKeyInfo returns all models unchanged", () => {
    const filtered = filterModelsByApiKey(MODELS_LIST, null);
    expect(filtered).toEqual(MODELS_LIST);
  });

  it("apiKeyInfo with no ACL fields returns all models", () => {
    const key = { id: "key-1", name: "test-key" };
    const filtered = filterModelsByApiKey(MODELS_LIST, key);
    expect(filtered).toEqual(MODELS_LIST);
  });

  it("allowedCombos=[coding-stack] shows only that combo + all providers", () => {
    const key = { allowedCombos: ["coding-stack"] };
    const filtered = filterModelsByApiKey(MODELS_LIST, key);
    const comboIds = filtered.filter(m => m.owned_by === "combo").map(m => m.id);
    const providerIds = filtered.filter(m => m.owned_by !== "combo").map(m => m.id);
    expect(comboIds).toEqual(["combo/coding-stack"]);
    expect(providerIds).toEqual(["glm/glm-4", "openai/gpt-4o", "anthropic/claude-3-opus"]);
  });

  it("allowedCombos=[] hides all combos but keeps providers", () => {
    const key = { allowedCombos: [] };
    const filtered = filterModelsByApiKey(MODELS_LIST, key);
    expect(filtered.filter(m => m.owned_by === "combo")).toEqual([]);
    expect(filtered.filter(m => m.owned_by !== "combo").length).toBe(3);
  });

  it("allowedCombos=null shows all combos", () => {
    const key = { allowedCombos: null };
    const filtered = filterModelsByApiKey(MODELS_LIST, key);
    expect(filtered.filter(m => m.owned_by === "combo").length).toBe(4);
  });

  it("combined restriction: providers + combos", () => {
    const key = { allowedProviders: ["glm"], allowedCombos: ["coding-stack"] };
    const filtered = filterModelsByApiKey(MODELS_LIST, key);
    const comboIds = filtered.filter(m => m.owned_by === "combo").map(m => m.id);
    const providerIds = filtered.filter(m => m.owned_by !== "combo").map(m => m.id);
    expect(comboIds).toEqual(["combo/coding-stack"]);
    expect(providerIds).toEqual(["glm/glm-4"]);
  });

  it("combined restriction: kinds + combos", () => {
    const key = { allowedCombos: ["coding-stack"], allowedKinds: ["llm"] };
    const filtered = filterModelsByApiKey(MODELS_LIST, key);
    expect(filtered.some(m => m.id === "combo/coding-stack")).toBe(true);
    expect(filtered.some(m => m.id === "combo/web-search-combo")).toBe(false);
  });

  it("combo ticker combo/coding-stack correctly extracted for ACL check", () => {
    const key = { allowedCombos: ["coding-stack"] };
    const filtered = filterModelsByApiKey(MODELS_LIST, key);
    const comboEntries = filtered.filter(m => m.owned_by === "combo");
    expect(comboEntries.map(m => m.id)).toContain("combo/coding-stack");
    expect(comboEntries.map(m => m.id)).not.toContain("combo/free-forever");
  });

  it("allowedCombos with plain name matches combo/ ticker in models list", () => {
    const key = { allowedCombos: ["free-forever"] };
    const filtered = filterModelsByApiKey(MODELS_LIST, key);
    const comboIds = filtered.filter(m => m.owned_by === "combo").map(m => m.id);
    expect(comboIds).toEqual(["combo/free-forever"]);
  });

  it("multiple combos allowed via ticker format", () => {
    const key = { allowedCombos: ["coding-stack", "premium-stack"] };
    const filtered = filterModelsByApiKey(MODELS_LIST, key);
    const comboIds = filtered.filter(m => m.owned_by === "combo").map(m => m.id);
    expect(comboIds).toEqual(["combo/coding-stack", "combo/premium-stack"]);
  });
});

describe("security: combo ticker cannot bypass ACL", () => {
  it("cannot bypass combo restriction by using combo/ ticker for different combo", () => {
    const key = { allowedCombos: ["coding-stack"] };
    expect(isComboAllowed(key, "combo/free-forever")).toBe(false);
    expect(isComboAllowed(key, "combo/premium-stack")).toBe(false);
  });

  it("cannot bypass combo restriction by using plain name when ticker is expected", () => {
    const key = { allowedCombos: ["coding-stack"] };
    expect(isComboAllowed(key, "free-forever")).toBe(false);
  });

  it("cannot bypass by injecting fake combo/ prefix on provider model", () => {
    expect(getComboModelsFromData("combo/glm/glm-4", COMBOS)).toBeNull();
  });

  it("cannot access combo by using provider/ prefix on combo name", () => {
    expect(getComboModelsFromData("glm/coding-stack", COMBOS)).toBeNull();
  });

  it("empty allowedCombos blocks combo/ ticker format", () => {
    const key = { allowedProviders: null, allowedCombos: [], allowedKinds: null };
    expect(filterModelsByApiKey(MODELS_LIST, key).filter(m => m.owned_by === "combo")).toEqual([]);
  });

  it("full lockdown: all ACL arrays empty", () => {
    const key = { allowedProviders: [], allowedCombos: [], allowedKinds: [] };
    const filtered = filterModelsByApiKey(MODELS_LIST, key);
    expect(filtered).toEqual([]);
  });

  it("combo/ ticker cannot impersonate a provider to bypass combo ACL", () => {
    const key = { allowedProviders: ["combo"], allowedCombos: ["coding-stack"] };
    const filtered = filterModelsByApiKey(MODELS_LIST, key);
    const comboIds = filtered.filter(m => m.owned_by === "combo").map(m => m.id);
    expect(comboIds).toEqual(["combo/coding-stack"]);
    expect(filtered.filter(m => m.owned_by !== "combo").length).toBe(0);
  });

  it("allowedProviders=[combo] without allowedCombos still allows all combos (combo ACL is separate)", () => {
    const key = { allowedProviders: ["combo"] };
    const filtered = filterModelsByApiKey(MODELS_LIST, key);
    expect(filtered.filter(m => m.owned_by === "combo").length).toBe(4);
    expect(filtered.filter(m => m.owned_by !== "combo").length).toBe(0);
  });
});

describe("backward compatibility: plain combo name still works everywhere", () => {
  it("isComboAllowed works with plain name", () => {
    const key = { allowedCombos: ["coding-stack"] };
    expect(isComboAllowed(key, "coding-stack")).toBe(true);
  });

  it("getComboModelsFromData works with plain name", () => {
    expect(getComboModelsFromData("coding-stack", COMBOS)).toEqual(["glm/glm-4", "openai/gpt-4o"]);
  });

  it("stripComboPrefix does not corrupt plain name", () => {
    expect(stripComboPrefix("coding-stack")).toBe("coding-stack");
  });

  it("filterModelsByApiKey works even if model.id is plain combo name (legacy)", () => {
    const legacyList = [
      { id: "coding-stack", object: "model", owned_by: "combo" },
      { id: "glm/glm-4", object: "model", owned_by: "glm" },
    ];
    const key = { allowedCombos: ["coding-stack"] };
    const filtered = filterModelsByApiKey(legacyList, key);
    expect(filtered.some(m => m.id === "coding-stack")).toBe(true);
    expect(filtered.some(m => m.id === "glm/glm-4")).toBe(true);
  });
});

describe("edge cases", () => {
  it("combo name with special characters", () => {
    expect(stripComboPrefix("combo/my-combo-v2")).toBe("my-combo-v2");
    expect(stripComboPrefix("combo/web_search")).toBe("web_search");
  });

  it("double combo/ prefix is handled correctly", () => {
    expect(stripComboPrefix("combo/combo/test")).toBe("combo/test");
    expect(isComboAllowed({ allowedCombos: ["combo/test"] }, "combo/combo/test")).toBe(true);
  });

  it("apiKeyInfo with undefined fields defaults to unrestricted", () => {
    const key = { allowedProviders: undefined, allowedCombos: undefined, allowedKinds: undefined };
    expect(filterModelsByApiKey(MODELS_LIST, key)).toEqual(MODELS_LIST);
  });

  it("webSearch combo kind in models list", () => {
    const webList = [
      { id: "combo/web-search-combo", object: "model", owned_by: "combo", kind: "webSearch" },
    ];
    const key = { allowedCombos: ["web-search-combo"] };
    const filtered = filterModelsByApiKey(webList, key);
    expect(filtered.length).toBe(1);
    expect(filtered[0].id).toBe("combo/web-search-combo");
  });

  it("dedup: same combo name with and without ticker should not appear twice", () => {
    const dupedList = [
      { id: "combo/coding-stack", object: "model", owned_by: "combo" },
      { id: "coding-stack", object: "model", owned_by: "combo" },
    ];
    const key = { allowedCombos: ["coding-stack"] };
    const filtered = filterModelsByApiKey(dupedList, key);
    expect(filtered.length).toBe(2);
    expect(filtered.map(m => m.id)).toEqual(["combo/coding-stack", "coding-stack"]);
  });
});