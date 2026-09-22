"use server";

import { NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { probeCliInstalled } from "../_shared/cliConfig.js";
import { parseTOML, stringifyTOML } from "confbox";

const getJcodeConfigDir = () => path.join(os.homedir(), ".jcode");
const getConfigPath = () => path.join(getJcodeConfigDir(), "config.toml");

const getProviderEnvPath = () => {
  const configDir = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
  return path.join(configDir, "jcode", "provider-VansRoute.env");
};

const checkJcodeInstalled = () => probeCliInstalled("jcode", [getJcodeConfigDir()]);

const readConfig = async () => {
  try {
    const configPath = getConfigPath();
    const content = await fs.readFile(configPath, "utf-8");
    return parseTOML(content);
  } catch (error) {
    return { providers: {} };
  }
};

const hasVansRouteConfig = (config) => {
  if (!config || !config.providers) return false;

  const providers = config.providers;

  if (providers["VansRoute"]) return true;

  for (const [name, provider] of Object.entries(providers)) {
    if (provider.base_url && provider.base_url.includes("localhost:20128")) {
      return true;
    }
  }

  return false;
};

const writeConfig = async (config) => {
  const configPath = getConfigPath();
  const content = stringifyTOML(config);
  await fs.writeFile(configPath, content, "utf-8");
};

const readProviderEnv = async () => {
  try {
    const envPath = getProviderEnvPath();
    const content = await fs.readFile(envPath, "utf-8");
    const env = {};

    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;

      const eqIndex = trimmed.indexOf("=");
      if (eqIndex > 0) {
        const key = trimmed.slice(0, eqIndex).trim();
        let value = trimmed.slice(eqIndex + 1).trim();

        if ((value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1);
        }

        env[key] = value;
      }
    }

    return env;
  } catch {
    return {};
  }
};

const writeProviderEnv = async (env) => {
  const envPath = getProviderEnvPath();
  let content = "# jcode provider environment variables\n";

  for (const [key, value] of Object.entries(env)) {
    content += `${key}="${value}"\n`;
  }

  await fs.writeFile(envPath, content, "utf-8");
};

export async function GET() {
  const isInstalled = await checkJcodeInstalled();

  if (!isInstalled) {
    return NextResponse.json({
      installed: false,
      // SECURITY: informational install hint returned to dashboard UI — not executed server-side
      message: "jcode not installed. Install via: curl -fsSL https://raw.githubusercontent.com/1jehuang/jcode/v1.0.0/scripts/install.sh | bash",
    });
  }

  const config = await readConfig();
  const hasVansRoute = hasVansRouteConfig(config);

  return NextResponse.json({
    installed: true,
    config,
    hasVansRoute,
    configPath: getConfigPath(),
  });
}

export async function POST(request) {
  try {
    const { baseUrl, apiKey, models } = await request.json();

    if (!baseUrl || !apiKey) {
      return NextResponse.json(
        { error: "baseUrl and apiKey are required" },
        { status: 400 }
      );
    }

    const normalizedBaseUrl = baseUrl.endsWith("/v1")
      ? baseUrl
      : `${baseUrl}/v1`;

    let config = await readConfig();

    if (!config.providers) {
      config.providers = {};
    }

    config.providers["VansRoute"] = {
      type: "openai-compatible",
      base_url: normalizedBaseUrl,
      auth: "bearer",
      api_key_env: "JCODE_VansRoute_API_KEY",
      env_file: "provider-VansRoute.env",
      default_model: models && models.length > 0 ? models[0] : "cc/claude-opus-4-7",
      requires_api_key: true,
    };

    const configDir = getJcodeConfigDir();
    await fs.mkdir(configDir, { recursive: true });

    await writeConfig(config);

    const xdgConfigDir = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
    const jcodeConfigDir = path.join(xdgConfigDir, "jcode");
    await fs.mkdir(jcodeConfigDir, { recursive: true });

    const env = await readProviderEnv();
    env.JCODE_VansRoute_API_KEY = apiKey;
    await writeProviderEnv(env);

    return NextResponse.json({
      success: true,
      message: "jcode configured successfully. Use: jcode --provider-profile VansRoute",
      configPath: getConfigPath(),
    });
  } catch (error) {
    console.error("Error configuring jcode:", error);
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }
}

export async function DELETE() {
  try {
    const config = await readConfig();

    if (!config.providers) {
      return NextResponse.json({ success: true, message: "No configuration to remove" });
    }

    delete config.providers["VansRoute"];

    await writeConfig(config);

    const env = await readProviderEnv();
    delete env.JCODE_VansRoute_API_KEY;
    await writeProviderEnv(env);

    return NextResponse.json({
      success: true,
      message: "VansRoute configuration removed from jcode",
    });
  } catch (error) {
    console.error("Error removing jcode configuration:", error);
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }
}
