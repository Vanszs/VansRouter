"use server";

import { NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { probeCliInstalled } from "../_shared/cliConfig.js";

const PROVIDER_ID = "9router";

const getOmpDir = () => path.join(os.homedir(), ".omp", "agent");
const getOmpDbPath = () => path.join(getOmpDir(), "agent.db");
const getOmpModelsYmlPath = () => path.join(getOmpDir(), "models.yml");

// Match a provider block: its header plus every line indented deeper than that header
const providerBlockRe = () => new RegExp(`^([ \\t]*)${PROVIDER_ID}:[ \\t]*\\r?\\n(?:\\1[ \\t]+.*\\r?\\n?)*`, "gm");

const checkOmpInstalled = () => probeCliInstalled("omp", [getOmpDbPath(), getOmpModelsYmlPath()]);

const readModelsYml = async () => {
  try {
    return await fs.readFile(getOmpModelsYmlPath(), "utf-8");
  } catch {
    return "";
  }
};

const has9RouterInYml = (content) => Boolean(content) && (content.includes(`${PROVIDER_ID}:`) || content.includes("localhost:20128"));

const buildOmpProviderYaml = (baseUrl, apiKey) => `  ${PROVIDER_ID}:
    baseUrl: ${baseUrl.endsWith("/v1") ? baseUrl : `${baseUrl}/v1`}
    apiKey: ${apiKey || "sk_9router"}
    api: openai-completions
    authHeader: true
    disableStrictTools: true
    discovery:
      type: proxy`;

const upsertProviderBlock = (ymlContent, providerBlock) => {
  let next = ymlContent.replace(providerBlockRe(), "");
  if (!next.trim()) return `providers:\n${providerBlock}\n`;
  if (next.includes("providers:")) return next.replace(/providers:/, `providers:\n${providerBlock}`);
  return `${next.trim()}\n\nproviders:\n${providerBlock}\n`;
};

// Agent credentials live in agent.db; models.yml stays the source of truth when the driver is absent
const writeAgentDbCredential = async (baseUrl, apiKey) => {
  try {
    const Database = (await import("better-sqlite3")).default;
    const db = new Database(getOmpDbPath());
    const now = Math.floor(Date.now() / 1000);
    db.prepare("DELETE FROM auth_credentials WHERE provider = ?").run(PROVIDER_ID);
    db.prepare(
      "INSERT INTO auth_credentials (provider, credential_type, data, disabled_cause, identity_key, created_at, updated_at) VALUES (?, ?, ?, NULL, NULL, ?, ?)"
    ).run(PROVIDER_ID, "api_key", JSON.stringify({ apiKey: apiKey || "sk_9router", baseUrl }), now, now);
    db.close();
  } catch { /* Non-critical: models.yml is primary */ }
};

export async function GET() {
  try {
    const installed = await checkOmpInstalled();
    if (!installed) {
      return NextResponse.json({ installed: false, config: null, message: "Oh My Pi is not installed" });
    }

    return NextResponse.json({
      installed: true,
      has9Router: has9RouterInYml(await readModelsYml()),
      configPath: getOmpModelsYmlPath(),
    });
  } catch (error) {
    console.log("Error checking omp settings:", error);
    return NextResponse.json({ error: { message: "Failed to check omp settings" } }, { status: 500 });
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
    const { baseUrl, apiKey } = body || {};
    if (!baseUrl) {
      return NextResponse.json({ error: { message: "baseUrl is required" } }, { status: 400 });
    }

    await fs.mkdir(getOmpDir(), { recursive: true });
    const providerBlock = buildOmpProviderYaml(baseUrl, apiKey);
    await fs.writeFile(getOmpModelsYmlPath(), upsertProviderBlock(await readModelsYml(), providerBlock), "utf-8");
    await writeAgentDbCredential(baseUrl, apiKey);

    return NextResponse.json({
      success: true,
      message: "Oh My Pi settings applied! Run 'omp' and all 9Router models appear under 9router in /model.",
      configPath: getOmpModelsYmlPath(),
    });
  } catch (error) {
    console.log("Error updating omp settings:", error);
    return NextResponse.json({ error: { message: "Failed to update omp settings" } }, { status: 500 });
  }
}

export async function DELETE() {
  try {
    const ymlContent = await readModelsYml();
    if (!ymlContent) {
      return NextResponse.json({ success: true, message: "No config file to reset" });
    }

    const next = ymlContent.replace(providerBlockRe(), "");
    if (next.trim() === "providers:") {
      await fs.rm(getOmpModelsYmlPath(), { force: true });
    } else {
      await fs.writeFile(getOmpModelsYmlPath(), next, "utf-8");
    }

    return NextResponse.json({ success: true, message: "9Router removed from Oh My Pi" });
  } catch (error) {
    console.log("Error resetting omp settings:", error);
    return NextResponse.json({ error: { message: "Failed to reset omp settings" } }, { status: 500 });
  }
}
