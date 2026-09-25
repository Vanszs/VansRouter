import { describe, it, expect } from "vitest";

function isProviderAllowed(apiKeyInfo, providerIdOrAlias) {
  if (!apiKeyInfo) return true;
  const allowed = apiKeyInfo.allowedProviders;
  if (allowed === null || allowed === undefined) return true;
  if (!Array.isArray(allowed) || allowed.length === 0) return false;
  return allowed.includes(providerIdOrAlias);
}

function isComboAllowed(apiKeyInfo, comboName) {
  if (!apiKeyInfo) return true;
  const allowed = apiKeyInfo.allowedCombos;
  if (allowed === null || allowed === undefined) return true;
  if (!Array.isArray(allowed) || allowed.length === 0) return false;
  return allowed.includes(comboName);
}

function isKindAllowed(apiKeyInfo, kind) {
  if (!apiKeyInfo) return true;
  const allowed = apiKeyInfo.allowedKinds;
  if (allowed === null || allowed === undefined) return true;
  if (!Array.isArray(allowed) || allowed.length === 0) return false;
  return allowed.includes(kind);
}

function extractApiKey(request) {
  const authHeader = request.headers.get("Authorization");
  if (authHeader?.startsWith("Bearer ")) return authHeader.slice(7);
  const xApiKey = request.headers.get("x-api-key");
  if (xApiKey) return xApiKey;
  return null;
}

const ALL_KINDS = ["llm", "embedding", "image", "tts", "stt", "web"];
const ALL_PROVIDERS = ["glm", "minimax", "kiro", "openai", "anthropic", "codex", "gemini-cli"];
const ALL_COMBOS = ["coding-stack", "free-forever", "premium-stack"];

describe("extractApiKey security", () => {
  const makeReq = (headers) => ({ headers: { get: (k) => headers[k] || null } });

  it("Bearer header extracted correctly", () => expect(extractApiKey(makeReq({ Authorization: "Bearer sk-test" }))).toBe("sk-test"));
  it("x-api-key header extracted correctly", () => expect(extractApiKey(makeReq({ "x-api-key": "sk-xapi" }))).toBe("sk-xapi"));
  it("Bearer preferred over x-api-key", () => expect(extractApiKey(makeReq({ Authorization: "Bearer sk-bearer", "x-api-key": "sk-xapi" }))).toBe("sk-bearer"));
  it("null when no auth headers", () => expect(extractApiKey(makeReq({}))).toBeNull());
  it("null for Basic auth (not Bearer)", () => expect(extractApiKey(makeReq({ Authorization: "Basic abc" }))).toBeNull());
  it("empty string for 'Bearer ' with no value", () => expect(extractApiKey(makeReq({ Authorization: "Bearer " }))).toBe(""));
});

describe("isProviderAllowed - 3-tier ACL", () => {
  it("null apiKeyInfo = unrestricted", () => {
    for (const p of ALL_PROVIDERS) expect(isProviderAllowed(null, p)).toBe(true);
  });

  it("allowedProviders=null = all allowed", () => {
    for (const p of ALL_PROVIDERS) expect(isProviderAllowed({ allowedProviders: null }, p)).toBe(true);
  });

  it("allowedProviders=[] = none allowed", () => {
    for (const p of ALL_PROVIDERS) expect(isProviderAllowed({ allowedProviders: [] }, p)).toBe(false);
  });

  it("allowedProviders=[glm,minimax] = only those allowed", () => {
    expect(isProviderAllowed({ allowedProviders: ["glm", "minimax"] }, "glm")).toBe(true);
    expect(isProviderAllowed({ allowedProviders: ["glm", "minimax"] }, "minimax")).toBe(true);
    expect(isProviderAllowed({ allowedProviders: ["glm", "minimax"] }, "openai")).toBe(false);
    expect(isProviderAllowed({ allowedProviders: ["glm", "minimax"] }, "kiro")).toBe(false);
  });
});

describe("isComboAllowed - 3-tier ACL", () => {
  it("null apiKeyInfo = unrestricted", () => {
    for (const c of ALL_COMBOS) expect(isComboAllowed(null, c)).toBe(true);
  });

  it("allowedCombos=null = all allowed", () => {
    for (const c of ALL_COMBOS) expect(isComboAllowed({ allowedCombos: null }, c)).toBe(true);
  });

  it("allowedCombos=[] = none allowed", () => {
    for (const c of ALL_COMBOS) expect(isComboAllowed({ allowedCombos: [] }, c)).toBe(false);
  });

  it("allowedCombos=[coding-stack] = only that allowed", () => {
    expect(isComboAllowed({ allowedCombos: ["coding-stack"] }, "coding-stack")).toBe(true);
    expect(isComboAllowed({ allowedCombos: ["coding-stack"] }, "free-forever")).toBe(false);
  });

  it("combo names must match exactly (case-sensitive)", () => {
    expect(isComboAllowed({ allowedCombos: ["coding-stack"] }, "Coding-Stack")).toBe(false);
    expect(isComboAllowed({ allowedCombos: ["coding-stack"] }, "coding-stack-v2")).toBe(false);
  });
});

