import { describe, expect, it } from "vitest";
import { getProviderAuthTypes } from "../../src/shared/utils/providerAuth.js";
import REGISTRY from "../../open-sse/providers/registry/index.js";
import { OAUTH_PROVIDERS, FREE_PROVIDERS } from "@/shared/constants/config";

describe("provider auth types", () => {
  it("uses declared auth modes for Kimchi OAuth and API-key connections", () => {
    expect(
      getProviderAuthTypes({ hasOAuth: true, authModes: ["apikey", "oauth"] }),
    ).toEqual(["apikey", "oauth"]);
  });


  it("uses declared modes for Kimi dual auth", () => {
    expect(
      getProviderAuthTypes({ hasOAuth: true, authModes: ["oauth", "apikey"] }),
    ).toEqual(["oauth", "apikey"]);
  });

  it("declares Kiro dual auth in the registry", () => {
    const kiro = REGISTRY.find(({ id }) => id === "kiro");
    expect(kiro?.authModes).toEqual(["oauth", "apikey"]);
    expect(getProviderAuthTypes(kiro)).toEqual(["oauth", "apikey"]);
  });

  it("falls back to the provider OAuth capability", () => {
    expect(getProviderAuthTypes({ hasOAuth: true })).toEqual(["oauth"]);
    expect(getProviderAuthTypes({})).toEqual(["apikey"]);
  });

  it("every OAuth-category provider resolves to oauth", () => {
    for (const [id, info] of Object.entries(OAUTH_PROVIDERS)) {
      expect(getProviderAuthTypes(info), id).toContain("oauth");
    }
  });

  it("free providers with an OAuth flow resolve to oauth", () => {
    for (const id of ["freebuff", "gemini-cli", "kiro"]) {
      expect(getProviderAuthTypes(FREE_PROVIDERS[id]), id).toContain("oauth");
    }
  });

  it("declares Cloudflare API-key authentication", () => {
    const cloudflare = REGISTRY.find(({ id }) => id === "cloudflare-ai");
    expect(cloudflare?.authType).toBe("apikey");
    expect(cloudflare?.authModes).toEqual(["apikey"]);
  });
});
