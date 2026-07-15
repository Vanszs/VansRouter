import { describe, expect, it } from "vitest";

import REGISTRY from "../../open-sse/providers/registry/index.js";
import { PROVIDERS, PROVIDER_MODELS } from "../../open-sse/providers/index.js";
import { getExecutor } from "../../open-sse/executors/index.js";

describe("Muse Spark Web provider", () => {
  const muse = REGISTRY.find((e) => e.id === "muse-spark-web");

  it("is registered as a webCookie provider", () => {
    expect(muse).toBeDefined();
    expect(muse.category).toBe("webCookie");
    expect(muse.transport.baseUrl).toBe("https://www.meta.ai/api/graphql");
    expect(muse.alias).toBe("muse-spark-web");
    expect(muse.aliases).toContain("muse");
  });

  it("builds into the runtime PROVIDERS map with the muse-spark-web format", () => {
    expect(PROVIDERS["muse-spark-web"]).toBeDefined();
    expect(PROVIDERS["muse-spark-web"].format).toBe("muse-spark-web");
    expect(PROVIDERS["muse-spark-web"].baseUrl).toBe("https://www.meta.ai/api/graphql");
  });

  it("exposes its seed models", () => {
    const ids = (PROVIDER_MODELS["muse-spark-web"] || []).map((m) => m.id);
    expect(ids.length).toBe(3);
    expect(ids).toContain("muse-spark");
    expect(ids).toContain("muse-spark-thinking");
    expect(ids).toContain("muse-spark-contemplating");
  });

  it("keeps every registry id unique after adding muse-spark-web", () => {
    const ids = REGISTRY.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("has a specialized executor registered", () => {
    const executor = getExecutor("muse-spark-web");
    expect(executor).toBeDefined();
    expect(executor.constructor.name).toBe("MuseSparkWebExecutor");
  });
});
