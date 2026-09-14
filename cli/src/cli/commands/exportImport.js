/**
 * CLI `export` and `import` subcommands.
 *
 * Usage:
 *   9router export > backup.json
 *   9router export --include-secrets > backup.json
 *   9router import backup.json
 *   9router import --port 3003 backup.json
 */

const http = require("http");
const fs = require("fs");

const DEFAULT_PORT = 20128;

function httpGet(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        if (res.statusCode >= 400) {
          return reject(new Error(`HTTP ${res.statusCode}: ${data}`));
        }
        resolve(data);
      });
    }).on("error", reject);
  });
}

function httpPost(url, body) {
  return new Promise((resolve, reject) => {
    const payload = typeof body === "string" ? body : JSON.stringify(body);
    const opts = new URL(url);
    const req = http.request(
      {
        hostname: opts.hostname,
        port: opts.port,
        path: opts.pathname + opts.search,
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          if (res.statusCode >= 400) return reject(new Error(`HTTP ${res.statusCode}: ${data}`));
          resolve(data);
        });
      }
    );
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

async function runExport(args, pkg) {
  let port = DEFAULT_PORT;
  let includeSecrets = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--port" || args[i] === "-p") {
      port = parseInt(args[i + 1], 10) || DEFAULT_PORT;
      i++;
    } else if (args[i] === "--include-secrets") {
      includeSecrets = true;
    } else if (args[i] === "--help" || args[i] === "-h") {
      console.error("Usage: 9router export [--include-secrets] [--port <port>]");
      console.error("  Exports settings to stdout as JSON.");
      console.error("  Pipe to a file: 9router export > backup.json");
      return 0;
    }
  }

  const qs = includeSecrets ? "?includeSecrets=true" : "";
  try {
    const data = await httpGet(`http://localhost:${port}/api/settings/export${qs}`);
    // Validate it's JSON before printing
    JSON.parse(data);
    process.stdout.write(data + "\n");
    return 0;
  } catch (err) {
    console.error(`❌ Export failed: ${err.message}`);
    console.error(`   Is 9router running on port ${port}?`);
    return 1;
  }
}

async function runImport(args, pkg) {
  let port = DEFAULT_PORT;
  let filePath = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--port" || args[i] === "-p") {
      port = parseInt(args[i + 1], 10) || DEFAULT_PORT;
      i++;
    } else if (args[i] === "--help" || args[i] === "-h") {
      console.error("Usage: 9router import <file.json> [--port <port>]");
      console.error("  Imports settings from a JSON backup file.");
      return 0;
    } else if (!args[i].startsWith("-")) {
      filePath = args[i];
    }
  }

  if (!filePath) {
    console.error("❌ Missing file path. Usage: 9router import <file.json>");
    return 1;
  }

  if (!fs.existsSync(filePath)) {
    console.error(`❌ File not found: ${filePath}`);
    return 1;
  }

  let payload;
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    payload = JSON.parse(raw);
  } catch (err) {
    console.error(`❌ Invalid JSON file: ${err.message}`);
    return 1;
  }

  try {
    const data = await httpPost(`http://localhost:${port}/api/settings/import`, payload);
    const result = JSON.parse(data);
    console.log("✅ Import successful!");
    if (result.stats) {
      console.log(`   Providers: ${result.stats.providers}`);
      console.log(`   API Keys: ${result.stats.keys}`);
      console.log(`   Combos: ${result.stats.combos}`);
    }
    return 0;
  } catch (err) {
    console.error(`❌ Import failed: ${err.message}`);
    console.error(`   Is 9router running on port ${port}?`);
    return 1;
  }
}

module.exports = { runExport, runImport };
