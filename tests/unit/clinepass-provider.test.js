import { describe, it, expect } from "vitest";
import clinepass from "../../open-sse/providers/registry/clinepass.js";
import REGISTRY from "../../open-sse/providers/registry/index.js";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";

describe("ClinePass provider (b08751c4)", () => {
  it("is registered in the provider registry", () => {
    const found = REGISTRY.find((p) => p.id === "clinepass");
    expect(found).toBeTruthy();
    expect(found.alias).toBe("clinepass");
  });

  it("exports the expected provider shape", () => {
    expect(clinepass.id).toBe("clinepass");
    expect(clinepass.priority).toBeGreaterThan(0);
    expect(clinepass.category).toBe("oauth");
    expect(clinepass.authModes).toContain("oauth");
    expect(clinepass.authModes).toContain("apikey");
    expect(clinepass.hasOAuth).toBe(true);
    expect(clinepass.transport.baseUrl).toMatch(/cline\.bot/);
  });

  it("has 10 curated models", () => {
    expect(clinepass.models).toHaveLength(10);
    const ids = clinepass.models.map((m) => m.id);
    expect(ids).toContain("cline-pass/glm-5.2");
    expect(ids).toContain("cline-pass/kimi-k2.7-code");
    expect(ids).toContain("cline-pass/minimax-m3");
  });

  it("has OAuth endpoints configured", () => {
    expect(clinepass.oauth.authorizeUrl).toMatch(/cline\.bot/);
    expect(clinepass.oauth.tokenUrl).toMatch(/cline\.bot/);
    expect(clinepass.oauth.refreshUrl).toMatch(/cline\.bot/);
  });

  it("has reasoning capabilities mapped for its models", () => {
    const cap = getCapabilitiesForModel("clinepass", "cline-pass/glm-5.2");
    expect(cap).toBeTruthy();
    expect(cap.reasoning).toBe(true);
  });
});
