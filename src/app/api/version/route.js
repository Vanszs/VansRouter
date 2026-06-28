import https from "https";
import pkg from "../../../../package.json" with { type: "json" };

const NPM_PACKAGE_NAME = "9router";
const GITHUB_RAW_PKG = "https://raw.githubusercontent.com/Vanszs/VansRouter/main/package.json";

function fetchJson(url) {
  return new Promise((resolve) => {
    const req = https.get(url, { timeout: 4000 }, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          resolve(JSON.parse(data));
        } catch {
          resolve(null);
        }
      });
    });
    req.on("error", () => resolve(null));
    req.on("timeout", () => { req.destroy(); resolve(null); });
  });
}

// Fetch latest version from npm registry
function fetchLatestVersion() {
  return new Promise(async (resolve) => {
    const data = await fetchJson(`https://registry.npmjs.org/${NPM_PACKAGE_NAME}/latest`);
    resolve(data?.version || null);
  });
}

// Fetch version from GitHub main branch package.json
function fetchGitHubVersion() {
  return new Promise(async (resolve) => {
    const data = await fetchJson(GITHUB_RAW_PKG);
    resolve(data?.version || null);
  });
}

function compareVersions(a, b) {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if (pa[i] > pb[i]) return 1;
    if (pa[i] < pb[i]) return -1;
  }
  return 0;
}

export async function GET() {
  const [latestVersion, githubVersion] = await Promise.all([
    fetchLatestVersion(),
    fetchGitHubVersion(),
  ]);
  const currentVersion = pkg.version;
  const hasUpdate = latestVersion ? compareVersions(latestVersion, currentVersion) > 0 : false;

  // githubStatus tells the user whether the GitHub repo already contains the
  // newer npm version or is still behind it.
  let githubStatus = null;
  if (latestVersion && githubVersion) {
    const ghVsNpm = compareVersions(githubVersion, latestVersion);
    const localVsGh = compareVersions(currentVersion, githubVersion);
    if (ghVsNpm >= 0 && localVsGh < 0) {
      githubStatus = "github_ahead"; // GitHub already has the new version
    } else if (ghVsNpm < 0) {
      githubStatus = "github_behind_npm"; // GitHub repo hasn't received the new npm version yet
    } else if (localVsGh > 0) {
      githubStatus = "local_ahead"; // local is ahead of GitHub (unpushed changes)
    } else {
      githubStatus = "current";
    }
  }

  return Response.json({ currentVersion, latestVersion, githubVersion, hasUpdate, githubStatus });
}
