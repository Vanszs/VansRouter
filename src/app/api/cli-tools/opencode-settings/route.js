"use server";

import { NextResponse } from "next/server";
import { resolveCliApiKey } from "../resolveApiKey.js";
import { ALIAS_TO_ID } from "@/shared/constants/providers";
import { PROVIDER_ID_TO_ALIAS } from "@/shared/constants/models";
import { getThinkingLevels } from "open-sse/providers/thinkingLevels.js";
import { exec } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import path from "path";
import os from "os";

const execAsync = promisify(exec);

const getConfigDir = () => path.join(os.homedir(), ".config", "opencode");
const getConfigPath = () => path.join(getConfigDir(), "opencode.json");

const ALIAS_TO_PROVIDER_ID = {
  ...Object.fromEntries(Object.entries(PROVIDER_ID_TO_ALIAS).map(([id, alias]) => [alias, id])),
  ...ALIAS_TO_ID,
};

// Variants built from the levels 9Router offers for a model, so the CLI effort
// selector matches the dashboard picker. null when the model has none.
const buildEffortVariants = (fullModelId) => {
  const slash = fullModelId.indexOf("/");
  if (slash <= 0) return null;
  const alias = fullModelId.slice(0, slash);
  const levels = getThinkingLevels(ALIAS_TO_PROVIDER_ID[alias] || alias, fullModelId.slice(slash + 1));
  if (!Array.isArray(levels) || levels.length === 0) return null;
  return Object.fromEntries(levels.map((level) => [level, { reasoningEffort: level }]));
};

// Check if opencode CLI is installed (via which/where or config file exists)
const checkOpenCodeInstalled = async () => {
  try {
    const isWindows = os.platform() === "win32";
    const command = isWindows ? "where opencode" : "which opencode";
    const env = isWindows
      ? { ...process.env, PATH: `${process.env.APPDATA}\\npm;${process.env.PATH}` }
      : process.env;
    await execAsync(command, { windowsHide: true, env });
    return true;
  } catch {
    try {
      await fs.access(getConfigPath());
      return true;
    } catch {
      return false;
    }
  }
};

const readConfig = async () => {
  try {
    const content = await fs.readFile(getConfigPath(), "utf-8");
    // opencode config files may use JSONC format (trailing commas, comments).
    // Strip trailing commas before parsing to avoid SyntaxError on valid JSONC.
    const stripped = content.replace(/,(\s*[}\]])/g, "$1");
    return JSON.parse(stripped);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    // If the config file exists but is unparseable (corrupted, exotic JSONC),
    // treat it as "no config" rather than throwing a 500 that the UI
    // misinterprets as "opencode not installed".
    return null;
  }
};

// This fork writes the provider key "VansRoute"; "9router" is the legacy key and
// is still detected (and migrated on write).
const PROVIDER_KEY = "VansRoute";
const LEGACY_PROVIDER_KEY = "9router";
const providerBlock = (config) => config?.provider?.[PROVIDER_KEY] || config?.provider?.[LEGACY_PROVIDER_KEY];
const hasVansRouteConfig = (config) => !!providerBlock(config);
const has9RouterConfig = hasVansRouteConfig;

