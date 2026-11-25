import { describe, expect, it } from "vitest";
import {
  expandAuthTypes,
  getProviderConnectionStats,
} from "../../src/shared/utils/providerStats.js";
import { getProviderAuthTypes } from "../../src/shared/utils/providerAuth.js";

const kimi = { hasOAuth: true, authModes: ["oauth", "apikey"] };

describe("provider connection stats", () => {
  it("counts every declared auth mode (Kimi: apikey + oauth)", () => {
    const rows = [
      { provider: "kimi", authType: "oauth", isActive: 1, testStatus: "active" },
      { provider: "kimi", authType: "apikey", isActive: 1, testStatus: "unavailable" },
    ];
    expect(
      getProviderConnectionStats(rows, "kimi", getProviderAuthTypes(kimi)),
    ).toMatchObject({ connected: 2, total: 2, error: 0 });
  });

  it("counts legacy api_key rows when the provider declares apikey", () => {
    const rows = [
      { provider: "kiro", authType: "api_key", isActive: 1, testStatus: "active" },
    ];
    expect(getProviderConnectionStats(rows, "kiro", ["apikey"]).connected).toBe(1);
  });

  it("keeps errors out of connected and reports the error tag", () => {
    const rows = [
      {
        provider: "kimi",
        authType: "oauth",
        isActive: 1,
        testStatus: "error",
        lastError: "Invalid API key",
        lastErrorAt: new Date().toISOString(),
      },
    ];
    expect(getProviderConnectionStats(rows, "kimi", ["oauth"])).toMatchObject({
      connected: 0,
      error: 1,
      errorCode: "AUTH",
    });
  });

  it("does not count a model-locked unavailable account as connected", () => {
    const rows = [
      {
        provider: "kimi",
        authType: "apikey",
        isActive: 1,
        testStatus: "unavailable",
        modelLock_kimi_k3: new Date(Date.now() + 60_000).toISOString(),
      },
    ];
    const stats = getProviderConnectionStats(rows, "kimi", ["apikey"]);
    expect(stats.connected).toBe(0);
    expect(stats.error).toBe(1);
  });

  it("marks a provider whose connections are all disabled", () => {
    const rows = [
      { provider: "kimi", authType: "oauth", isActive: false, testStatus: "active" },
      { provider: "kimi", authType: "apikey", isActive: false, testStatus: "active" },
    ];
    expect(
      getProviderConnectionStats(rows, "kimi", ["oauth", "apikey"]),
    ).toMatchObject({ connected: 0, allDisabled: true, total: 2 });
  });

  it("counts an enabled but untested account as connected", () => {
    const rows = [
      { provider: "kimi", authType: "apikey", isActive: 1, testStatus: "unknown" },
    ];
    expect(getProviderConnectionStats(rows, "kimi", ["apikey"])).toMatchObject({
      connected: 1,
      error: 0,
    });
  });

  it("expands apikey to the legacy api_key spelling", () => {
    expect(expandAuthTypes(["apikey"])).toEqual(["apikey", "api_key"]);
    expect(expandAuthTypes("oauth")).toEqual(["oauth"]);
  });
});
