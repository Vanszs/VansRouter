import fs from "fs/promises";
import os from "os";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

export async function probeCliInstalled(bin, extraPaths = [], { injectNpmPath = false } = {}) {
  try {
    const isWindows = os.platform() === "win32";
    const command = isWindows ? `where ${bin}` : `which ${bin}`;
    const env = isWindows && injectNpmPath
      ? { ...process.env, PATH: `${process.env.APPDATA}\\npm;${process.env.PATH}` }
      : process.env;
    await execAsync(command, { windowsHide: true, env });
    return true;
  } catch {
    for (const candidate of extraPaths) {
      try {
        await fs.access(candidate);
        return true;
      } catch { /* try next */ }
    }
    return false;
  }
}

export async function readJsoncFile(filePath) {
  try {
    const content = await fs.readFile(filePath, "utf-8");
    return JSON.parse(content.replace(/,(\s*[}\]])/g, "$1"));
  } catch {
    return null;
  }
}
