import { NextResponse } from "next/server";
import fs from "fs/promises";
import { probeCliInstalled, readJsoncFile } from "../_shared/cliConfig.js";
import path from "path";
import os from "os";

const getConfigDir = () => path.join(os.homedir(), ".config", "opencode");
const getConfigPath = () => path.join(getConfigDir(), "opencode.json");

const writeConfig = async (configPath, config) => {
  const tempPath = `${configPath}.${process.pid}.${Date.now()}.tmp`;
  try {
    await fs.writeFile(tempPath, JSON.stringify(config, null, 2));
    await fs.rename(tempPath, configPath);
  } catch (error) {
    await fs.rm(tempPath, { force: true }).catch(() => {});
    throw error;
  }
};

// Check if opencode CLI is installed (via which/where or config file exists)
const checkOpenCodeInstalled = () => probeCliInstalled("opencode", [getConfigPath()], { injectNpmPath: true });
const readConfig = () => readJsoncFile(getConfigPath());

const getRouterProviderKey = (config) =>
  config?.provider?.VansRoute ? "VansRoute" : config?.provider?.["9router"] ? "9router" : null;

const getRouterProvider = (config) => {
  const key = getRouterProviderKey(config);
  return key ? config.provider[key] : null;
};

const has9RouterConfig = (config) => !!getRouterProvider(config);

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
    const providerConfig = getRouterProvider(config);
    const modelMap = providerConfig?.models || {};

    return NextResponse.json({
      installed: true,
      config,
      hasVansRoute: has9RouterConfig(config),
      has9Router: has9RouterConfig(config),
      configPath: getConfigPath(),
        opencode: {
          models: Object.keys(modelMap),
          activeModel: config?.model?.startsWith("VansRoute/")
            ? config.model.replace(/^VansRoute\//, "")
            : config?.model?.startsWith("9router/")
              ? config.model.replace(/^9router\//, "")
              : null,
          baseURL: providerConfig?.options?.baseURL || null,
        },
    });
  } catch (error) {
    return NextResponse.json({ error: "Failed to check opencode settings" }, { status: 500 });
  }
}

// POST - Apply 9Router as openai-compatible provider (multi-model support)
export async function POST(request) {
  try {
    const { baseUrl, apiKey, model, models, activeModel, subagentModel } = await request.json();

    // Accept either `model` (string, legacy) or `models` (array of strings).
    const modelsArray = (Array.isArray(models) ? models : (typeof model === "string" ? [model] : []))
      .filter((value) => typeof value === "string")
      .map((value) => value.trim())
      .filter(Boolean);

    let parsedBaseUrl;
    try {
      parsedBaseUrl = new URL(baseUrl);
    } catch {
      return NextResponse.json({ error: "baseUrl must be a valid URL" }, { status: 400 });
    }
    if (!/^https?:$/.test(parsedBaseUrl.protocol) || modelsArray.length === 0) {
      return NextResponse.json({ error: "baseUrl must use HTTP(S) and include at least one model" }, { status: 400 });
    }

    const configDir = getConfigDir();
    const configPath = getConfigPath();

    await fs.mkdir(configDir, { recursive: true });

    // Read existing config or start fresh
    let config = (await readConfig()) || {};

    const normalizedBaseUrl = baseUrl.endsWith("/v1") ? baseUrl : `${baseUrl}/v1`;
    const keyToUse = apiKey || "sk_9router";
    const effectiveSubagentModel = subagentModel || modelsArray[0];

    // Ensure provider object
    if (!config.provider) config.provider = {};

    // Preserve any existing 9router provider entry and its models
    const existingProvider = config.provider.VansRoute || config.provider["9router"] || { npm: "@ai-sdk/openai-compatible", options: {}, models: {} };

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
      existingProvider.models[m] = { name: m, modalities: { input: ["text", "image"], output: ["text"] } };
    }

    // Save the canonical provider and remove the legacy duplicate after migration.
    config.provider.VansRoute = existingProvider;
    delete config.provider["9router"];

    // Set the active model: prefer explicit activeModel, else first of modelsArray
    // If activeModel is explicitly empty string, clear the model
    if (activeModel === "") {
      config.model = "";
    } else {
      const finalActive = activeModel || modelsArray[0];
      if (finalActive) {
        config.model = `VansRoute/${finalActive}`;
      }
    }

    // Add subagent configuration
    if (!config.agent) config.agent = {};
    config.agent.explorer = {
      description: "Fast explorer subagent for codebase exploration",
      mode: "subagent",
      model: `VansRoute/${effectiveSubagentModel}`,
    };

    await writeConfig(configPath, config);

    return NextResponse.json({
      success: true,
      message: "OpenCode settings applied successfully!",
      configPath,
    });
  } catch (error) {
    return NextResponse.json({ error: "Failed to apply settings" }, { status: 500 });
  }
}

// PATCH - Update specific settings (e.g., clear active model)
export async function PATCH(request) {
  try {
    const { clearActiveModel } = await request.json();
    if (clearActiveModel !== true) {
      return NextResponse.json({ error: "clearActiveModel must be true" }, { status: 400 });
    }
    const configPath = getConfigPath();

    const config = await readConfig();
    if (!config) {
      return NextResponse.json({ success: true, message: "No config file found" });
    }

    if (clearActiveModel === true) {
      // Clear active model but keep models in the list.
      if (config.model?.startsWith("9router/") || config.model?.startsWith("VansRoute/")) {
        config.model = "";
      }
    }

    await writeConfig(configPath, config);

    return NextResponse.json({
      success: true,
      message: "Settings updated",
    });
  } catch (error) {
    return NextResponse.json({ error: "Failed to patch settings" }, { status: 500 });
  }
}

// DELETE - Remove 9Router provider or specific models from config
export async function DELETE(request) {
  try {
    const { searchParams } = new URL(request.url);
    const modelToRemove = searchParams.get("model");
    const configPath = getConfigPath();

    const config = await readConfig();
    if (!config) {
      return NextResponse.json({ success: true, message: "No config file to reset" });
    }

    const providerKey = getRouterProviderKey(config);
    const provider = providerKey ? config.provider[providerKey] : null;
    const modelPrefix = providerKey ? `${providerKey}/` : null;

    // If specific model provided, remove just that model.
    if (modelToRemove && provider?.models) {
      delete provider.models[modelToRemove];

      if (Object.keys(provider.models).length === 0) {
        delete config.provider[providerKey];
        if (modelPrefix && config.model?.startsWith(modelPrefix)) delete config.model;
      } else if (config.model === `${modelPrefix}${modelToRemove}`) {
        const remainingModels = Object.keys(provider.models);
        config.model = `${modelPrefix}${remainingModels[0]}`;
      }
    } else {
      // No specific model - remove both canonical and legacy provider entries.
      delete config.provider?.["9router"];
      delete config.provider?.VansRoute;
      if (config.model?.startsWith("9router/") || config.model?.startsWith("VansRoute/")) delete config.model;
    }

    // Remove subagent configuration
    if (config.agent?.explorer?.model?.startsWith("9router/") || config.agent?.explorer?.model?.startsWith("VansRoute/")) {
      delete config.agent.explorer;
      // Clean up empty agent object
      if (Object.keys(config.agent).length === 0) delete config.agent;
    }

    await writeConfig(configPath, config);

    return NextResponse.json({
      success: true,
      message: modelToRemove ? `Model "${modelToRemove}" removed` : "9Router settings removed from OpenCode",
    });
  } catch (error) {
    return NextResponse.json({ error: "Failed to reset opencode settings" }, { status: 500 });
  }
}
