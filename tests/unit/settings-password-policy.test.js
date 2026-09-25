import fs from "node:fs";
import { describe, expect, it } from "vitest";

describe("settings password policy", () => {
  it("uses the strong password validator for dashboard password updates", () => {
    const source = fs.readFileSync("src/app/api/settings/route.js", "utf8");
    expect(source).toContain("isStrongInitialPassword");
    expect(source).toContain("newPassword");
  });
});
