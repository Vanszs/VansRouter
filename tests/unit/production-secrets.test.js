import fs from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { assertProductionSecrets } = require("../../runtime-secrets.cjs");

describe("production secret policy", () => {
  it("rejects known placeholder secrets in production", () => {
    expect(() => assertProductionSecrets({
      NODE_ENV: "production",
      JWT_SECRET: "change-me-to-a-long-random-secret",
      API_KEY_SECRET: "change-me-in-production",
    })).toThrow(/JWT_SECRET|API_KEY_SECRET/);
  });

  it("allows generated or explicitly strong secrets", () => {
    expect(() => assertProductionSecrets({
      NODE_ENV: "production",
      JWT_SECRET: "a-long-random-jwt-secret",
      API_KEY_SECRET: "a-long-random-api-secret",
    })).not.toThrow();
    expect(() => assertProductionSecrets({ NODE_ENV: "development" })).not.toThrow();
  });

  it("keeps the env template free of known production placeholders", () => {
    const envExample = fs.readFileSync(".env.example", "utf8");
    expect(envExample).not.toContain("change-me-to-a-long-random-secret");
    expect(envExample).not.toContain("change-me-in-production");
  });

  it("runs the policy before either production launcher requires the app", () => {
    expect(fs.readFileSync("custom-server.js", "utf8")).toContain("assertProductionSecrets");
    expect(fs.readFileSync("server.js", "utf8")).toContain("assertProductionSecrets");
  });
});
