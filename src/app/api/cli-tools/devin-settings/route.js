import { NextResponse } from "next/server";
import { exec, execFile } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import { resolveDevinBin } from "../../../../../open-sse/shared/cliResolver.js";

const execAsync = promisify(exec);

const checkDevinInstalled = async () => {
  const bin = resolveDevinBin();
  if (bin.includes("/") || bin.includes("\\")) {
    try {
      await fs.access(bin);
      return { installed: true, source: bin };
    } catch { return { installed: false, source: null }; }
  }
  try {
    const command = process.platform === "win32" ? "where devin" : "which devin";
    await execAsync(command, { windowsHide: true });
    return { installed: true, source: "path" };
  } catch {
    return { installed: false, source: null };
  }
};

const execFileAsync = promisify(execFile);

const readDevinVersion = async (bin) => {
  try {
    const cmd = bin === "path" ? "devin" : bin;
    if (!cmd) return null;
    const { stdout } = await execFileAsync(cmd, ["--version"], { windowsHide: true });
    return stdout.trim().split("\n")[0] || null;
  } catch {
    return null;
  }
};

// GET — install detection only. No config to write: the binary handles its own auth.
export async function GET() {
  try {
    const bin = resolveDevinBin();
    const { installed, source } = await checkDevinInstalled();
    if (!installed) {
      return NextResponse.json({
        installed: false,
        message: "Devin CLI is not installed. Install it from https://cli.devin.ai and run `devin auth login`.",
        installUrl: "https://cli.devin.ai",
      });
    }
    const version = await readDevinVersion(bin);
    return NextResponse.json({
      installed: true,
      source,
      version,
      message: "Devin CLI detected. Make sure `devin auth login` has been run.",
    });
  } catch (error) {
    console.log("Error checking devin settings:", error);
    return NextResponse.json({ error: "Failed to check devin settings" }, { status: 500 });
  }
}
