// Verify startup integrity check and automatic corruption recovery (Fixes Issue #118)
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

let tempDir;
const originalDataDir = process.env.DATA_DIR;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-corrupt-recovery-"));
  process.env.DATA_DIR = tempDir;
  delete global._dbAdapter;
  vi.resetModules();
});

afterEach(() => {
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter;
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

describe("SQLite corruption detection and recovery", () => {
  it("auto-recovers from newest backup when data.sqlite is malformed", async () => {
    const dbDir = path.join(tempDir, "db");
    const backupsDir = path.join(dbDir, "backups");
    fs.mkdirSync(backupsDir, { recursive: true });

    const mainDb = path.join(dbDir, "data.sqlite");
    const validBackup = path.join(backupsDir, "pre-build-backup.sqlite");

    // 1. Create a healthy backup with a custom table
    const bak = new Database(validBackup);
    bak.exec("CREATE TABLE recovered_accounts (id TEXT PRIMARY KEY, name TEXT);");
    bak.exec("INSERT INTO recovered_accounts VALUES ('acc-1', 'Restored Provider');");
    bak.close();

    // 2. Intentionally create a corrupted main database file
    fs.writeFileSync(mainDb, "SQLite format 3\0THIS IS TRUNCATED MALFORMED JUNK");

    // 3. Initialize adapter - should detect corruption, quarantine, and auto-restore
    const { getAdapter } = await import("@/lib/db/driver.js");
    const db = await getAdapter();

    // Verify the database recovered the table from backup
    const row = db.get("SELECT name FROM recovered_accounts WHERE id = 'acc-1'");
    expect(row?.name).toBe("Restored Provider");

    // Verify the corrupt file was preserved as quarantine
    const files = fs.readdirSync(dbDir);
    const hasQuarantine = files.some((f) => f.includes(".corrupt-"));
    expect(hasQuarantine).toBe(true);
  });

  it("throws fatal error if data.sqlite is corrupt and no valid backups exist", async () => {
    const dbDir = path.join(tempDir, "db");
    fs.mkdirSync(dbDir, { recursive: true });
    const mainDb = path.join(dbDir, "data.sqlite");

    // Create a corrupted file without any backups
    fs.writeFileSync(mainDb, "SQLite format 3\0MALFORMED FILE NO BACKUP");

    const { getAdapter } = await import("@/lib/db/driver.js");
    await expect(getAdapter()).rejects.toThrow(/Refusing to initialize a fresh empty database/);
  });
});