describe("isKindAllowed - 3-tier ACL", () => {
  it("null apiKeyInfo = unrestricted", () => {
    for (const k of ALL_KINDS) expect(isKindAllowed(null, k)).toBe(true);
  });

  it("allowedKinds=null = all allowed", () => {
    for (const k of ALL_KINDS) expect(isKindAllowed({ allowedKinds: null }, k)).toBe(true);
  });

  it("allowedKinds=[] = none allowed (complete lockout)", () => {
    for (const k of ALL_KINDS) expect(isKindAllowed({ allowedKinds: [] }, k)).toBe(false);
  });

  it("allowedKinds=[llm] = only LLM allowed, all others blocked", () => {
    expect(isKindAllowed({ allowedKinds: ["llm"] }, "llm")).toBe(true);
    expect(isKindAllowed({ allowedKinds: ["llm"] }, "embedding")).toBe(false);
    expect(isKindAllowed({ allowedKinds: ["llm"] }, "image")).toBe(false);
    expect(isKindAllowed({ allowedKinds: ["llm"] }, "tts")).toBe(false);
    expect(isKindAllowed({ allowedKinds: ["llm"] }, "stt")).toBe(false);
    expect(isKindAllowed({ allowedKinds: ["llm"] }, "web")).toBe(false);
  });

  it("allowedKinds=[llm,web] = LLM + web allowed", () => {
    expect(isKindAllowed({ allowedKinds: ["llm", "web"] }, "llm")).toBe(true);
    expect(isKindAllowed({ allowedKinds: ["llm", "web"] }, "web")).toBe(true);
    expect(isKindAllowed({ allowedKinds: ["llm", "web"] }, "image")).toBe(false);
  });

  it("allowedKinds=[llm,embedding,image] = selective multi-kind", () => {
    expect(isKindAllowed({ allowedKinds: ["llm", "embedding", "image"] }, "llm")).toBe(true);
    expect(isKindAllowed({ allowedKinds: ["llm", "embedding", "image"] }, "embedding")).toBe(true);
    expect(isKindAllowed({ allowedKinds: ["llm", "embedding", "image"] }, "image")).toBe(true);
    expect(isKindAllowed({ allowedKinds: ["llm", "embedding", "image"] }, "tts")).toBe(false);
  });
});

describe("ACL bypass attack scenarios", () => {
  it("cannot bypass provider restriction by using different provider ID", () => {
    const key = { allowedProviders: ["glm"] };
    expect(isProviderAllowed(key, "openai")).toBe(false);
    expect(isProviderAllowed(key, "anthropic")).toBe(false);
    expect(isProviderAllowed(key, "codex")).toBe(false);
  });

  it("cannot bypass kind restriction by requesting different service", () => {
    const key = { allowedKinds: ["llm"] };
    expect(isKindAllowed(key, "image")).toBe(false);
    expect(isKindAllowed(key, "tts")).toBe(false);
    expect(isKindAllowed(key, "stt")).toBe(false);
  });

  it("cannot bypass combo restriction by using different combo name", () => {
    const key = { allowedCombos: ["coding-stack"] };
    expect(isComboAllowed(key, "free-forever")).toBe(false);
    expect(isComboAllowed(key, "premium-stack")).toBe(false);
  });

  it("undefined ACL field = all allowed (safe default)", () => {
    const key = { allowedProviders: undefined, allowedCombos: undefined, allowedKinds: undefined };
    expect(isProviderAllowed(key, "anything")).toBe(true);
    expect(isComboAllowed(key, "anything")).toBe(true);
    expect(isKindAllowed(key, "anything")).toBe(true);
  });

  it("empty array ACL = complete lockdown", () => {
    const key = { allowedProviders: [], allowedCombos: [], allowedKinds: [] };
    expect(isProviderAllowed(key, "glm")).toBe(false);
    expect(isComboAllowed(key, "coding-stack")).toBe(false);
    expect(isKindAllowed(key, "llm")).toBe(false);
  });

  it("mixed ACL: some restricted, some open", () => {
    const key = { allowedProviders: ["glm"], allowedCombos: null, allowedKinds: ["llm"] };
    expect(isProviderAllowed(key, "glm")).toBe(true);
    expect(isProviderAllowed(key, "openai")).toBe(false);
    expect(isComboAllowed(key, "any-combo")).toBe(true);
    expect(isKindAllowed(key, "llm")).toBe(true);
    expect(isKindAllowed(key, "image")).toBe(false);
  });
});

describe("apiKeyInfo edge cases", () => {
  it("missing object = null behavior (no key provided)", () => {
    expect(isProviderAllowed(null, "glm")).toBe(true);
    expect(isComboAllowed(null, "combo")).toBe(true);
    expect(isKindAllowed(null, "llm")).toBe(true);
  });

  it("apiKeyInfo with only name/id (no ACL fields) = unrestricted", () => {
    const key = { id: "key-1", name: "my-key" };
    expect(isProviderAllowed(key, "glm")).toBe(true);
    expect(isComboAllowed(key, "coding-stack")).toBe(true);
    expect(isKindAllowed(key, "llm")).toBe(true);
  });

  it("full apiKeyInfo with all ACL fields = correctly restricted", () => {
    const key = {
      id: "key-1",
      name: "restricted-key",
      allowedProviders: ["glm", "minimax"],
      allowedCombos: ["coding-stack"],
      allowedKinds: ["llm", "embedding"],
    };
    expect(isProviderAllowed(key, "glm")).toBe(true);
    expect(isProviderAllowed(key, "openai")).toBe(false);
    expect(isComboAllowed(key, "coding-stack")).toBe(true);
    expect(isComboAllowed(key, "other")).toBe(false);
    expect(isKindAllowed(key, "llm")).toBe(true);
    expect(isKindAllowed(key, "image")).toBe(false);
  });
});