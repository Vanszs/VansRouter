import { describe, it, expect } from "vitest";
import {
  buildPresetItems,
  buildCursorPresetItems,
  buildClaudePresetItems,
  isValidComboPresetName,
} from "../../src/lib/comboPresets.js";
import { CLI_TOOLS } from "../../src/shared/constants/cliTools.js";

const claudeTargets = Object.fromEntries(
  (CLI_TOOLS.claude?.defaultModels || [])
    .filter((m) => m?.alias && m?.defaultValue)
    .map((m) => [m.alias, m.defaultValue])
);

describe("combo presets", () => {
  it("rejects combo names with slashes or invalid chars", () => {
    expect(isValidComboPresetName("composer-2.5")).toBe(true);
    expect(isValidComboPresetName("claude-opus-4-8")).toBe(true);
    expect(isValidComboPresetName("cu/composer-2.5")).toBe(false);
    expect(isValidComboPresetName("bad name")).toBe(false);
    expect(isValidComboPresetName("")).toBe(false);
  });

  it("Cursor live ids become unprefixed names seeded with cu/…", () => {
    const items = buildCursorPresetItems({
      liveModels: [
        { id: "composer-2.5", name: "Composer 2.5" },
        { id: "cursor-grok-4.6-high-fast", name: "Grok" },
        { id: "bad/with-slash", name: "Invalid" },
      ],
    });

    expect(items).toEqual([
      { name: "composer-2.5", models: ["cu/composer-2.5"] },
      { name: "cursor-grok-4.6-high-fast", models: ["cu/cursor-grok-4.6-high-fast"] },
    ]);
  });

  it("Cursor falls back to static cu registry when live catalog is empty", () => {
    const items = buildCursorPresetItems({ liveModels: [] });
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((i) => i.models[0].startsWith("cu/"))).toBe(true);
    expect(items.some((i) => i.name === "default")).toBe(true);
    // No slash in combo name
    expect(items.every((i) => !i.name.includes("/"))).toBe(true);
  });

  it("Claude registry models and CLI aliases seed cc/… targets", () => {
    const items = buildClaudePresetItems();
    const byName = Object.fromEntries(items.map((i) => [i.name, i]));

    expect(byName["claude-opus-4-8"]).toEqual({
      name: "claude-opus-4-8",
      models: ["cc/claude-opus-4-8"],
    });
    expect(byName.opusplan).toEqual({
      name: "opusplan",
      models: [claudeTargets.opus],
    });
    expect(byName.default).toEqual({
      name: "default",
      models: [claudeTargets.sonnet],
    });
    for (const alias of Object.keys(claudeTargets)) {
      expect(byName[alias]).toEqual({ name: alias, models: [claudeTargets[alias]] });
    }
    expect(items.every((i) => !i.name.includes("/"))).toBe(true);
  });

  it("marks existing names with exists: true", () => {
    const items = buildPresetItems("cursor", {
      liveModels: [
        { id: "composer-2.5" },
        { id: "gpt-5.3-codex" },
      ],
      existingNames: ["composer-2.5"],
    });

    expect(items).toEqual([
      { name: "composer-2.5", models: ["cu/composer-2.5"], exists: true },
      { name: "gpt-5.3-codex", models: ["cu/gpt-5.3-codex"], exists: false },
    ]);
  });

  it("returns empty for unknown source", () => {
    expect(buildPresetItems("unknown")).toEqual([]);
  });

  it("drops invalid names from Claude/Cursor catalogs", () => {
    const cursor = buildPresetItems("cursor", {
      liveModels: [{ id: "ok-model" }, { id: "no/slash" }, { id: "has space" }],
      existingNames: [],
    });
    expect(cursor.map((i) => i.name)).toEqual(["ok-model"]);
  });
});
