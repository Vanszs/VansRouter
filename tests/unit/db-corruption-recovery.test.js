// Startup must never replace persistent SQLite data, even when a backup is available.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

let tempDir;
let mainDb;
let fixtureDb;
let originalAdapter;
let originalEmit;
const originalDataDir = process.env.DATA_DIR;

function clearDriverMocks() {
  vi.doUnmock("better-sqlite3");
  vi.doUnmock("node:sqlite");
  vi.doUnmock("@/lib/db/adapters/betterSqliteAdapter.js");
  vi.doUnmock("@/lib/db/adapters/nodeSqliteAdapter.js");
  vi.doUnmock("@/lib/db/adapters/sqljsAdapter.js");
}

function createFixture(file) {
  const db = new DatabaseSync(file);
  try {
    db.exec("CREATE TABLE startup_sentinel (id TEXT PRIMARY KEY, value TEXT);");
    db.exec("INSERT INTO startup_sentinel VALUES ('current', 'Keep current data');");
  } finally {
    db.close();
  }
}

beforeEach(() => {
  clearDriverMocks();
  vi.resetModules();
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-integrity-"));
  fs.mkdirSync(path.join(tempDir, "db", "backups"), { recursive: true });
  mainDb = path.join(tempDir, "db", "data.sqlite");
  process.env.DATA_DIR = tempDir;
  originalAdapter = global._dbAdapter;
  originalEmit = process.emit;
  delete global._dbAdapter;
  // Optional native bindings are not required to run these regressions.
  vi.doMock("better-sqlite3", () => {
    throw new Error("better-sqlite3 not installed");
  });
});

