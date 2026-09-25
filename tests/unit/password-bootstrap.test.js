import { describe, expect, it } from "vitest";
import { getInitialPassword, isPlaceholderPassword, isStrongInitialPassword } from "../../src/lib/auth/password.js";

describe("initial dashboard password bootstrap", () => {
  it("keeps the local development fallback", () => {
    expect(getInitialPassword({ NODE_ENV: "development" })).toBe("123456");
  });

  it("keeps the 123456 fallback for new users in every environment", () => {
    expect(getInitialPassword({ NODE_ENV: "production" })).toBe("123456");
    expect(getInitialPassword({ NODE_ENV: "production", INITIAL_PASSWORD: "123456" })).toBe("123456");
  });

  it("rejects other weak production overrides", () => {
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

  it("validates strong reset passwords with the production policy", () => {
    expect(isStrongInitialPassword("a-long-random-password")).toBe(true);
    expect(isStrongInitialPassword("123456")).toBe(false);
    expect(isStrongInitialPassword("short")).toBe(false);
    expect(isStrongInitialPassword("change-me-in-production")).toBe(false);
  });
});
