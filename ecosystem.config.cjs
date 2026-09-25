const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const root = __dirname;
// Derive the release pointer from the same persistent data root as the app.
// A hard-coded /var/lib fallback makes a PM2 dump resurrect a dead release.
const dataDir = process.env.DATA_DIR || path.join(os.homedir(), ".local", "share", "9router");
const releaseRoot = process.env.RELEASE_ROOT || path.join(dataDir, "releases");
const currentLink = process.env.CURRENT_LINK || path.join(path.dirname(releaseRoot), "current");
const defaultReleaseServer = path.join(currentLink, "server.js");
const configuredReleaseServer = process.env.RELEASE_SERVER;
const releaseServer = process.env.CURRENT_LINK
  ? defaultReleaseServer
  : configuredReleaseServer && fs.existsSync(configuredReleaseServer)
    ? configuredReleaseServer
    : defaultReleaseServer;

module.exports = {
  apps: [{
    name: process.env.PM2_APP_NAME || "9router",
    cwd: root,
    script: path.join(root, "custom-server.js"),
    exec_mode: "fork",
    instances: 1,
    env: {
      NODE_ENV: process.env.NODE_ENV || "production",
      NODE_PATH: "",
      PORT: process.env.PORT || "3003",
      DATA_DIR: dataDir,
      RELEASE_ROOT: releaseRoot,
      CURRENT_LINK: currentLink,
      RELEASE_SERVER: releaseServer,
      RELEASE_BUILD_ID: process.env.RELEASE_BUILD_ID || "",
    },
  }],
};
