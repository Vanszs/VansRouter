#!/usr/bin/env node

// The published package must be able to start with its bundled sql.js fallback.
// Native better-sqlite3 and the optional tray are provisioned lazily by the CLI
// when the corresponding feature is actually used.
const { ensureSqliteRuntime } = require("./sqliteRuntime");

try {
  const result = ensureSqliteRuntime({ silent: false });
  if (!result?.sqlJs) {
    console.warn("[9router] SQLite runtime is not ready; the CLI will retry on first launch");
  } else {
    console.log("[9router] bundled SQLite fallback is ready");
  }
} catch (error) {
  console.warn(`[9router] SQLite runtime setup failed: ${error.message}`);
  console.warn("[9router] continuing installation; the CLI will retry on first launch");
}