afterEach(() => {
  try {
    try { global._dbAdapter?.instance?.close?.(); } catch {}
    fixtureDb?.close();
  } finally {
    fixtureDb = undefined;
    if (originalAdapter === undefined) delete global._dbAdapter;
    else global._dbAdapter = originalAdapter;
    process.emit = originalEmit;
    vi.restoreAllMocks();
    clearDriverMocks();
    vi.resetModules();
    if (originalDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = originalDataDir;
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

describe("SQLite startup integrity preflight", () => {
  it("keeps malformed data in place across retries instead of restoring a valid backup", async () => {
    const backup = path.join(tempDir, "db", "backups", "pre-build-backup.sqlite");
    createFixture(backup);
    const backupBytes = fs.readFileSync(backup);
    const malformedBytes = Buffer.from("SQLite format 3\0THIS IS TRUNCATED MALFORMED JUNK");
    fs.writeFileSync(mainDb, malformedBytes);

    const { getAdapter } = await import("@/lib/db/driver.js");
    for (let attempt = 0; attempt < 2; attempt++) {
      await expect(getAdapter()).rejects.toThrow();
      expect(fs.readFileSync(mainDb)).toEqual(malformedBytes);
      expect(fs.readFileSync(backup)).toEqual(backupBytes);
      expect(fs.readdirSync(path.dirname(mainDb)).sort()).toEqual(["backups", "data.sqlite"]);
    }
  });

  it.each(["import", "constructor"])("uses node:sqlite and preserves the current sentinel when better-sqlite3 fails at %s", async (failureStage) => {
    createFixture(mainDb);
    if (failureStage === "constructor") {
      vi.doMock("better-sqlite3", () => ({
        default: class {
          constructor() { throw new Error("Could not locate the bindings file"); }
        },
      }));
    }
    const { getAdapter } = await import("@/lib/db/driver.js");
    const adapter = await getAdapter();
    expect(adapter.driver).toBe("node:sqlite");
    expect(adapter.get("SELECT value FROM startup_sentinel WHERE id = 'current'")?.value).toBe("Keep current data");
  });

  it("preserves the database and sidecars when all integrity drivers are unavailable", async () => {
    createFixture(mainDb);
    fs.writeFileSync(`${mainDb}-wal`, "unopened WAL sentinel");
    fs.writeFileSync(`${mainDb}-shm`, "unopened SHM sentinel");
    const files = [mainDb, `${mainDb}-wal`, `${mainDb}-shm`];
    const contents = files.map((file) => fs.readFileSync(file));
    const betterError = new Error("better-sqlite3 bindings unavailable");
    const nodeError = new Error("No such built-in module: node:sqlite");
    vi.doMock("better-sqlite3", () => ({
      default: class { constructor() { throw betterError; } },
    }));
    vi.doMock("node:sqlite", () => ({
      DatabaseSync: class { constructor() { throw nodeError; } },
    }));

    const { getAdapter } = await import("@/lib/db/driver.js");
    for (let attempt = 0; attempt < 2; attempt++) {
      const error = await getAdapter().catch((cause) => cause);
      expect(error).toBeInstanceOf(AggregateError);
      expect(error.errors).toEqual([betterError, nodeError]);
      expect(error.message).not.toMatch(/corrupt|malformed/i);
      files.forEach((file, index) => expect(fs.readFileSync(file)).toEqual(contents[index]));
      expect(fs.readdirSync(path.dirname(mainDb)).sort()).toEqual(["backups", "data.sqlite", "data.sqlite-shm", "data.sqlite-wal"]);
    }
  });

  it("preserves the original permission error when opening the database fails", async () => {
    createFixture(mainDb);
    const contents = fs.readFileSync(mainDb);
    const permissionError = Object.assign(new Error("permission denied"), { code: "EACCES" });
    vi.doMock("node:sqlite", () => ({
      DatabaseSync: class {
        constructor() { throw permissionError; }
      },
    }));
    const { getAdapter } = await import("@/lib/db/driver.js");
    const error = await getAdapter().catch((cause) => cause);
    expect(error).toBeInstanceOf(AggregateError);
    expect(error.errors).toContain(permissionError);
    expect(fs.readFileSync(mainDb)).toEqual(contents);
  });

  it("propagates a locked quick_check error unchanged without replacing the database", async () => {
    createFixture(mainDb);
    const contents = fs.readFileSync(mainDb);
    const busyError = Object.assign(new Error("database is locked"), { code: "SQLITE_BUSY" });
    vi.doMock("node:sqlite", () => ({
      DatabaseSync: class {
        prepare() { return { all() { throw busyError; } }; }
        close() {}
      },
    }));
    const { getAdapter } = await import("@/lib/db/driver.js");
    for (let attempt = 0; attempt < 2; attempt++) {
      await expect(getAdapter()).rejects.toBe(busyError);
      expect(fs.readFileSync(mainDb)).toEqual(contents);
    }
  });

  it("rejects a failing quick_check row even when the first row is ok", async () => {
    createFixture(mainDb);
    const contents = fs.readFileSync(mainDb);
    vi.doMock("node:sqlite", () => ({
      DatabaseSync: class {
        prepare() { return { all: () => [{ quick_check: "ok" }, { quick_check: "page 2 is malformed" }] }; }
        close() {}
      },
    }));
    const { getAdapter } = await import("@/lib/db/driver.js");
    await expect(getAdapter()).rejects.toThrow(/page 2 is malformed/);
    expect(fs.readFileSync(mainDb)).toEqual(contents);
  });

  it("does not mistake stat permission failures for a missing database", async () => {
    createFixture(mainDb);
    const contents = fs.readFileSync(mainDb);
    const statError = Object.assign(new Error("stat permission denied"), { code: "EACCES" });
    const statSync = fs.statSync;
    vi.spyOn(fs, "statSync").mockImplementation((file, ...args) => {
      if (file === mainDb) throw statError;
      return statSync(file, ...args);
    });
    const { getAdapter } = await import("@/lib/db/driver.js");
    await expect(getAdapter()).rejects.toBe(statError);
    expect(fs.readFileSync(mainDb)).toEqual(contents);
  });

  it("refuses sql.js after native initialization fails for an existing WAL database", async () => {
    fixtureDb = new DatabaseSync(mainDb);
    fixtureDb.exec("PRAGMA journal_mode = WAL;");
    fixtureDb.exec("CREATE TABLE startup_sentinel (value TEXT);");
    fixtureDb.exec("INSERT INTO startup_sentinel VALUES ('Uncheckpointed current data');");
    const databaseBytes = fs.readFileSync(mainDb);
    const walBytes = fs.readFileSync(`${mainDb}-wal`);
    const betterError = new Error("better adapter unavailable");
    const nodeError = new Error("native initialization failed");
    vi.doMock("@/lib/db/adapters/betterSqliteAdapter.js", () => ({
      createBetterSqliteAdapter() { throw betterError; },
    }));
    vi.doMock("@/lib/db/adapters/nodeSqliteAdapter.js", () => ({
      createNodeSqliteAdapter() { throw nodeError; },
    }));
    const createSqlJsAdapter = vi.fn(() => { throw new Error("unsafe sql.js fallback reached"); });
    vi.doMock("@/lib/db/adapters/sqljsAdapter.js", () => ({ createSqlJsAdapter }));

    const { getAdapter } = await import("@/lib/db/driver.js");
    for (let attempt = 0; attempt < 2; attempt++) {
      const error = await getAdapter().catch((cause) => cause);
      expect(error).toBeInstanceOf(AggregateError);
      expect(error.errors).toEqual([betterError, nodeError]);
      expect(fs.readFileSync(mainDb)).toEqual(databaseBytes);
      expect(fs.readFileSync(`${mainDb}-wal`)).toEqual(walBytes);
    }
    expect(createSqlJsAdapter).not.toHaveBeenCalled();
    expect(fixtureDb.prepare("SELECT value FROM startup_sentinel").get()?.value).toBe("Uncheckpointed current data");
  });
});