// GET - Check opencode CLI and read current settings
export async function GET() {
  try {
    const isInstalled = await checkOpenCodeInstalled();

    if (!isInstalled) {
      return NextResponse.json({
        installed: false,
        config: null,
        message: "OpenCode CLI is not installed",
      });
    }

    const config = await readConfig();
    const providerConfig = providerBlock(config);
    const modelMap = providerConfig?.models || {};

    return NextResponse.json({
      installed: true,
      config,
      hasVansRoute: hasVansRouteConfig(config),
      has9Router: hasVansRouteConfig(config),
      configPath: getConfigPath(),
        opencode: {
          models: Object.keys(modelMap),
          activeModel: config?.model?.match(/^(?:VansRoute|9router)\//) ? config.model.replace(/^(?:VansRoute|9router)\//, "") : null,
          baseURL: providerConfig?.options?.baseURL || null,
        },
    });
  } catch (error) {
    console.log("Error checking opencode settings:", error);
    return NextResponse.json({ error: "Failed to check opencode settings" }, { status: 500 });
  }
}

// POST - Apply 9Router as openai-compatible provider (multi-model support)
export async function POST(request) {
  try {
    const { baseUrl, apiKey, model, models, activeModel, subagentModel } = await request.json();

    // Accept either `model` (string, legacy) or `models` (array of strings)
    const modelsArray = Array.isArray(models) ? models.slice() : (typeof model === "string" ? [model] : []);

    if (!baseUrl || modelsArray.length === 0) {
      return NextResponse.json({ error: "baseUrl and at least one model are required" }, { status: 400 });
    }

    const configDir = getConfigDir();
    const configPath = getConfigPath();

    await fs.mkdir(configDir, { recursive: true });

    // Read existing config or start fresh
    let config = {};
    try {
      const existing = await fs.readFile(configPath, "utf-8");
      config = JSON.parse(existing);
    } catch { /* No existing config */ }

    if (baseUrl) {
      try {
        const parsed = new URL(baseUrl);
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("protocol");
      } catch {
        return NextResponse.json({ error: "Invalid baseURL" }, { status: 400 });
      }
    }
    const normalizedBaseUrl = baseUrl.endsWith("/v1") ? baseUrl : `${baseUrl}/v1`;
    const keyToUse = await resolveCliApiKey(apiKey);
    const effectiveSubagentModel = subagentModel || modelsArray[0];

    // Ensure provider object
    if (!config.provider) config.provider = {};

    // Preserve any existing 9router provider entry and its models
    const existingProvider = config.provider[PROVIDER_KEY] || { npm: "@ai-sdk/openai-compatible", options: {}, models: {} };

    // Merge options (overwrite baseURL/apiKey)
    existingProvider.options = {
      ...existingProvider.options,
      baseURL: normalizedBaseUrl,
      apiKey: keyToUse,
    };

    // Ensure models map exists
    existingProvider.models = existingProvider.models || {};

    // Add or update entries for all requested models
    for (const m of modelsArray) {
      if (!m || typeof m !== "string") continue;
      const entry = { name: m, modalities: { input: ["text", "image"], output: ["text"] } };
      const variants = existingProvider.models[m]?.variants || buildEffortVariants(m);
      if (variants) entry.variants = variants;
      existingProvider.models[m] = entry;
    }

    // Save merged provider back
    config.provider[PROVIDER_KEY] = existingProvider;
    delete config.provider[LEGACY_PROVIDER_KEY];

    // Set the active model: prefer explicit activeModel, else first of modelsArray
    // If activeModel is explicitly empty string, clear the model
    if (activeModel === "") {
      config.model = "";
    } else {
      const finalActive = activeModel || modelsArray[0];
      if (finalActive) {
        config.model = `${PROVIDER_KEY}/${finalActive}`;
      }
    }

    // Add subagent configuration
    if (!config.agent) config.agent = {};
    config.agent.explorer = {
      description: "Fast explorer subagent for codebase exploration",
      mode: "subagent",
      model: `${PROVIDER_KEY}/${effectiveSubagentModel}`,
    };

    await fs.writeFile(configPath, JSON.stringify(config, null, 2));

    return NextResponse.json({
      success: true,
      message: "OpenCode settings applied successfully!",
      configPath,
    });
  } catch (error) {
    console.log("Error applying opencode settings:", error);
    return NextResponse.json({ error: "Failed to apply settings" }, { status: 500 });
  }
}

// PATCH - Update specific settings (e.g., clear active model)
export async function PATCH(request) {
  try {
    const { clearActiveModel } = await request.json();
    const configPath = getConfigPath();

    let config = {};
    try {
      const existing = await fs.readFile(configPath, "utf-8");
      config = JSON.parse(existing);
    } catch (error) {
      if (error.code === "ENOENT") {
        return NextResponse.json({ success: true, message: "No config file found" });
      }
      throw error;
    }

    if (clearActiveModel === true) {
      // Clear active model but keep models in the list
      if (typeof config.model === "string" && /^(?:VansRoute|9router)\//.test(config.model)) {
        config.model = "";
      }
    }

    await fs.writeFile(configPath, JSON.stringify(config, null, 2));

    return NextResponse.json({
      success: true,
      message: "Settings updated",
    });
  } catch (error) {
    console.log("Error patching opencode settings:", error);
    return NextResponse.json({ error: "Failed to patch settings" }, { status: 500 });
  }
}

// DELETE - Remove 9Router provider or specific models from config
export async function DELETE(request) {
  try {
    const { searchParams } = new URL(request.url);
    const modelToRemove = searchParams.get("model");
    const configPath = getConfigPath();

    let config = {};
    try {
      const existing = await fs.readFile(configPath, "utf-8");
      config = JSON.parse(existing);
    } catch (error) {
      if (error.code === "ENOENT") {
        return NextResponse.json({ success: true, message: "No config file to reset" });
      }
      throw error;
    }

    // If specific model provided, remove just that model
    if (modelToRemove && config.provider?.[PROVIDER_KEY]?.models) {
      delete config.provider[PROVIDER_KEY].models[modelToRemove];
      
      // If no models left, remove the provider
      if (Object.keys(config.provider[PROVIDER_KEY].models).length === 0) {
        delete config.provider[PROVIDER_KEY];
        delete config.provider[LEGACY_PROVIDER_KEY];
        if (typeof config.model === "string" && /^(?:VansRoute|9router)\//.test(config.model)) delete config.model;
      } else if (config.model === `${PROVIDER_KEY}/${modelToRemove}`) {
        // If removed model was active, switch to first remaining model
        const remainingModels = Object.keys(config.provider[PROVIDER_KEY].models);
        config.model = `${PROVIDER_KEY}/${remainingModels[0]}`;
      }
    } else {
      // No specific model - remove the whole provider (fork key and legacy key)
      if (config.provider) {
        delete config.provider[PROVIDER_KEY];
        delete config.provider[LEGACY_PROVIDER_KEY];
      }
      if (typeof config.model === "string" && /^(?:VansRoute|9router)\//.test(config.model)) delete config.model;
    }

    // Remove subagent configuration
    if (config.agent?.explorer?.model?.startsWith("9router/")) {
      delete config.agent.explorer;
      // Clean up empty agent object
      if (Object.keys(config.agent).length === 0) delete config.agent;
    }

    await fs.writeFile(configPath, JSON.stringify(config, null, 2));

    return NextResponse.json({
      success: true,
      message: modelToRemove ? `Model "${modelToRemove}" removed` : "9Router settings removed from OpenCode",
    });
  } catch (error) {
    console.log("Error resetting opencode settings:", error);
    return NextResponse.json({ error: "Failed to reset opencode settings" }, { status: 500 });
  }
}
