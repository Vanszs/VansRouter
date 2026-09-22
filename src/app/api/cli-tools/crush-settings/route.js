"use server";

import { NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { probeCliInstalled, readJsoncFile } from "../_shared/cliConfig.js";

const PROVIDER_ID = "9router";
const DEFAULT_CONTEXT_WINDOW = 128000;

const getCrushConfigPath = () => {
  const configDir = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
  return path.join(configDir, "crush", "crush.json");
};

const getCrushDir = () => path.dirname(getCrushConfigPath());

const checkCrushInstalled = () => probeCliInstalled("crush", [getCrushConfigPath()]);
const readConfig = () => readJsoncFile(getCrushConfigPath());

const has9RouterConfig = (config) => {
  const providers = config?.providers;
  if (!providers) return false;
  if (providers[PROVIDER_ID]?.base_url) return true;
  return Object.values(providers).some((provider) => provider?.base_url?.includes("20128"));
};

export async function GET() {
  try {
    const installed = await checkCrushInstalled();
    if (!installed) {
      return NextResponse.json({ installed: false, config: null, message: "Crush CLI is not installed" });
    }

    const config = await readConfig();

    return NextResponse.json({
      installed: true,
      config,
      has9Router: has9RouterConfig(config),
      configPath: getCrushConfigPath(),
    });
  } catch (error) {
    console.log("Error checking crush settings:", error);
    return NextResponse.json({ error: { message: "Failed to check crush settings" } }, { status: 500 });
  }
}

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: { message: "Invalid JSON body" } }, { status: 400 });
  }

  try {
    const { baseUrl, apiKey, model } = body || {};
    if (!baseUrl) {
      return NextResponse.json({ error: { message: "baseUrl is required" } }, { status: 400 });
    }

    const configPath = getCrushConfigPath();
    await fs.mkdir(getCrushDir(), { recursive: true });

    const existing = (await readConfig()) || {};
    if (!existing.providers) existing.providers = {};

    const modelId = model || "provider/model-id";
    existing.providers[PROVIDER_ID] = {
      type: "openai-compat",
      base_url: baseUrl.endsWith("/v1") ? baseUrl : `${baseUrl}/v1`,
      api_key: apiKey || "sk_9router",
      models: [{ id: modelId, name: modelId, context_window: DEFAULT_CONTEXT_WINDOW }],
    };

    await fs.writeFile(configPath, JSON.stringify(existing, null, 2), "utf-8");

    return NextResponse.json({ success: true, message: "Crush settings applied successfully!", configPath });
  } catch (error) {
    console.log("Error updating crush settings:", error);
    return NextResponse.json({ error: { message: "Failed to update crush settings" } }, { status: 500 });
  }
}

export async function DELETE() {
  try {
    const configPath = getCrushConfigPath();
    const existing = await readConfig();
    if (!existing) {
      return NextResponse.json({ success: true, message: "No config file to reset" });
    }

    if (existing.providers?.[PROVIDER_ID]) {
      delete existing.providers[PROVIDER_ID];
      if (Object.keys(existing.providers).length === 0) delete existing.providers;
      await fs.writeFile(configPath, JSON.stringify(existing, null, 2), "utf-8");
    }

    return NextResponse.json({ success: true, message: "9Router removed from Crush" });
  } catch (error) {
    console.log("Error resetting crush settings:", error);
    return NextResponse.json({ error: { message: "Failed to reset crush settings" } }, { status: 500 });
  }
}
