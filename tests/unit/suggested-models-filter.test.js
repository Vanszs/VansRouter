import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { FILTERS } from "@/app/api/providers/suggested-models/filters.js";

const suggest = (ids) => FILTERS["opencode-free"](ids.map((id) => ({ id }))).map((m) => m.id);

describe("opencode-free suggestion filter", () => {
  it("offers only the curated available models", () => {
    const available = [
      "beam-free",
      "mimo-v2.6-flash-free",
      "nemotron-3.5-super-vl-free",
      "nemotron-3.5-lightning-free",
      "deepseek-v4.1-flash-free",
      "glm-5.3-flash-free",
      "minimax-m3.1-flash-free",
    ];
    expect(suggest([
      "big-pickle",
      ...available,
      "space-bunny-free",
      "hy3-free",
      "gpt-4o",
    ])).toEqual(available);
  });

  it("filters deprecated and non-available ids", () => {
    expect(suggest(["space-bunny-free", "big-pickle", "minimax-m3.1-flash-free", "gpt-4o", "claude-3"])).toEqual([
      "minimax-m3.1-flash-free",
    ]);
  });

  it("has no hardcoded exclusion list left to go stale", () => {
    const src = readFileSync(new URL("../../src/app/api/providers/suggested-models/filters.js", import.meta.url), "utf8");
    expect(src).not.toMatch(/DEAD_FREE/);
  });

  it("tolerates a missing id rather than throwing", () => {
    expect(suggest([undefined, "minimax-m3.1-flash-free"])).toEqual(["minimax-m3.1-flash-free"]);
  });
});
