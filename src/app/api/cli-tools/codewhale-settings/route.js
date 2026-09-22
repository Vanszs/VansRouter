"use server";

import { NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { probeCliInstalled } from "../_shared/cliConfig.js";
import { parseTOML, stringifyTOML } from "confbox";

const getCodewhaleDir = () => path.join(os.homedir(), ".codewhale");
const getCodewhaleConfigPath = () => path.join(getCodewhaleDir(), "config.toml");

const checkCodewhaleInstalled = () => probeCliInstalled("codewhale", [getCodewhaleConfigPath()]);

const readConfigToml = async () => {
  try {
    return await fs.readFile(getCodewhaleConfigPath(), "utf-8");
  } catch (error) {
    if (error.code === "ENOENT") return "";
    throw error;
  }
};

const parseConfigToml = (content) => {
  if (!content) return {};
  try {
    return parseTOML(content);
  } catch {
    return {};
  }
};

const has9RouterConfig = (content) => Boolean(content) && (content.includes("managed by 9Router") || content.includes("localhost:20128"));

export async function GET() {
  try {
    const installed = await checkCodewhaleInstalled();
    if (!installed) {
      return NextResponse.json({ installed: false, config: null, message: "CodeWhale CLI is not installed" });
    }

    const content = await readConfigToml();

    return NextResponse.json({
      installed: true,
      config: parseConfigToml(content),
      has9Router: has9RouterConfig(content),
      configPath: getCodewhaleConfigPath(),
    });
  } catch (error) {
    console.log("Error checking codewhale settings:", error);
    return NextResponse.json({ error: { message: "Failed to check codewhale settings" } }, { status: 500 });
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

    const configPath = getCodewhaleConfigPath();
    await fs.mkdir(getCodewhaleDir(), { recursive: true });

    const config = parseConfigToml(await readConfigToml());
    config.openai = {
      base_url: baseUrl.endsWith("/v1") ? baseUrl : `${baseUrl}/v1`,
      api_key: apiKey || "sk_9router",
      model: model || config.openai?.model || "provider/model-id",
    };

    await fs.writeFile(configPath, `# CodeWhale config — managed by 9Router\n\n${stringifyTOML(config)}`, "utf-8");

    return NextResponse.json({ success: true, message: "CodeWhale settings applied successfully!", configPath });
  } catch (error) {
    console.log("Error updating codewhale settings:", error);
    return NextResponse.json({ error: { message: "Failed to update codewhale settings" } }, { status: 500 });
  }
}

export async function DELETE() {
  try {
    const configPath = getCodewhaleConfigPath();
    const content = await readConfigToml();
    if (!content) {
      return NextResponse.json({ success: true, message: "No config file to reset" });
    }

    const config = parseConfigToml(content);
    delete config.openai;

    if (Object.keys(config).length === 0) {
      await fs.rm(configPath, { force: true });
    } else {
      await fs.writeFile(configPath, stringifyTOML(config), "utf-8");
    }

    return NextResponse.json({ success: true, message: "9Router removed from CodeWhale" });
  } catch (error) {
    console.log("Error resetting codewhale settings:", error);
    return NextResponse.json({ error: { message: "Failed to reset codewhale settings" } }, { status: 500 });
  }
}
