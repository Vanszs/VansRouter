// OpenCode Free's modelsFetcher must parse dict-shaped catalogues while keeping
// only the explicitly verified available model IDs.
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { fetchModelsFetcherIds } from "../../src/sse/services/allowedModels.js";

describe("fetchModelsFetcherIds", () => {
  const originalFetch = globalThis.fetch;
  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("filters OpenCode Free dict results to tested available IDs", async () => {
    const pid = "opencode-dict-test";
    globalThis.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        [pid]: {
          id: pid,
          models: {
            "big-pickle": { id: "big-pickle" },
            "beam-free": { id: "beam-free" },
            "mimo-v2.6-flash-free": { id: "mimo-v2.6-flash-free" },
            "nemotron-3.5-super-vl-free": { id: "nemotron-3.5-super-vl-free" },
            "nemotron-3.5-lightning-free": { id: "nemotron-3.5-lightning-free" },
            "jev-1.13-free": { id: "jev-1.13-free" },
            "longcat-2.5-preview-free": { id: "longcat-2.5-preview-free" },
            "deepseek-v4.1-flash-free": { id: "deepseek-v4.1-flash-free" },
            "glm-5.3-flash-free": { id: "glm-5.3-flash-free" },
            "space-bunny-free": { id: "space-bunny-free" },
            "minimax-m3.1-flash-free": { id: "minimax-m3.1-flash-free" },
            "claude-sonnet-4-6": { id: "claude-sonnet-4-6" },
          },
        },
      }),
    });

    const ids = await fetchModelsFetcherIds(pid, {
      id: pid,
      alias: "oc",
      modelsFetcher: { url: "https://models.dev/api.json", type: "opencode-free" },
    });

    expect(ids.sort()).toEqual([
      "beam-free",
      "mimo-v2.6-flash-free",
      "nemotron-3.5-super-vl-free",
      "nemotron-3.5-lightning-free",
      "deepseek-v4.1-flash-free",
      "glm-5.3-flash-free",
      "minimax-m3.1-flash-free",
    ].sort());
  });

  it("still supports array shapes", async () => {
    const pid = "generic-array-test";
    globalThis.fetch.mockResolvedValue({
      ok: true,
      json: async () => [{ id: "model-a" }, { id: "model-b" }],
    });

    const ids = await fetchModelsFetcherIds(pid, {
      id: pid,
      modelsFetcher: { url: "https://x/models", type: "generic" },
    });

    expect(ids).toContain("model-a");
    expect(ids).toContain("model-b");
  });
});
