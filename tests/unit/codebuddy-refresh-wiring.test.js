import { describe, expect, it } from "vitest";
import { DefaultExecutor } from "../../open-sse/executors/default.js";

// CodeBuddy access tokens live ~1 year, so shouldRefreshCredentials never fires
// for them: the pre-flight expiry check cannot rescue a connection whose token
// was revoked or rejected. The executor-level 401/403 retry in chatCore is the
// only recovery path, and it is a no-op unless refreshCredentials is wired.
// Regression guard for that wiring (issue #161).
describe("CodeBuddy executor refresh wiring", () => {
  for (const provider of ["codebuddy-cn", "codebuddy-intl"]) {
    it(`${provider} exposes a refresh path instead of the base no-op`, async () => {
      const executor = new DefaultExecutor(provider);
      // BaseExecutor.refreshCredentials returns null unconditionally; the wired
      // implementation returns null too when there is no refresh token, so the
      // distinguishing assertion is that the subclass method is not the base one.
      const base = Object.getPrototypeOf(DefaultExecutor.prototype).refreshCredentials;
      expect(executor.refreshCredentials).not.toBe(base);
    });

    it(`${provider} returns null without a refresh token (manual paste must not throw)`, async () => {
      const executor = new DefaultExecutor(provider);
      await expect(executor.refreshCredentials({}, null)).resolves.toBeNull();
      await expect(executor.refreshCredentials({ refreshToken: "" }, null)).resolves.toBeNull();
    });
  }
});
