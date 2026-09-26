// Post-merge verification tests for conflicted files.
// Ensures upstream merge didn't silently strip our custom logic.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "../..");
const read = (p) => readFileSync(resolve(ROOT, p), "utf8");

describe("Post-merge: chat.js ACL enforcement preserved", () => {
  const src = read("src/sse/handlers/chat.js");

  it("imports isKindAllowed from auth.js", () => {
    expect(src).toContain("isKindAllowed");
  });

  it("imports isProviderAllowed from auth.js", () => {
    expect(src).toContain("isProviderAllowed");
  });

  it("imports isComboAllowed from auth.js", () => {
    expect(src).toContain("isComboAllowed");
  });

  it("imports isTrustedInternalRequest", () => {
    expect(src).toContain("isTrustedInternalRequest");
  });

  it("imports isModelAllowed from allowedModels.js", () => {
    expect(src).toContain("isModelAllowed");
    expect(src).toContain("allowedModels.js");
  });

  it("propagates apiKeyInfo to the model ACL and the combo handlers", () => {
    // isModelAllowed must receive the key's ACL context, or a restricted key
    // could use any model. Counting `apiKeyInfo)` occurrences was a proxy for
    // that and broke the moment the ACL check became a candidate loop.
    expect(src).toMatch(/isModelAllowed\(\s*c\s*,\s*apiKeyInfo\s*\)/);
    expect(src).toMatch(/isProviderAllowed\(apiKeyInfo/);
  });

  it("checks isKindAllowed for 'llm' kind", () => {
    expect(src).toMatch(/isKindAllowed\(.*"llm"\)/);
  });

  it("checks isProviderAllowed after model resolution", () => {
    expect(src).toMatch(/isProviderAllowed\(apiKeyInfo.*provider\)/);
  });

  it("returns 403 FORBIDDEN for ACL denials", () => {
    expect(src).toContain("FORBIDDEN");
  });

  it("also has upstream isPanel fix for combo/fusion", () => {
    expect(src).toContain("isPanel");
    expect(src).toContain("cleanRawReq");
  });
});

describe("Post-merge: models/route.js ACL filter preserved", () => {
  const src = read("src/app/api/v1/models/route.js");

  it("imports ACL functions", () => {
    expect(src).toContain("isValidApiKey");
    expect(src).toContain("extractApiKey");
    expect(src).toContain("isProviderAllowed");
    expect(src).toContain("isComboAllowed");
  });

  it("imports getSettings from localDb", () => {
    expect(src).toContain("getSettings");
    expect(src).toContain("localDb");
  });

  it("imports stripComboPrefix from combo.js", () => {
    expect(src).toContain("stripComboPrefix");
  });

  it("imports capabilitiesFromServiceKind (upstream)", () => {
    expect(src).toContain("capabilitiesFromServiceKind");
  });

  it("GET handler validates API key before returning models", () => {
    // Must call isValidApiKey inside GET handler, not just import it
    const getHandler = src.slice(src.indexOf("export async function GET(request)"));
    expect(getHandler).toContain("isValidApiKey(apiKey)");
  });

  it("GET handler filters models by isProviderAllowed and isComboAllowed", () => {
    const getHandler = src.slice(src.indexOf("export async function GET(request)"));
    expect(getHandler).toContain("isProviderAllowed(apiKeyInfo");
    expect(getHandler).toContain("isComboAllowed(apiKeyInfo");
    expect(getHandler).toContain("data.filter(");
  });
});

describe("Post-merge: model.js RESERVED_PROVIDER_PREFIXES works", () => {
  const src = read("src/sse/services/model.js");

  it("has RESERVED_PROVIDER_PREFIXES from upstream", () => {
    expect(src).toContain("RESERVED_PROVIDER_PREFIXES");
  });

  it("still has LOCAL_PROVIDER_ALIASES (xmtp)", () => {
    expect(src).toContain("LOCAL_PROVIDER_ALIASES");
    expect(src).toContain("xmtp");
    expect(src).toContain("xiaomi-tokenplan");
  });

  it("guards provider nodes against built-in provider IDs", () => {
    expect(src).toContain("RESERVED_PROVIDER_PREFIXES.has(parsed.providerAlias)");
  });

  it("imports REGISTRY for reserved prefix building", () => {
    expect(src).toContain("open-sse/providers/registry/index.js");
  });

  it("exports parseModel and resolveModelAlias", () => {
    expect(src).toContain("export function parseModel");
    expect(src).toContain("export async function resolveModelAlias");
  });
});

describe("Post-merge: layout.js VansAI branding preserved", () => {
  const src = read("src/app/layout.js");

  it("has VansAI title", () => {
    expect(src).toContain("VansAI");
  });

  it("bundles Material Symbols locally without fragile CDN scripts", () => {
    expect(src).toContain('localFont({');
    expect(src).toContain('material-symbols-outlined-subset.woff2');
    expect(src).not.toContain("fonts.googleapis.com");
  });

  it("does NOT have upstream 9Router title", () => {
    // Should not contain "9Router - AI Infrastructure"
    const titleMatch = src.match(/title:\s*["']([^"']+)["']/);
    expect(titleMatch[1]).toContain("VansAI");
    expect(titleMatch[1]).not.toContain("9Router");
  });
});

describe("Post-merge: kiroConstants.js upstream exports taken", () => {
  const src = read("open-sse/config/kiroConstants.js");

  it("exports KIRO_AGENTIC_SUFFIX", () => {
    expect(src).toContain("export const KIRO_AGENTIC_SUFFIX");
  });

  it("exports KIRO_THINKING_SUFFIX", () => {
    expect(src).toContain("export const KIRO_THINKING_SUFFIX");
  });

  it("imports thinking functions (upstream fix)", () => {
    expect(src).toContain("extractThinking");
    expect(src).toContain("effortToBudget");
  });
});

describe("Post-merge: xiaomi-tokenplan.js upstream fix taken", () => {
  const src = read("open-sse/executors/xiaomi-tokenplan.js");

  it("always routes to /chat/completions (upstream fix)", () => {
    expect(src).toContain("/chat/completions");
  });

  it("Claude routing is commented out (Token Plan is OpenAI-compat only)", () => {
    // The Claude routing should be commented out per upstream fix
    expect(src).toMatch(/\/\/.*getModelTargetFormat/);
  });
});

describe("Post-merge: ponytail still wired in chatCore", () => {
  const src = read("open-sse/handlers/chatCore.js");

  it("imports injectPonytail", () => {
    expect(src).toContain("injectPonytail");
  });

  it("has ponytailEnabled parameter", () => {
    expect(src).toContain("ponytailEnabled");
  });

  it("has ponytailLevel parameter", () => {
    expect(src).toContain("ponytailLevel");
  });

  it("calls injectPonytail when enabled", () => {
    expect(src).toMatch(/if\s*\(.*ponytailEnabled.*ponytailLevel\)/);
    expect(src).toContain("injectPonytail(translatedBody, finalFormat, ponytailLevel)");
  });
});

describe("Post-merge: allowRemoteNoApiKey feature intact", () => {
  const guard = read("src/dashboardGuard.js");
  const settings = read("src/lib/db/repos/settingsRepo.js");
  const ui = read("src/app/(dashboard)/dashboard/endpoint/EndpointPageClient.js");

  it("dashboardGuard has canAccessPublicLlmApi", () => {
    expect(guard).toContain("canAccessPublicLlmApi");
  });

  it("dashboardGuard checks allowRemoteNoApiKey", () => {
    expect(guard).toContain("allowRemoteNoApiKey");
  });

  it("settingsRepo has allowRemoteNoApiKey default false", () => {
    expect(settings).toContain("allowRemoteNoApiKey: false");
  });

  it("UI has toggle state", () => {
    expect(ui).toContain("allowRemoteNoApiKey");
    expect(ui).toContain("handleAllowRemoteNoApiKey");
  });

  it("UI shows toggle when requireApiKey is off", () => {
    expect(ui).toContain("!requireApiKey");
    expect(ui).toContain("Allow Remote Access Without API Key");
  });
});

describe("Post-merge: hybrid security guards", () => {
  it("redacts request payloads at the request-details API boundary", () => {
    const src = read("src/app/api/usage/request-details/route.js");
    expect(src).toContain('"providerRequest", "providerResponse", "response"');
    expect(src).toContain("redacted: true");
  });

  // The "remote default-password login must not get a dashboard session" contract is
  // owned by tests/unit/remote-password-bootstrap.test.js, which exercises the route
  // itself. It used to be asserted here by grepping the source for a `status: 403`,
  // which only proved the string existed and broke on every legitimate refactor.

  it("keeps the async search SSRF boundary", () => {
    const callers = read("open-sse/handlers/search/callers.js");
    const dispatcher = read("open-sse/handlers/search/index.js");
    expect(callers).toContain("export async function resolveBaseUrl");
    expect(callers).toContain("await assertPublicUrl(override)");
    expect(dispatcher).toContain("await buildSearchRequest");
  });
});
