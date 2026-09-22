import { NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { probeCliInstalled } from "../_shared/cliConfig.js";
import { parseTOML, stringifyTOML } from "confbox";

const getForgeDir = () => path.join(os.homedir(), ".forge");
const getForgeConfigPath = () => path.join(getForgeDir(), "config.toml");

const checkForgeInstalled = () => probeCliInstalled("forge", [getForgeConfigPath()]);

const readConfigToml = async () => {
  try {
    return await fs.readFile(getForgeConfigPath(), "utf-8");
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
    const installed = await checkForgeInstalled();
    if (!installed) {
      return NextResponse.json({ installed: false, config: null, message: "ForgeCode CLI is not installed" });
    }

    const content = await readConfigToml();

    return NextResponse.json({
      installed: true,
      config: parseConfigToml(content),
      has9Router: has9RouterConfig(content),
      configPath: getForgeConfigPath(),
    });
  } catch (error) {
    console.log("Error checking forge settings:", error);
    return NextResponse.json({ error: { message: "Failed to check forge settings" } }, { status: 500 });
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

    const configPath = getForgeConfigPath();
    await fs.mkdir(getForgeDir(), { recursive: true });

    const config = parseConfigToml(await readConfigToml());
    config.openai = {
      api_key: apiKey || "sk_9router",
      base_url: baseUrl.endsWith("/v1") ? baseUrl : `${baseUrl}/v1`,
      model: model || "provider/model-id",
    };

    await fs.writeFile(configPath, `# Forge config — managed by 9Router\n\n${stringifyTOML(config)}`, "utf-8");

    return NextResponse.json({ success: true, message: "ForgeCode settings applied successfully!", configPath });
  } catch (error) {
    console.log("Error updating forge settings:", error);
    return NextResponse.json({ error: { message: "Failed to update forge settings" } }, { status: 500 });
  }
}

export async function DELETE() {
  try {
    const configPath = getForgeConfigPath();
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

    return NextResponse.json({ success: true, message: "9Router removed from ForgeCode" });
  } catch (error) {
    console.log("Error resetting forge settings:", error);
    return NextResponse.json({ error: { message: "Failed to reset forge settings" } }, { status: 500 });
  }
}
