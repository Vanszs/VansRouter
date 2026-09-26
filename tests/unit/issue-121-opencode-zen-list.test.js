// Issue #121: "OpenCode Zen doesn't appear in the API provider list".
// AI_PROVIDERS is derived from the registry through byCategory(), so a provider
// surfaces when its registry entry carries a listed category and is not hidden.
// opencode-zen declares category "apikey" and no hidden flag, so it is listed.
import { describe, it, expect } from "vitest";
import { AI_PROVIDERS, APIKEY_PROVIDERS, ID_TO_ALIAS } from "@/shared/constants/providers.js";

describe("issue #121 — opencode-zen in the provider list", () => {
  it("is present in AI_PROVIDERS", () => {
    expect(AI_PROVIDERS["opencode-zen"]).toBeDefined();
  });

  it("is exposed as an API-key provider and is not hidden", () => {
    expect(APIKEY_PROVIDERS["opencode-zen"]).toBeDefined();
    expect(APIKEY_PROVIDERS["opencode-zen"].hidden).toBeFalsy();
  });

  it("keeps the ocz alias so /v1/models ids stay routable", () => {
    expect(ID_TO_ALIAS["opencode-zen"]).toBe("ocz");
  });

  it("sits next to the other two opencode lanes", () => {
    for (const id of ["opencode", "opencode-go", "opencode-zen"]) {
      expect(AI_PROVIDERS[id], id).toBeDefined();
    }
  });
});
