import { describe, expect, it } from "vitest";
import { isVersionFetchBackedOff } from "../../src/app/api/version/route.js";

describe("npm version cache backoff", () => {
  it("backs off after a failed refresh even when an older value exists", () => {
    const now = 1_000_000;
    expect(isVersionFetchBackedOff({ value: "0.91.33", lastFailureAt: now - 1_000 }, now)).toBe(true);
  });

  it("allows a refresh after the failure backoff expires", () => {
    const now = 1_000_000;
    expect(isVersionFetchBackedOff({ value: "0.91.33", lastFailureAt: now - 30_001 }, now)).toBe(false);
  });
});
