import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export function resolveRuntimeModuleDir(metaUrl = import.meta.url) {
  try {
    return path.dirname(fileURLToPath(metaUrl));
  } catch {
    return process.cwd();
  }
}

const currentDir = resolveRuntimeModuleDir();
const importRuntimeModule = Function("specifier", "return import(specifier)");

const SUPPORTED_ENGINES = new Set(["chromium", "camoufox", "patchright", "patchright-chrome", "cloakbrowser"]);
export const DEFAULT_BULK_IMPORT_ENGINE = "chromium";

export function normalizeBulkImportEngine(value) {
  if (typeof value !== "string") return DEFAULT_BULK_IMPORT_ENGINE;
  const lower = value.trim().toLowerCase();
  return SUPPORTED_ENGINES.has(lower) ? lower : DEFAULT_BULK_IMPORT_ENGINE;
}

export function buildBrowserProxyOption(proxyUrl) {
  const clean = String(proxyUrl || "").trim();
  if (!clean) return null;
  let parsed;
  try {
    parsed = new URL(clean);
  } catch {
    return { server: clean };
  }
  const server = `${parsed.protocol}//${parsed.host}`;
  const proxy = { server };
  if (parsed.username) proxy.username = decodeURIComponent(parsed.username);
  if (parsed.password) proxy.password = decodeURIComponent(parsed.password);
  return proxy;
}

async function tryLoadRuntimeHelper(filePath) {
  try {
    const mod = await importRuntimeModule(pathToFileURL(filePath).href);
    return mod?.default || mod;
  } catch {
    return null;
  }
}

