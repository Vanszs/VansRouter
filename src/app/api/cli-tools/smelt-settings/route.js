"use server";

import { NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

const getSmeltConfigPath = () => path.join(os.homedir(), ".smelt", "config.json");
const getSmeltDir = () => path.dirname(getSmeltConfigPath());

const checkSmeltInstalled = async () => {
  try {
    const isWindows = os.platform() === "win32";
    await execAsync(isWindows ? "where smelt" : "which smelt", { windowsHide: true });
    return true;
  } catch {
    try {
      await fs.access(getSmeltConfigPath());
      return true;
    } catch {
      return false;
    }
  }
};

const readConfig = async () => {
  try {
    const content = await fs.readFile(getSmeltConfigPath(), "utf-8");
    return JSON.parse(content.replace(/,(\s*[}\]])/g, "$1"));
  } catch {
    return null;
  }
};

const has9RouterConfig = (config) =>
  config?._managedBy === "9router" || Boolean(config?.baseUrl?.includes("20128"));

export async function GET() {
  try {
    const installed = await checkSmeltInstalled();
    if (!installed) {
      return NextResponse.json({ installed: false, config: null, message: "Smelt CLI is not installed" });
    }

    const config = await readConfig();

    return NextResponse.json({
      installed: true,
      config,
      has9Router: has9RouterConfig(config),
      configPath: getSmeltConfigPath(),
    });
  } catch (error) {
    console.log("Error checking smelt settings:", error);
    return NextResponse.json({ error: { message: "Failed to check smelt settings" } }, { status: 500 });
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

    const configPath = getSmeltConfigPath();
    await fs.mkdir(getSmeltDir(), { recursive: true });

    const existing = (await readConfig()) || {};
    const updated = {
      ...existing,
      baseUrl: baseUrl.endsWith("/v1") ? baseUrl : `${baseUrl}/v1`,
      apiKey: apiKey || "sk_9router",
      model: model || existing.model || "provider/model-id",
      _managedBy: "9router",
    };

    await fs.writeFile(configPath, JSON.stringify(updated, null, 2), "utf-8");

    return NextResponse.json({ success: true, message: "Smelt settings applied successfully!", configPath });
  } catch (error) {
    console.log("Error updating smelt settings:", error);
    return NextResponse.json({ error: { message: "Failed to update smelt settings" } }, { status: 500 });
  }
}

export async function DELETE() {
  try {
    const configPath = getSmeltConfigPath();
    const existing = await readConfig();
    if (!existing) {
      return NextResponse.json({ success: true, message: "No config file to reset" });
    }

    delete existing.baseUrl;
    delete existing.apiKey;
    delete existing.model;
    delete existing._managedBy;

    if (Object.keys(existing).length === 0) {
      await fs.rm(configPath, { force: true });
    } else {
      await fs.writeFile(configPath, JSON.stringify(existing, null, 2), "utf-8");
    }

    return NextResponse.json({ success: true, message: "9Router removed from Smelt" });
  } catch (error) {
    console.log("Error resetting smelt settings:", error);
    return NextResponse.json({ error: { message: "Failed to reset smelt settings" } }, { status: 500 });
  }
}
