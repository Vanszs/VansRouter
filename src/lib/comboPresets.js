/**
 * Build Cursor / Claude default combo presets.
 * Combo names match client-native model IDs (no provider prefix);
 * each is seeded with the matching prefixed model so routing works.
 */

import { getProviderModels } from "open-sse/config/providerModels.js";
import { CLI_TOOLS } from "@/shared/constants/cliTools";

const VALID_COMBO_NAME_REGEX = /^[a-zA-Z0-9_.\-]+$/;
export const PRESET_SOURCES = new Set(["cursor", "claude"]);

const CURSOR_ALIAS = "cu";
const CLAUDE_ALIAS = "cc";

const CLAUDE_DEFAULT_BY_ALIAS = Object.fromEntries(
  (CLI_TOOLS.claude?.defaultModels || [])
    .filter((m) => m?.alias && m?.defaultValue)
    .map((m) => [m.alias, m.defaultValue])
);

/** Bare Claude Code aliases not listed in defaultModels: plan default / opus-in-plan resolve
 *  to the same targets the CLI is configured with for sonnet and opus. */
const CLAUDE_EXTRA_ALIAS_TARGETS = {
  default: CLAUDE_DEFAULT_BY_ALIAS.sonnet,
  opusplan: CLAUDE_DEFAULT_BY_ALIAS.opus,
};

export function isValidComboPresetName(name) {
  return typeof name === "string" && name.length > 0 && VALID_COMBO_NAME_REGEX.test(name);
}

function pushItem(name, models, seen) {
  if (!isValidComboPresetName(name)) return null;
  if (seen?.has(name)) return null;
  if (!Array.isArray(models) || models.length === 0) return null;
  seen?.add(name);
  return { name, models };
}

function itemsFromProviderModels(modelList, providerAlias, seen) {
  const out = [];
  for (const entry of modelList || []) {
    const id = typeof entry === "string" ? entry : entry?.id;
    if (!id) continue;
    const item = pushItem(id, [`${providerAlias}/${id}`], seen);
    if (item) out.push(item);
  }
  return out;
}

/** Prefer the live catalog when provided; otherwise the static cu registry. */
export function buildCursorPresetItems(opts = {}) {
  const seen = new Set();
  const live = Array.isArray(opts.liveModels) ? opts.liveModels : null;
  if (live?.length) {
    return itemsFromProviderModels(live, CURSOR_ALIAS, seen);
  }
  return itemsFromProviderModels(getProviderModels(CURSOR_ALIAS), CURSOR_ALIAS, seen);
}

/** cc registry models, then the Claude Code aliases the CLI sends verbatim. */
export function buildClaudePresetItems() {
  const seen = new Set();
  const out = itemsFromProviderModels(getProviderModels(CLAUDE_ALIAS), CLAUDE_ALIAS, seen);

  const claudeTool = CLI_TOOLS.claude || {};
  for (const entry of claudeTool.defaultModels || []) {
    const name = entry.alias || entry.id;
    const target = entry.defaultValue;
    if (!name || !target) continue;
    const item = pushItem(name, [target], seen);
    if (item) out.push(item);
  }

  for (const alias of claudeTool.modelAliases || []) {
    if (seen.has(alias)) continue;
    const target = CLAUDE_EXTRA_ALIAS_TARGETS[alias];
    if (!target) continue;
    const item = pushItem(alias, [target], seen);
    if (item) out.push(item);
  }

  return out;
}

export function buildPresetItems(source, opts = {}) {
  if (!PRESET_SOURCES.has(source)) return [];

  const items = source === "cursor"
    ? buildCursorPresetItems({ liveModels: opts.liveModels })
    : buildClaudePresetItems();

  const existing = new Set(opts.existingNames || []);
  return items.map((item) => ({
    ...item,
    exists: existing.has(item.name),
  }));
}
