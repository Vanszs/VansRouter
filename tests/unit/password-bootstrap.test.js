import { describe, expect, it } from "vitest";
import { getInitialPassword, isPlaceholderPassword } from "../../src/lib/auth/password.js";

describe("initial dashboard password bootstrap", () => {
  it("keeps the local development fallback", () => {
    expect(getInitialPassword({ NODE_ENV: "development" })).toBe("123456");
  });

  it("does not accept known placeholders in production", () => {
    expect(getInitialPassword({ NODE_ENV: "production" })).toBeNull();
    expect(getInitialPassword({ NODE_ENV: "production", INITIAL_PASSWORD: "123456" })).toBeNull();
    expect(getInitialPassword({ NODE_ENV: "production", INITIAL_PASSWORD: "change-me-in-production" })).toBeNull();
    expect(getInitialPassword({ NODE_ENV: "production", INITIAL_PASSWORD: "short" })).toBeNull();
  });

  it("accepts an explicitly configured production password", () => {
    expect(getInitialPassword({
      NODE_ENV: "production",
      INITIAL_PASSWORD: "a-long-random-password",
    })).toBe("a-long-random-password");
  });

  it("identifies placeholder values consistently", () => {
    expect(isPlaceholderPassword("123456")).toBe(true);
    expect(isPlaceholderPassword("correct-horse-battery-staple")).toBe(false);
  });
});
