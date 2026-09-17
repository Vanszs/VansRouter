// NOTE: driver.js → migrate.js → metaStore.js → driver.js forms a static import cycle,
// but all cross-module references use dynamic `await import()` which breaks the cycle at runtime.
import fs from "node:fs";
import { ensureDirs, DATA_FILE } from "./paths.js";

// Use global to survive Next.js dev hot-reload (module state resets on reload)
if (!global._dbAdapter) global._dbAdapter = { instance: null, initPromise: null, logged: false };
const state = global._dbAdapter;

/** Open an existing database read-only, without treating driver failures as corruption. */
async function openIntegrityDatabase(file) {
  if (process.versions.bun) {
    const { Database } = await import("bun:sqlite");
    return new Database(file, { readonly: true });
  }

  const errors = [];
  try {
    const Database = (await import("better-sqlite3")).default;
    return new Database(file, { readonly: true, fileMustExist: true });
  } catch (error) {
    // Native bindings can fail to load at construction rather than import time.
    errors.push(error);
  }
  try {
    const { DatabaseSync } = await import("node:sqlite");
    return new DatabaseSync(file, { readOnly: true });
  } catch (error) {
    errors.push(error);
  }
  throw new AggregateError(errors, `[DB] Cannot open ${file} for a read-only integrity check. Database files were left in place.`);
}

/** Fail closed on any preflight error; backup restoration must be an explicit action. */
async function verifyDatabaseIntegrity(file) {
  try {
    fs.statSync(file);
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }

  const db = await openIntegrityDatabase(file);
  try {
    const rows = db.prepare("PRAGMA quick_check;").all();
    if (!rows.length || rows.some((row) => row.quick_check !== "ok")) {
      throw new Error(`[DB] Integrity check failed for ${file}: ${rows.map((row) => row.quick_check).join("; ") || "no result"}. Database files were left in place.`);
    }
  } finally {
    try { db.close(); } catch {}
  }
  return true;
}

async function tryBunSqlite(errors) {
  // Bun runtime only — built-in, no install needed
  if (!process.versions.bun) return null;
  try {
    const { createBunSqliteAdapter } = await import("./adapters/bunSqliteAdapter.js");
    return await createBunSqliteAdapter(DATA_FILE);
  } catch (e) {
    errors.push(e);
    console.warn(`[DB] bun:sqlite unavailable: ${e.message}`);
    return null;
  }
}

async function tryBetterSqlite(errors) {
  // Skip on Bun — better-sqlite3 native bindings unsupported
  if (process.versions.bun) return null;
  try {
    const { createBetterSqliteAdapter } = await import("./adapters/betterSqliteAdapter.js");
    return createBetterSqliteAdapter(DATA_FILE);
  } catch (e) {
    errors.push(e);
    console.warn(`[DB] better-sqlite3 unavailable: ${e.message}`);
    return null;
  }
}

async function tryNodeSqlite(errors) {
  // Built-in since Node 22.5.0 — no install needed. Skip under Bun (no node:sqlite).
  if (process.versions.bun) return null;
  const [maj, min] = process.versions.node.split(".").map(Number);
  if (maj < 22 || (maj === 22 && min < 5)) return null;
  try {
    const { createNodeSqliteAdapter } = await import("./adapters/nodeSqliteAdapter.js");
    return await createNodeSqliteAdapter(DATA_FILE);
  } catch (e) {
    errors.push(e);
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
  const existingDatabase = await verifyDatabaseIntegrity(DATA_FILE);
  // Native drivers understand WAL; sql.js may only initialize a new database.
  const errors = [];
  let adapter = await tryBunSqlite(errors);
  if (!adapter) adapter = await tryBetterSqlite(errors);
  if (!adapter) adapter = await tryNodeSqlite(errors);
  if (!adapter && existingDatabase) {
    throw new AggregateError(errors, `[DB] No native SQLite driver could initialize ${DATA_FILE}. Refusing sql.js fallback for an existing database because it cannot read SQLite WAL files.`);
  }
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
