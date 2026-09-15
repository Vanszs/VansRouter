// NOTE: driver.js → migrate.js → metaStore.js → driver.js forms a static import cycle,
// but all cross-module references use dynamic `await import()` which breaks the cycle at runtime.
import fs from "node:fs";
import path from "node:path";
import { ensureDirs, DATA_FILE, BACKUPS_DIR } from "./paths.js";

// Use global to survive Next.js dev hot-reload (module state resets on reload)
if (!global._dbAdapter) global._dbAdapter = { instance: null, initPromise: null, logged: false };
const state = global._dbAdapter;

/**
 * Pre-flight integrity check (PRAGMA quick_check) to detect and auto-recover from
 * truncated or corrupt SQLite files (e.g. abrupt SIGKILL / OS crash before WAL checkpoint).
 */
async function verifyDatabaseIntegrity(file) {
  if (!fs.existsSync(file)) return true;
  try {
    if (fs.statSync(file).size === 0) return true;
  } catch {
    return true;
  }

  // Check with bun:sqlite if running under Bun
  if (process.versions.bun) {
    let bunDb = null;
    try {
      const { Database } = await import("bun:sqlite");
      bunDb = new Database(file, { readonly: true });
      const row = bunDb.prepare("PRAGMA quick_check;").get();
      return row?.quick_check === "ok";
    } catch {
      return false;
    } finally {
      try { bunDb?.close(); } catch {}
    }
  }

  // Check with better-sqlite3 first (standard Node driver)
  let betterDb = null;
  try {
    const Database = (await import("better-sqlite3")).default;
    betterDb = new Database(file, { readonly: true, fileMustExist: true });
    const row = betterDb.pragma("quick_check");
    const isOk = Array.isArray(row) ? row[0]?.quick_check === "ok" : (row?.quick_check === "ok" || row === "ok");
    return Boolean(isOk);
  } catch {
    // If better-sqlite3 fails or isn't built, try node:sqlite
  } finally {
    try { betterDb?.close(); } catch {}
  }

  // Fallback to node:sqlite (Node >= 22.5)
  let nodeDb = null;
  try {
    const { DatabaseSync } = await import("node:sqlite");
    nodeDb = new DatabaseSync(file, { readOnly: true });
    const row = nodeDb.prepare("PRAGMA quick_check;").get();
    return row?.quick_check === "ok";
  } catch {
    return false;
  } finally {
    try { nodeDb?.close(); } catch {}
  }
}

async function checkAndRecoverDatabase() {
  if (!fs.existsSync(DATA_FILE)) return;
  const isHealthy = await verifyDatabaseIntegrity(DATA_FILE);
  if (isHealthy) return;

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const corruptFile = `${DATA_FILE}.corrupt-${stamp}`;
  console.error(`[DB] ❌ CRITICAL: ${DATA_FILE} is malformed or corrupted! Quarantining to ${corruptFile}...`);

  try {
    fs.renameSync(DATA_FILE, corruptFile);
    // Also quarantine any detached WAL / SHM files
    for (const ext of ["-wal", "-shm"]) {
      const aux = `${DATA_FILE}${ext}`;
      if (fs.existsSync(aux)) fs.renameSync(aux, `${corruptFile}${ext}`);
    }
  } catch (e) {
    console.error(`[DB] Failed to quarantine corrupt database: ${e.message}`);
  }

  // Scan BACKUPS_DIR for candidate backups to restore from
  if (fs.existsSync(BACKUPS_DIR)) {
    const candidates = [];
    try {
      const entries = fs.readdirSync(BACKUPS_DIR, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isFile() && entry.name.endsWith(".sqlite")) {
          candidates.push(path.join(BACKUPS_DIR, entry.name));
        } else if (entry.isDirectory()) {
          const sub = path.join(BACKUPS_DIR, entry.name, "data.sqlite");
          if (fs.existsSync(sub)) candidates.push(sub);
        }
      }
    } catch {}

    candidates.sort((a, b) => {
      try {
        return fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs;
      } catch {
        return 0;
      }
    });

    for (const candidate of candidates) {
      if (await verifyDatabaseIntegrity(candidate)) {
        try {
          fs.copyFileSync(candidate, DATA_FILE);
          console.warn(`[DB] ✅ Auto-recovered healthy database from backup: ${candidate}`);
          return;
        } catch (e) {
          console.error(`[DB] Failed restoring backup ${candidate}: ${e.message}`);
        }
      }
    }
  }

  throw new Error(
    `[DB] FATAL: ${DATA_FILE} is malformed and no valid backup was found in ${BACKUPS_DIR}. ` +
    `Refusing to initialize a fresh empty database to prevent silent data loss. ` +
    `Preserved corrupt copy at ${corruptFile}.`
  );
}

