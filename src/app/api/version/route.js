import https from "https";
import pkg from "../../../../package.json" with { type: "json" };

// Keep aligned with the published package. Do not revert to legacy `9router`: it reports obsolete versions.
const NPM_PACKAGE_NAME = "vansrouter";
const VERSION_CACHE_TTL_MS = 300000; // cache npm latest lookup for 5m
const VERSION_FAILURE_BACKOFF_MS = 30000; // avoid a request storm when npm is down

// Survive hot reload; one cache per process
const versionCache = (global.__npmVersionCache ??= {
  value: null,
  fetchedAt: 0,
  attemptedAt: 0,
  inFlight: null,
});
versionCache.attemptedAt ??= 0;
versionCache.inFlight ??= null;

// Fetch latest version from npm registry
function fetchLatestVersion() {
  return new Promise((resolve) => {
    const req = https.get(
      `https://registry.npmjs.org/${NPM_PACKAGE_NAME}/latest`,
      { timeout: 4000 },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            resolve(JSON.parse(data).version || null);
          } catch {
            resolve(null);
          }
        });
      }
    );
    req.on("error", () => resolve(null));
    req.on("timeout", () => { req.destroy(); resolve(null); });
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

async function getLatestVersionCached() {
  const now = Date.now();
  if (versionCache.value && now - versionCache.fetchedAt < VERSION_CACHE_TTL_MS) {
    return versionCache.value;
  }
  if (versionCache.inFlight) return versionCache.inFlight;
  if (!versionCache.value && now - versionCache.attemptedAt < VERSION_FAILURE_BACKOFF_MS) {
    return null;
  }

  versionCache.attemptedAt = now;
  versionCache.inFlight = fetchLatestVersion()
    .then((latest) => {
      if (latest) {
        versionCache.value = latest;
        versionCache.fetchedAt = Date.now();
      }
      return latest;
    })
    .finally(() => {
      versionCache.inFlight = null;
    });
  return versionCache.inFlight;
}

export async function GET() {
  // Release smoke tests set this flag so version verification never depends on
  // the public npm registry. Normal server requests retain update checks.
  const latestVersion = process.env.VANROUTER_SKIP_UPDATE_CHECK === "1"
    ? null
    : await getLatestVersionCached();
  const currentVersion = pkg.version;
  const hasUpdate = latestVersion ? compareVersions(latestVersion, currentVersion) > 0 : false;

  return Response.json({
    currentVersion,
    latestVersion,
    hasUpdate,
    buildId: process.env.RELEASE_BUILD_ID || null,
  });
}
