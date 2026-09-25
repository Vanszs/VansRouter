#!/usr/bin/env node

const os = require("node:os");
const path = require("node:path");

function defaultDataDir({ env = process.env, home = os.homedir() } = {}) {
  if (env.DATA_DIR) return path.resolve(env.DATA_DIR);
  if (process.platform === "win32") {
    return path.join(env.APPDATA || path.join(home, "AppData", "Roaming"), "9router");
  }
  return path.join(home, ".9router");
}

function resolveRuntimePaths({
  env = process.env,
  home = os.homedir(),
  dataDir = null,
  releaseRoot = null,
  currentLink = null,
} = {}) {
  const resolvedDataDir = path.resolve(dataDir || defaultDataDir({ env, home }));
  const resolvedReleaseRoot = path.resolve(
    releaseRoot || env.RELEASE_ROOT || path.join(resolvedDataDir, "releases"),
  );
  const resolvedCurrentLink = path.resolve(
    currentLink || env.CURRENT_LINK || path.join(path.dirname(resolvedReleaseRoot), "current"),
  );
  return {
    dataDir: resolvedDataDir,
    releaseRoot: resolvedReleaseRoot,
    currentLink: resolvedCurrentLink,
  };
}

module.exports = { defaultDataDir, resolveRuntimePaths };
