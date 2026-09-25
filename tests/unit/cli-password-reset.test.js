import fs from "node:fs";
import { describe, expect, it } from "vitest";

describe("CLI password reset contract", () => {
  it("prompts for a masked replacement password instead of resetting to the default", () => {
    const menu = fs.readFileSync("cli/src/cli/menus/settings.js", "utf8");
    const client = fs.readFileSync("cli/src/cli/api/client.js", "utf8");

    expect(menu).toContain('require("../utils/input")');
    expect(menu).toContain("promptSecret(");
    expect(menu).toContain("newPassword");
    expect(menu).not.toContain("DEFAULT_PASSWORD");
    expect(client).toContain("async function resetPassword(newPassword)");
    expect(client).toContain("newPassword");
  });
});
