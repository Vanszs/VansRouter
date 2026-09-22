"use server";

import { NextResponse } from "next/server";
import fs from "fs/promises";
import { probeCliInstalled, readJsoncFile } from "../_shared/cliConfig.js";
import path from "path";
import os from "os";
import { DEFAULT_PLUGINS } from "@/shared/constants/coworkPlugins";

// Exa MCP def — reuse from coworkPlugins (DRY).
const EXA_PLUGIN = DEFAULT_PLUGINS.find((p) => p.name === "exa");
const buildExaMcpEntry = () => ({
  type: EXA_PLUGIN.transport,
  url: EXA_PLUGIN.url,
});

// Get claude settings path based on OS
const getClaudeSettingsPath = () => {
  const homeDir = os.homedir();
  return path.join(homeDir, ".claude", "settings.json");
};

// Claude Code CLI reads mcpServers from ~/.claude.json (NOT settings.json).
const getClaudeJsonPath = () => path.join(os.homedir(), ".claude.json");

const readClaudeJson = () => readJsoncFile(getClaudeJsonPath());

const writeClaudeJsonMcp = async (mcpServers) => {
  const filePath = getClaudeJsonPath();
  let data = {};
  try {
    data = JSON.parse(await fs.readFile(filePath, "utf-8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if (mcpServers && Object.keys(mcpServers).length > 0) {
    data.mcpServers = { ...(data.mcpServers || {}), ...mcpServers };
  } else if (data.mcpServers) {
    delete data.mcpServers.exa;
    if (Object.keys(data.mcpServers).length === 0) delete data.mcpServers;
  }
  await fs.writeFile(filePath, JSON.stringify(data, null, 2));
};


// Check if claude CLI is installed (via which/where or config file exists)
const checkClaudeInstalled = () => probeCliInstalled("claude", [getClaudeSettingsPath()], { injectNpmPath: true });

// Read current settings
const readSettings = () => readJsoncFile(getClaudeSettingsPath());

// GET - Check claude CLI and read current settings
export async function GET() {
  try {
    const isInstalled = await checkClaudeInstalled();
    
    if (!isInstalled) {
      return NextResponse.json({
        installed: false,
        settings: null,
        message: "Claude CLI is not installed",
      });
    }

    const settings = await readSettings();
    const has9Router = !!(settings?.env?.ANTHROPIC_BASE_URL);
    const claudeJson = await readClaudeJson();

    return NextResponse.json({
      installed: true,
      settings: settings,
      has9Router: has9Router,
      exaMcpEnabled: !!claudeJson?.mcpServers?.exa,
      settingsPath: getClaudeSettingsPath(),
    });
  } catch (error) {
    console.log("Error checking claude settings:", error);
    return NextResponse.json(
      { error: "Failed to check claude settings" },
      { status: 500 }
    );
  }
}

// POST - Backup old fields and write new settings
export async function POST(request) {
  try {
    const { env, exaMcpEnabled, autoCompactWindow } = await request.json();
    
    if (!env || typeof env !== "object") {
      return NextResponse.json(
        { error: "Invalid env object" },
        { status: 400 }
      );
    }

    const settingsPath = getClaudeSettingsPath();
    const claudeDir = path.dirname(settingsPath);

    // Ensure .claude directory exists
    await fs.mkdir(claudeDir, { recursive: true });

    // Read current settings
    let currentSettings = {};
    try {
      const content = await fs.readFile(settingsPath, "utf-8");
      currentSettings = JSON.parse(content);
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw error;
      }
    }

    // Normalize ANTHROPIC_BASE_URL to ensure /v1 suffix
    if (env.ANTHROPIC_BASE_URL) {
      env.ANTHROPIC_BASE_URL = env.ANTHROPIC_BASE_URL.endsWith("/v1") 
        ? env.ANTHROPIC_BASE_URL 
        : `${env.ANTHROPIC_BASE_URL}/v1`;
    }

    // Merge new env with existing settings
    const newSettings = {
      ...currentSettings,
      hasCompletedOnboarding: true,
      env: {
        ...(currentSettings.env || {}),
        ...env,
      },
    };

    // CLAUDE_CODE_AUTO_COMPACT_WINDOW — the token threshold that triggers
    // auto-compact. Only set when a concrete value is chosen; "Default" removes
    // the key so Claude Code derives the window from the model.
    if (autoCompactWindow) {
      newSettings.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW = String(autoCompactWindow);
    } else {
      delete newSettings.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW;
    }

    // Write new settings
    await fs.writeFile(settingsPath, JSON.stringify(newSettings, null, 2));

    // Exa MCP toggle — write to ~/.claude.json (CLI reads mcpServers from here).
    if (EXA_PLUGIN) {
      await writeClaudeJsonMcp(exaMcpEnabled ? { exa: buildExaMcpEntry() } : null);
    }

    return NextResponse.json({
      success: true,
      message: "Settings updated successfully",
    });
  } catch (error) {
    console.log("Error updating claude settings:", error);
    return NextResponse.json(
      { error: "Failed to update claude settings" },
      { status: 500 }
    );
  }
}

// Fields to remove when resetting
const RESET_ENV_KEYS = [
  "ANTHROPIC_BASE_URL",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_DEFAULT_OPUS_MODEL",
  "ANTHROPIC_DEFAULT_SONNET_MODEL",
  "ANTHROPIC_DEFAULT_HAIKU_MODEL",
  "ANTHROPIC_DEFAULT_FABLE_MODEL",
  "API_TIMEOUT_MS",
  "CLAUDE_CODE_AUTO_COMPACT_WINDOW",
];

// DELETE - Reset settings (remove env fields)
export async function DELETE() {
  try {
    const settingsPath = getClaudeSettingsPath();

    // Read current settings
    let currentSettings = {};
    try {
      const content = await fs.readFile(settingsPath, "utf-8");
      currentSettings = JSON.parse(content);
    } catch (error) {
      if (error.code === "ENOENT") {
        return NextResponse.json({
          success: true,
          message: "No settings file to reset",
        });
      }
      throw error;
    }

    // Remove specified env fields
    if (currentSettings.env) {
      RESET_ENV_KEYS.forEach((key) => {
        delete currentSettings.env[key];
      });
      
      // Clean up empty env object
      if (Object.keys(currentSettings.env).length === 0) {
        delete currentSettings.env;
      }
    }

    // Remove injected MCP servers (Exa) from ~/.claude.json
    await writeClaudeJsonMcp(null);

    // Write updated settings
    await fs.writeFile(settingsPath, JSON.stringify(currentSettings, null, 2));

    return NextResponse.json({
      success: true,
      message: "Settings reset successfully",
    });
  } catch (error) {
    console.log("Error resetting claude settings:", error);
    return NextResponse.json(
      { error: "Failed to reset claude settings" },
      { status: 500 }
    );
  }
}
