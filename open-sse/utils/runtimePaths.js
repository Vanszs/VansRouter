import os from "node:os";
import path from "node:path";

const APP_NAME = "9router";

export function getRuntimeDataDir({
  env = process.env,
  platform = process.platform,
  home = os.homedir(),
  pathImpl = path,
} = {}) {
  const configured = typeof env.DATA_DIR === "string" ? env.DATA_DIR.trim() : "";

  // A Docker/Linux path in a Windows .env must not split the release and DB roots.
  if (configured && !(platform === "win32" && /^\//.test(configured))) {
    return pathImpl.resolve(configured);
  }

  if (platform === "win32") {
    return pathImpl.join(
      env.APPDATA || pathImpl.join(home, "AppData", "Roaming"),
      APP_NAME,
    );
  }
  return pathImpl.join(home, `.${APP_NAME}`);
}

export function getRuntimeLogsDir(options = {}) {
  return path.join(getRuntimeDataDir(options), "logs");
}
