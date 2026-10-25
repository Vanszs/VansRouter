import { describe, it, expect } from "vitest";
import { testOAuthConnection } from "../../src/app/api/providers/[id]/test/testUtils.js";

// CodeBuddy access tokens are JWTs. The tokenExists strategy used to skip the
// exp check, so an expired manually-pasted token reported as accepted (#161).
const CODEBUDDY_PROVIDERS = ["codebuddy-cn", "codebuddy-intl"];
const EXPIRED_ERROR = "CodeBuddy access token expired. Please re-connect your CodeBuddy account.";

function makeJwt(payload) {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${header}.${body}.signature`;
}

describe.each(CODEBUDDY_PROVIDERS)("testOAuthConnection - %s token expiry", (provider) => {
  it("returns invalid when the JWT exp is in the past (seconds)", async () => {
    const token = makeJwt({ sub: "user-123", exp: Math.floor(Date.now() / 1000) - 3600 });
    const result = await testOAuthConnection({ provider, accessToken: token });
    expect(result).toEqual({ valid: false, error: EXPIRED_ERROR });
  });

  it("returns invalid when the JWT exp is in the past (milliseconds)", async () => {
    const token = makeJwt({ sub: "user-123", exp: Date.now() - 3600000 });
    const result = await testOAuthConnection({ provider, accessToken: token });
    expect(result).toEqual({ valid: false, error: EXPIRED_ERROR });
  });

  it("returns valid when the JWT exp is in the future", async () => {
    const token = makeJwt({ sub: "user-123", exp: Math.floor(Date.now() / 1000) + 3600 });
    const result = await testOAuthConnection({ provider, accessToken: token });
    expect(result).toEqual({ valid: true, error: null, refreshed: false, newTokens: null });
  });

  it("returns valid for a non-JWT opaque token (documented fall-through)", async () => {
    const result = await testOAuthConnection({ provider, accessToken: "opaque-codebuddy-token" });
    expect(result).toEqual({ valid: true, error: null, refreshed: false, newTokens: null });
  });
});