async function tryBunSqlite() {
  // Bun runtime only — built-in, no install needed
  if (!process.versions.bun) return null;
  try {
    const { createBunSqliteAdapter } = await import("./adapters/bunSqliteAdapter.js");
    return await createBunSqliteAdapter(DATA_FILE);
  } catch (e) {
    console.warn(`[DB] bun:sqlite unavailable: ${e.message}`);
    return null;
  }
}

async function tryBetterSqlite() {
  // Skip on Bun — better-sqlite3 native bindings unsupported
  if (process.versions.bun) return null;
  try {
    const { createBetterSqliteAdapter } = await import("./adapters/betterSqliteAdapter.js");
    return createBetterSqliteAdapter(DATA_FILE);
  } catch (e) {
    console.warn(`[DB] better-sqlite3 unavailable: ${e.message}`);
    return null;
  }
}

async function tryNodeSqlite() {
  // Built-in since Node 22.5.0 — no install needed. Skip under Bun (no node:sqlite).
  if (process.versions.bun) return null;
  const [maj, min] = process.versions.node.split(".").map(Number);
  if (maj < 22 || (maj === 22 && min < 5)) return null;
  try {
    const { createNodeSqliteAdapter } = await import("./adapters/nodeSqliteAdapter.js");
    return await createNodeSqliteAdapter(DATA_FILE);
  } catch (e) {
    console.warn(`[DB] node:sqlite unavailable: ${e.message}`);
    return null;
  }
}

async function trySqlJs() {
  try {
    const { createSqlJsAdapter } = await import("./adapters/sqljsAdapter.js");
    return await createSqlJsAdapter(DATA_FILE);
  } catch (e) {
    console.warn(`[DB] sql.js unavailable: ${e.message}`);
    return null;
  }
}

async function initAdapter() {
  ensureDirs();
  await checkAndRecoverDatabase();
  // Order per runtime:
  //   Bun:  bun:sqlite → sql.js
  //   Node: better-sqlite3 → node:sqlite (≥22.5) → sql.js
  let adapter = await tryBunSqlite();
  if (!adapter) adapter = await tryBetterSqlite();
  if (!adapter) adapter = await tryNodeSqlite();
  if (!adapter) adapter = await trySqlJs();
  if (!adapter) throw new Error("[DB] No SQLite driver available (bun/better/node/sql.js all failed)");

  if (!state.logged) {
    console.log(`[DB] Driver: ${adapter.driver} | file: ${DATA_FILE}`);
    state.logged = true;
  }

  const { runMigrationOnce } = await import("./migrate.js");
  try {
    await runMigrationOnce(adapter);
    return adapter;
  } catch (error) {
    try { adapter.close?.(); } catch {}
    throw error;
  }
}

export async function getAdapter() {
  if (state.instance) return state.instance;
  if (!state.initPromise) {
    state.initPromise = initAdapter()
      .then((a) => { state.instance = a; return a; })
      .catch((error) => {
        state.initPromise = null;
        throw error;
      });
  }
  return state.initPromise;
}

export function getAdapterSync() {
  if (!state.instance) throw new Error("[DB] adapter not initialized — await getAdapter() first");
  return state.instance;
}
