import { describe, expect, it, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Custom-compatible node models are keyed by the node's own id in both the
// customModels and disabledModels kv scopes, while buildModelsList also knows
// the provider only by its short alias. Disabling a model from the dashboard
// therefore wrote `<node-id>` into disabledModels, and the list builder checked
// only the alias — so the disable never took effect. (upstream a8f63f4d)
describe("disabled-model lookups cover the provider id as well as the alias", () => {
  const src = readFileSync(resolve(process.cwd(), "src/sse/services/allowedModels.js"), "utf8");

  it("checks providerId for static provider models", () => {
    const block = src.slice(src.indexOf("for (const model of providerModels)"));
    expect(block.slice(0, 400)).toMatch(/isDisabled\(alias, model\.id\) \|\| isDisabled\(providerId, model\.id\)/);
  });

  it("checks providerId for custom/alias model ids", () => {
    expect(src).toMatch(/isDisabled\(outputAlias, modelId\) \|\| isDisabled\(staticAlias, modelId\) \|\| isDisabled\(providerId, modelId\)/);
  });
});

describe("deleteProviderNode purges the node's kv rows", () => {
  const src = readFileSync(resolve(process.cwd(), "src/lib/db/repos/nodesRepo.js"), "utf8");

  it("removes customModels rows keyed by the node id", () => {
    expect(src).toMatch(/DELETE FROM kv WHERE scope = 'customModels' AND key LIKE \?/);
  });

  it("removes the node's disabledModels row", () => {
    expect(src).toMatch(/DELETE FROM kv WHERE scope = 'disabledModels' AND key = \?/);
  });
});
