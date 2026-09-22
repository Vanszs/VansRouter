import { describe, expect, it } from "vitest";
import { resolveCursorUpstreamModel } from "../../open-sse/executors/cursor.js";

// Cursor returns an empty completion for placeholders/legacy ids, so the executor
// must resolve them before building the protobuf body.
describe("Cursor upstream model resolution", () => {
  it("maps the default/auto placeholders to a real upstream model", () => {
    expect(resolveCursorUpstreamModel("cu/default")).toBe("claude-4.5-sonnet");
    expect(resolveCursorUpstreamModel("cu/auto")).toBe("claude-4.5-sonnet");
    expect(resolveCursorUpstreamModel("default")).toBe("claude-4.5-sonnet");
  });

  it("maps legacy aliases and strips date suffixes", () => {
    expect(resolveCursorUpstreamModel("cu/gpt-4o")).toBe("gpt-5.2");
    expect(resolveCursorUpstreamModel("cu/claude-3-5-sonnet-20240620")).toBe("claude-4.5-sonnet");
    expect(resolveCursorUpstreamModel("cu/claude-3-5-haiku")).toBe("claude-4.5-haiku");
  });

  it("passes current model ids through unchanged", () => {
    expect(resolveCursorUpstreamModel("cu/composer-1")).toBe("composer-1");
    expect(resolveCursorUpstreamModel("cu/claude-4.6-opus-max")).toBe("claude-4.6-opus-max");
    expect(resolveCursorUpstreamModel("cursor/claude-4.5-sonnet")).toBe("claude-4.5-sonnet");
  });
});