async function loadRuntimeHelperFromRoot(rootDir, name) {
  if (!rootDir) return null;
  let dir = path.resolve(rootDir);
  for (let depth = 0; depth < 10; depth += 1) {
    for (const relativeFile of [`cli/hooks/${name}.js`, `hooks/${name}.js`]) {
      const candidate = path.join(dir, relativeFile);
      if (!fs.existsSync(candidate)) continue;
      const helper = await tryLoadRuntimeHelper(candidate);
      if (helper) return helper;
    }

    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

async function loadRuntimeHelper(name) {
  const directSpecs = [
    `../../../../cli/hooks/${name}`,
    `../../../../../hooks/${name}`,
    `../../../../hooks/${name}`,
  ];

  for (const spec of directSpecs) {
    const filePath = path.resolve(currentDir, `${spec}.js`);
    if (!fs.existsSync(filePath)) continue;
    const helper = await tryLoadRuntimeHelper(filePath);
    if (helper) return helper;
  }

  const roots = [
    currentDir,
    process.cwd(),
    process.argv?.[1] ? path.dirname(process.argv[1]) : "",
  ];
  for (const root of roots) {
    const helper = await loadRuntimeHelperFromRoot(root, name);
    if (helper) return helper;
  }

  return null;
}

function loadRuntimePlaywright(runtime) {
  try {
    return runtime?.loadPlaywrightModule?.() || null;
  } catch {
    return null;
  }
}

function loadRuntimeCamoufox(runtime) {
  try {
    return runtime?.loadCamoufoxModule?.() || null;
  } catch {
    return null;
  }
}

function loadRuntimePatchright(runtime) {
  try {
    return runtime?.loadPatchrightModule?.() || null;
  } catch {
    return null;
  }
}

async function loadRuntimeCloakBrowser(runtime) {
  try {
    if (runtime?.loadCloakBrowserModuleAsync) {
      return await runtime.loadCloakBrowserModuleAsync() || null;
    }
    return runtime?.loadCloakBrowserModule?.() || null;
  } catch {
    return null;
  }
}

// When a proxy is active, Google login pages are bypassed from the proxy.
// Google aggressively blocks automated logins from proxy/ISP IPs with
// ERR_ABORTED / ERR_CONNECTION_CLOSED. By bypassing Google domains, the
// Google OAuth flow runs on the user's direct IP while AutoClaw / Z.ai /
// provider traffic still goes through the proxy.
//
// Format: Chromium --proxy-bypass-list uses ';' as separator.
const GOOGLE_PROXY_BYPASS_DOMAINS = [
  "*.google.com",
  "*.googleapis.com",
  "*.gstatic.com",
  "*.googleusercontent.com",
  "*.accounts.google.com",
  "*.signin.google.com",
  "*.myaccount.google.com",
].join(";");

function buildProxyBypassArgs(proxyUrl, existingArgs = []) {
  if (!proxyUrl) return existingArgs;
  return [...existingArgs, `--proxy-bypass-list=${GOOGLE_PROXY_BYPASS_DOMAINS}`];
}

async function launchChromium({ proxyUrl, headless = true, args = [] } = {}) {
  let chromium;
  const runtime = await loadRuntimeHelper("playwrightRuntime");
  if (runtime?.ensurePlaywrightRuntime) {
    const ensured = runtime.ensurePlaywrightRuntime({ silent: false });
    if (!ensured?.ok) {
      const err = ensured?.error || new Error("Playwright automation runtime is not available.");
      err.code = err.code || "PLAYWRIGHT_PACKAGE_MISSING";
      throw err;
    }
  }
  const existingRuntimePlaywright = loadRuntimePlaywright(runtime);
  if (existingRuntimePlaywright?.chromium) {
    chromium = existingRuntimePlaywright.chromium;
  } else {
    if (!runtime?.installPlaywrightOnly) {
      const err = new Error(
        "Playwright not installed and runtime helper unavailable. Reinstall wyxrouter, then retry."
      );
      err.code = "PLAYWRIGHT_PACKAGE_MISSING";
      throw err;
    }
    const installed = runtime.installPlaywrightOnly({ silent: false });
    if (!installed.ok) {
      const err = new Error(
        `Playwright auto-install failed: ${installed.reason}. Run "wyxrouter doctor" or reinstall wyxrouter, then retry.`
      );
      err.code = "PLAYWRIGHT_INSTALL_FAILED";
      throw err;
    }
    const installedRuntimePlaywright = loadRuntimePlaywright(runtime);
    if (!installedRuntimePlaywright?.chromium) {
      const err = new Error(
        "Playwright installed into the 9router automation runtime, but Node could not load it. Restart wyxrouter and retry."
      );
      err.code = "PLAYWRIGHT_PACKAGE_MISSING";
      throw err;
    }
    chromium = installedRuntimePlaywright.chromium;
  }
  const options = { headless };
  const finalArgs = buildProxyBypassArgs(proxyUrl, args);
  if (finalArgs.length) options.args = finalArgs;
  const proxy = buildBrowserProxyOption(proxyUrl);
  if (proxy) options.proxy = proxy;
  return chromium.launch(options);
}

async function loadFirefoxForCamoufox() {
  const runtime = await loadRuntimeHelper("playwrightRuntime");
  if (runtime?.ensurePlaywrightRuntime) {
    const ensured = runtime.ensurePlaywrightRuntime({ silent: false });
    if (!ensured?.ok) {
      const err = ensured?.error || new Error("Playwright automation runtime is not available.");
      err.code = err.code || "PLAYWRIGHT_PACKAGE_MISSING";
      throw err;
    }
  }
  const runtimePlaywright = loadRuntimePlaywright(runtime);
  if (runtimePlaywright?.firefox) return runtimePlaywright.firefox;
  if (runtime?.installPlaywrightOnly) {
    const installed = runtime.installPlaywrightOnly({ silent: false });
    if (installed.ok) {
      const installedRuntimePlaywright = loadRuntimePlaywright(runtime);
      if (installedRuntimePlaywright?.firefox) return installedRuntimePlaywright.firefox;
    }
  }
  const friendly = new Error(
    "Playwright is required to drive Camoufox. Reinstall wyxrouter or pick the Chromium engine."
  );
  friendly.code = "PLAYWRIGHT_PACKAGE_MISSING";
  throw friendly;
}

async function launchCamoufox({ proxyUrl, headless = true, args = [] } = {}) {
  let camoufox;
  const runtime = await loadRuntimeHelper("camoufoxRuntime");
  if (runtime?.ensureCamoufoxRuntime) {
    const ensured = runtime.ensureCamoufoxRuntime({ silent: false });
    if (!ensured?.ok) {
      const err = ensured?.error || new Error("Camoufox automation runtime is not available.");
      err.code = err.code || "CAMOUFOX_PACKAGE_MISSING";
      throw err;
    }
  }
  camoufox = loadRuntimeCamoufox(runtime);
  if (!camoufox) {
    if (!runtime?.installCamoufoxOnly) {
      const err = new Error(
        "Camoufox not installed and runtime helper unavailable. Reinstall wyxrouter or pick the Chromium engine."
      );
      err.code = "CAMOUFOX_PACKAGE_MISSING";
      throw err;
    }
    const installed = runtime.installCamoufoxOnly({ silent: false });
    if (!installed.ok) {
      const err = new Error(
        `Camoufox auto-install failed: ${installed.reason}. Restart 9router and retry, or switch back to the Chromium engine.`
      );
      err.code = "CAMOUFOX_INSTALL_FAILED";
      throw err;
    }
    camoufox = loadRuntimeCamoufox(runtime);
  }

  if (!camoufox?.launchOptions) {
    const err = new Error(
      `camoufox-js loaded but does not expose launchOptions(); reinstall the package or pick the Chromium engine.`
    );
    err.code = "CAMOUFOX_API_MISMATCH";
    throw err;
  }

  const firefox = await loadFirefoxForCamoufox();

  const camoufoxOptions = await camoufox.launchOptions({ headless });
  const launchOptions = { ...camoufoxOptions };
  const finalArgs = buildProxyBypassArgs(proxyUrl, [...(launchOptions.args || []), ...args]);
  if (finalArgs.length) launchOptions.args = finalArgs;
  const proxy = buildBrowserProxyOption(proxyUrl);
  if (proxy) launchOptions.proxy = proxy;

  return firefox.launch(launchOptions);
}

async function launchPatchright({ proxyUrl, headless = true, args = [], channel } = {}) {
  const runtime = await loadRuntimeHelper("patchrightRuntime");
  if (runtime?.ensurePatchrightRuntime) {
    const ensured = runtime.ensurePatchrightRuntime({ silent: false });
    if (!ensured?.ok) throw ensured?.error || new Error("Patchright automation runtime is not available.");
  }
  let patchright = loadRuntimePatchright(runtime);
  if (!patchright && runtime?.installPatchrightOnly) {
    const installed = runtime.installPatchrightOnly({ silent: false });
    if (!installed.ok) throw Object.assign(new Error(`Patchright auto-install failed: ${installed.reason}`), { code: "PATCHRIGHT_INSTALL_FAILED" });
    patchright = loadRuntimePatchright(runtime);
  }
  const browserType = channel === "chrome" && patchright?.chromium ? patchright.chromium : patchright?.chromium;
  if (!browserType?.launch) throw Object.assign(new Error("patchright loaded but chromium.launch is unavailable"), { code: "PATCHRIGHT_API_MISMATCH" });
  const options = { headless };
  const finalArgs = buildProxyBypassArgs(proxyUrl, args);
  if (finalArgs.length) options.args = finalArgs;
  if (channel) options.channel = channel;
  const proxy = buildBrowserProxyOption(proxyUrl);
  if (proxy) options.proxy = proxy;
  return browserType.launch(options);
}

async function launchCloakBrowser({ proxyUrl, headless = true, args = [] } = {}) {
  const runtime = await loadRuntimeHelper("cloakBrowserRuntime");
  if (runtime?.ensureCloakBrowserRuntime) {
    const ensured = runtime.ensureCloakBrowserRuntime({ silent: false });
    if (!ensured?.ok) throw ensured?.error || new Error("CloakBrowser automation runtime is not available.");
  }
  const cloakbrowser = await loadRuntimeCloakBrowser(runtime);
  const launcher = cloakbrowser?.launch || cloakbrowser?.default?.launch || cloakbrowser?.chromium?.launch;
  if (!launcher) throw Object.assign(new Error("cloakbrowser loaded but no launch() API is available"), { code: "CLOAKBROWSER_API_MISMATCH" });
  const options = { headless };
  const finalArgs = buildProxyBypassArgs(proxyUrl, args);
  if (finalArgs.length) options.args = finalArgs;
  const proxy = buildBrowserProxyOption(proxyUrl);
  if (proxy) options.proxy = proxy;
  return launcher(options);
}

export async function launchBulkImportBrowser({ engine = DEFAULT_BULK_IMPORT_ENGINE, proxyUrl, headless = true, args = [] } = {}) {
  const normalized = normalizeBulkImportEngine(engine);
  if (normalized === "camoufox") {
    return launchCamoufox({ proxyUrl, headless, args });
  }
  if (normalized === "patchright" || normalized === "patchright-chrome") {
    return launchPatchright({ proxyUrl, headless, args, channel: normalized === "patchright-chrome" ? "chrome" : undefined });
  }
  if (normalized === "cloakbrowser") {
    return launchCloakBrowser({ proxyUrl, headless, args });
  }
  return launchChromium({ proxyUrl, headless, args });
}

export function makeBrowserLauncher({ engine, proxyUrl, headless, args } = {}) {
  return () => launchBulkImportBrowser({ engine, proxyUrl, headless, args });
}
