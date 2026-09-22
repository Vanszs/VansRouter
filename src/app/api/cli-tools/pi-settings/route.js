"use server";

import { NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { probeCliInstalled, readJsoncFile } from "../_shared/cliConfig.js";

const PROVIDER_ID = "9router";
const DEFAULT_CONTEXT_WINDOW = 128000;
const DEFAULT_MAX_TOKENS = 16384;

const getAgentModelsPath = () => path.join(os.homedir(), ".pi", "agent", "models.json");
const getRootModelsPath = () => path.join(os.homedir(), ".pi", "models.json");
const checkPiInstalled = () => probeCliInstalled("pi", [getAgentModelsPath(), getRootModelsPath()]);

// Prefer the nested path Pi actually reads, fall back to a flat ~/.pi/models.json
const resolveModelsPath = async () => {
  for (const candidate of [getAgentModelsPath(), getRootModelsPath()]) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch { /* try next */ }
  }
  return getAgentModelsPath();
};

const readConfigAt = readJsoncFile;

const has9RouterConfig = (config) => {
  const providers = config?.providers;
  if (!providers) return false;
  if (providers[PROVIDER_ID]?.baseUrl) return true;
  return Object.values(providers).some((provider) => provider?.baseUrl?.includes("20128"));
};

const toModelEntry = (entry) => {
  if (typeof entry === "string") {
    return { id: entry, name: entry, contextWindow: DEFAULT_CONTEXT_WINDOW, maxTokens: DEFAULT_MAX_TOKENS };
  }
  const id = entry?.id || "provider/model-id";
  return {
    id,
    name: entry?.name || id,
    contextWindow: entry?.contextWindow || DEFAULT_CONTEXT_WINDOW,
    maxTokens: entry?.maxTokens || DEFAULT_MAX_TOKENS,
  };
};

export async function GET() {
  try {
    const installed = await checkPiInstalled();
    if (!installed) {
      return NextResponse.json({ installed: false, config: null, message: "Pi CLI is not installed" });
    }

    const configPath = await resolveModelsPath();
    const config = await readConfigAt(configPath);

    return NextResponse.json({
      installed: true,
      config,
      has9Router: has9RouterConfig(config),
      configPath,
    });
  } catch (error) {
    console.log("Error checking pi settings:", error);
    return NextResponse.json({ error: { message: "Failed to check pi settings" } }, { status: 500 });
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
    const { baseUrl, apiKey, model, models } = body || {};
    if (!baseUrl) {
      return NextResponse.json({ error: { message: "baseUrl is required" } }, { status: 400 });
    }

    const configPath = await resolveModelsPath();
    await fs.mkdir(path.dirname(configPath), { recursive: true });

    const existing = (await readConfigAt(configPath)) || {};
    if (!existing.providers) existing.providers = {};

    const selected = Array.isArray(models) && models.length > 0 ? models : [model || "provider/model-id"];
    existing.providers[PROVIDER_ID] = {
      baseUrl: baseUrl.endsWith("/v1") ? baseUrl : `${baseUrl}/v1`,
      apiKey: apiKey || "sk_9router",
      api: "openai-completions",
      models: selected.map(toModelEntry),
    };

    await fs.writeFile(configPath, JSON.stringify(existing, null, 2), "utf-8");

    return NextResponse.json({
      success: true,
      message: "Pi settings applied! Use /model in Pi to select the 9Router model.",
      configPath,
    });
  } catch (error) {
    console.log("Error updating pi settings:", error);
    return NextResponse.json({ error: { message: "Failed to update pi settings" } }, { status: 500 });
  }
}

export async function DELETE() {
  try {
    const configPath = await resolveModelsPath();
    const existing = await readConfigAt(configPath);
    if (!existing) {
      return NextResponse.json({ success: true, message: "No config file to reset" });
    }

    if (existing.providers?.[PROVIDER_ID]) {
      delete existing.providers[PROVIDER_ID];
      if (Object.keys(existing.providers).length === 0) delete existing.providers;
      await fs.writeFile(configPath, JSON.stringify(existing, null, 2), "utf-8");
    }

    return NextResponse.json({ success: true, message: "9Router removed from Pi" });
  } catch (error) {
    console.log("Error resetting pi settings:", error);
    return NextResponse.json({ error: { message: "Failed to reset pi settings" } }, { status: 500 });
  }
}
