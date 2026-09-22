"use server";

import { NextResponse } from "next/server";
import { probeCliInstalled } from "../_shared/cliConfig.js";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { parseTOML, stringifyTOML } from "confbox";

const getCodexDir = () => path.join(os.homedir(), ".codex");
const getCodexConfigPath = () => path.join(getCodexDir(), "config.toml");
const getCodexAuthPath = () => path.join(getCodexDir(), "auth.json");

// Flatten confbox-parsed TOML into a writable object, preserving nested tables
const parsedToWritable = (obj) => obj ?? {};

// Set a nested key from a flat dotted path, creating intermediate objects as needed
const setNestedSection = (obj, dottedKey, value) => {
  const keys = dottedKey.split(".");
  let cur = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    if (cur[keys[i]] == null || typeof cur[keys[i]] !== "object") {
      cur[keys[i]] = {};
    }
    cur = cur[keys[i]];
  }
  cur[keys[keys.length - 1]] = value;
};

// Delete a nested key from a flat dotted path
const deleteNestedSection = (obj, dottedKey) => {
  const keys = dottedKey.split(".");
  let cur = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    cur = cur?.[keys[i]];
    if (cur == null) return;
  }
  delete cur[keys[keys.length - 1]];
};

// Check if codex CLI is installed (via which/where or config file exists)
const checkCodexInstalled = () => probeCliInstalled("codex", [getCodexConfigPath()], { injectNpmPath: true });

// Read current config.toml
const readConfig = async () => {
  try {
    const configPath = getCodexConfigPath();
    const content = await fs.readFile(configPath, "utf-8");
    return content;
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
};

// Read auth.json
const readAuth = async () => {
  try {
    const content = await fs.readFile(getCodexAuthPath(), "utf-8");
    return JSON.parse(content);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
};

// Read config.toml as parsed object
const readConfigParsed = async () => {
  const raw = await readConfig();
  if (!raw) return null;
  return parsedToWritable(parseTOML(raw));
};

// Check if config has 9Router settings
const has9RouterConfig = (config) => {
  if (!config) return false;
  return config.includes("model_provider = \"9router\"") || config.includes("[model_providers.9router]");
};

// GET - Check codex CLI and read current settings
export async function GET() {
  try {
    const isInstalled = await checkCodexInstalled();
    
    if (!isInstalled) {
      return NextResponse.json({
        installed: false,
        config: null,
        message: "Codex CLI is not installed",
      });
    }

    const config = await readConfig();

    return NextResponse.json({
      installed: true,
      config,
      has9Router: has9RouterConfig(config),
      configPath: getCodexConfigPath(),
    });
  } catch (error) {
    return NextResponse.json({ error: "Failed to check codex settings" }, { status: 500 });
  }
}

// POST - Update 9Router settings (merge with existing config)
export async function POST(request) {
  try {
    const { baseUrl, apiKey, model, subagentModel } = await request.json();
    
    if (!baseUrl || !apiKey || !model) {
      return NextResponse.json({ error: "baseUrl, apiKey and model are required" }, { status: 400 });
    }

    const codexDir = getCodexDir();
    const configPath = getCodexConfigPath();

    // Ensure directory exists
    await fs.mkdir(codexDir, { recursive: true });

    // Read and parse existing config
    let parsed = (await readConfigParsed()) || {};

    // Update only 9Router related fields (api_key goes to auth.json, not config.toml)
    parsed.model = model;
    parsed.model_provider = "9router";

    // Update or create 9router provider section (no api_key - Codex reads from auth.json)
    // Ensure /v1 suffix is added only once
    const normalizedBaseUrl = baseUrl.endsWith("/v1") ? baseUrl : `${baseUrl}/v1`;
    // Custom providers ignore auth.json - the key must travel as a static header
    setNestedSection(parsed, "model_providers.9router", {
      name: "9Router",
      base_url: normalizedBaseUrl,
      wire_api: "responses",
      http_headers: { Authorization: `Bearer ${apiKey}` },
    });

    // Subagent model is a scalar under [agents]; agents.<role> now means a custom role
    deleteNestedSection(parsed, "agents.subagent");
    setNestedSection(parsed, "agents.default_subagent_model", subagentModel || model);

    // Write merged config
    const configContent = stringifyTOML(parsed);
    await fs.writeFile(configPath, configContent);
    return NextResponse.json({
      success: true,
      message: "Codex settings applied successfully!",
      configPath,
    });
  } catch (error) {
    return NextResponse.json({ error: "Failed to update codex settings" }, { status: 500 });
  }
}

// DELETE - Remove 9Router settings only (keep other settings)
export async function DELETE() {
  try {
    const configPath = getCodexConfigPath();

    // Read and parse existing config
    const parsed = await readConfigParsed();
    if (!parsed) {
      return NextResponse.json({
        success: true,
        message: "No config file to reset",
      });
    }

    // Remove 9Router related root fields only if they point to 9router
    if (parsed.model_provider === "9router") {
      delete parsed.model;
      delete parsed.model_provider;
    }

    // Remove 9router provider section
    deleteNestedSection(parsed, "model_providers.9router");

    // Remove subagent configuration (both the current key and the legacy role form)
    deleteNestedSection(parsed, "agents.default_subagent_model");
    deleteNestedSection(parsed, "agents.subagent");

    // Write updated config
    const configContent = stringifyTOML(parsed);
    await fs.writeFile(configPath, configContent);

    // Remove OPENAI_API_KEY from auth.json
    const authPath = getCodexAuthPath();
    const authData = await readAuth();
    if (authData) {
      delete authData.OPENAI_API_KEY;
      delete authData.auth_mode;

      // Write back or delete if empty
      if (Object.keys(authData).length === 0) {
        await fs.unlink(authPath);
      } else {
        await fs.writeFile(authPath, JSON.stringify(authData, null, 2));
      }
    }

    return NextResponse.json({
      success: true,
      message: "9Router settings removed successfully",
    });
  } catch (error) {
    return NextResponse.json({ error: "Failed to reset codex settings" }, { status: 500 });
  }
}
