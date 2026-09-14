/**
 * CLI `status` subcommand — check if the 9router server is running
 * and report status information.
 *
 * Usage:
 *   9router status              # human-friendly table
 *   9router status --json       # machine-readable JSON
 *   9router status --port 3003  # check specific port
 */
const http = require("http");

const DEFAULT_PORT = 20128;

function httpGet(url, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { timeout: timeoutMs }, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, data });
        }
      });
    });
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("timeout"));
    });
  });
}

function formatUptime(ms) {
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const parts = [];
  if (d) parts.push(`${d}d`);
  if (h) parts.push(`${h}h`);
  if (m) parts.push(`${m}m`);
  parts.push(`${sec}s`);
  return parts.join(" ");
}

async function runStatus(args, pkg) {
  let port = DEFAULT_PORT;
  let jsonOutput = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--json") jsonOutput = true;
    else if (args[i] === "--port" || args[i] === "-p") {
      port = parseInt(args[i + 1], 10) || DEFAULT_PORT;
      i++;
    }
  }

  const base = `http://localhost:${port}`;
  const result = {
    running: false,
    port,
    version: pkg.version,
    uptime: null,
    providers: { connected: 0, total: 0 },
    tunnel: { enabled: false, url: null },
    apiKeys: 0,
    combos: 0,
  };

  try {
    // Check health
    const health = await httpGet(`${base}/api/health`);
    if (health.status !== 200 || !health.data?.ok) {
      return printResult(result, jsonOutput);
    }
    result.running = true;

    // Gather init/settings data
    const [settingsRes, keysRes, combosRes, versionRes] = await Promise.allSettled([
      httpGet(`${base}/api/settings`),
      httpGet(`${base}/api/keys`),
      httpGet(`${base}/api/combos`),
      httpGet(`${base}/api/version`),
    ]);

    if (settingsRes.status === "fulfilled" && settingsRes.value.status === 200) {
      const s = settingsRes.value.data;
      result.tunnel.enabled = !!s.tunnelEnabled;
      result.tunnel.url = s.tunnelUrl || null;
    }

    if (keysRes.status === "fulfilled" && keysRes.value.status === 200) {
      const keys = keysRes.value.data;
      result.apiKeys = Array.isArray(keys) ? keys.length : 0;
    }

    if (combosRes.status === "fulfilled" && combosRes.value.status === 200) {
      const combos = combosRes.value.data;
      result.combos = Array.isArray(combos) ? combos.length : 0;
    }

    if (versionRes.status === "fulfilled" && versionRes.value.status === 200) {
      const v = versionRes.value.data;
      if (v?.version) result.version = v.version;
      if (v?.uptime) result.uptime = formatUptime(v.uptime);
    }

    // Try providers
    try {
      const providersRes = await httpGet(`${base}/api/providers`);
      if (providersRes.status === 200 && Array.isArray(providersRes.data)) {
        result.providers.total = providersRes.data.length;
        result.providers.connected = providersRes.data.filter(
          (p) => p.isActive !== false && (p.connections || []).length > 0
        ).length;
      }
    } catch { /* best effort */ }
  } catch {
    // Server not reachable
  }

  return printResult(result, jsonOutput);
}

function printResult(result, jsonOutput) {
  if (jsonOutput) {
    console.log(JSON.stringify(result, null, 2));
    return 0;
  }

  // Human-friendly table
  const status = result.running ? "🟢 Running" : "🔴 Stopped";
  console.log(`\n  9Router Status\n  ${"─".repeat(40)}`);
  console.log(`  Status:     ${status}`);
  console.log(`  Port:       ${result.port}`);
  console.log(`  Version:    ${result.version}`);
  if (result.uptime) console.log(`  Uptime:     ${result.uptime}`);
  console.log(`  Providers:  ${result.providers.connected} connected / ${result.providers.total} total`);
  console.log(`  Tunnel:     ${result.tunnel.enabled ? `✅ ${result.tunnel.url || "(no URL)"}` : "❌ disabled"}`);
  console.log(`  API Keys:   ${result.apiKeys}`);
  console.log(`  Combos:     ${result.combos}`);
  console.log();

  return 0;
}

module.exports = { runStatus };
