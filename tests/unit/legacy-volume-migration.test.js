import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");

// A pid that is guaranteed to be gone: spawn a child, let it exit, reuse its pid.
function deadPid() {
  const { spawnSync } = require("node:child_process");
  return spawnSync(process.execPath, ["-e", "0"]).pid;
}
const { acquireMigrationLock, migrateLegacyVolume } = require("../../docker/migrate-legacy-volume.cjs");

const roots = [];

function tempRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vansrouter-migration-test-"));
  roots.push(root);
  return root;
}

function writeSqlite(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.exec("CREATE TABLE IF NOT EXISTS marker (value TEXT NOT NULL)");
  db.prepare("INSERT INTO marker (value) VALUES (?)").run(value);
  db.close();
}

function readMarker(file) {
  const db = new Database(file, { readonly: true });
  const value = db.prepare("SELECT value FROM marker LIMIT 1").get().value;
  db.close();
  return value;
}

afterEach(() => {
  while (roots.length) fs.rmSync(roots.pop(), { recursive: true, force: true });
});

describe("legacy Docker volume migration", () => {
  it("repairs a partial destination database from a validated source", () => {
    const root = tempRoot();
    const dataDir = path.join(root, "data");
    const migrationDir = path.join(root, "migration");
    const destinationDb = path.join(dataDir, "db", "data.sqlite");
    fs.mkdirSync(path.dirname(destinationDb), { recursive: true });
    fs.writeFileSync(destinationDb, "interrupted copy");
    writeSqlite(path.join(migrationDir, "db", "data.sqlite"), "legacy");

    const result = migrateLegacyVolume({ dataDir, migrationDir, Database });

    expect(result.status).toBe("migrated");
    expect(readMarker(destinationDb)).toBe("legacy");
    expect(fs.existsSync(path.join(dataDir, "db", ".legacy-volume-migrated"))).toBe(true);
  });

  it("does not overwrite a valid canonical database", () => {
    const root = tempRoot();
    const dataDir = path.join(root, "data");
    const migrationDir = path.join(root, "migration");
    const destinationDb = path.join(dataDir, "db", "data.sqlite");
    writeSqlite(destinationDb, "canonical");
    writeSqlite(path.join(migrationDir, "db", "data.sqlite"), "legacy");

    const result = migrateLegacyVolume({ dataDir, migrationDir, Database });

    expect(result.status).toBe("preserved-existing-database");
    expect(readMarker(destinationDb)).toBe("canonical");
  });

  it("fails closed when the source database is invalid", () => {
    const root = tempRoot();
    const dataDir = path.join(root, "data");
    const migrationDir = path.join(root, "migration");
    fs.mkdirSync(path.join(migrationDir, "db"), { recursive: true });
    fs.writeFileSync(path.join(migrationDir, "db", "data.sqlite"), "not sqlite");

    expect(() => migrateLegacyVolume({ dataDir, migrationDir, Database }))
      .toThrow(/invalid SQLite database/);
    expect(fs.existsSync(path.join(dataDir, "db", ".legacy-volume-migrated"))).toBe(false);
  });

  it("preserves a valid canonical database even when the legacy source is corrupt", () => {
    const root = tempRoot();
    const dataDir = path.join(root, "data");
    const migrationDir = path.join(root, "migration");
    const destinationDb = path.join(dataDir, "db", "data.sqlite");
    writeSqlite(destinationDb, "canonical");
    fs.mkdirSync(path.join(migrationDir, "db"), { recursive: true });
    fs.writeFileSync(path.join(migrationDir, "db", "data.sqlite"), "not sqlite");

    const result = migrateLegacyVolume({ dataDir, migrationDir, Database });

    expect(result.status).toBe("preserved-existing-database");
    expect(readMarker(destinationDb)).toBe("canonical");
    expect(fs.existsSync(path.join(dataDir, "db", ".legacy-volume-migrated"))).toBe(true);
  });

  it("does not run a full integrity check on an already-marked database", () => {
    const root = tempRoot();
    const dataDir = path.join(root, "data");
    const migrationDir = path.join(root, "migration");
    const destinationDb = path.join(dataDir, "db", "data.sqlite");
    writeSqlite(destinationDb, "canonical");
    writeSqlite(path.join(migrationDir, "db", "data.sqlite"), "legacy");
    let integrityChecks = 0;

    class CountingDatabase {
      constructor(file, options) {
        this.db = new Database(file, options);
      }

      pragma(statement, options) {
        if (statement === "integrity_check") integrityChecks += 1;
        return this.db.pragma(statement, options);
      }

      close() {
        this.db.close();
      }
    }

    migrateLegacyVolume({ dataDir, migrationDir, Database: CountingDatabase });
    migrateLegacyVolume({ dataDir, migrationDir, Database: CountingDatabase });

    expect(integrityChecks).toBe(1);
  });

  it("copies late non-SQLite migration files after the marker exists", () => {
    const root = tempRoot();
    const dataDir = path.join(root, "data");
    const migrationDir = path.join(root, "migration");
    const destinationDb = path.join(dataDir, "db", "data.sqlite");
    writeSqlite(destinationDb, "canonical");
    fs.mkdirSync(migrationDir, { recursive: true });

    migrateLegacyVolume({ dataDir, migrationDir, Database });
    fs.writeFileSync(path.join(migrationDir, "settings.json"), "{\"enabled\":true}");
    migrateLegacyVolume({ dataDir, migrationDir, Database });

    expect(fs.readFileSync(path.join(dataDir, "settings.json"), "utf8")).toBe("{\"enabled\":true}");
  });

  it("does not clean another migration while the data-directory lock is held", () => {
    const root = tempRoot();
    const dataDir = path.join(root, "data");
    const migrationDir = path.join(root, "migration");
    const stagingDir = path.join(dataDir, ".legacy-migration-other");
    fs.mkdirSync(stagingDir, { recursive: true });
    fs.writeFileSync(path.join(stagingDir, "sentinel"), "keep");
    const release = acquireMigrationLock(dataDir);

    try {
      expect(() => migrateLegacyVolume({ dataDir, migrationDir, Database })).toThrow(/already running/);
      expect(fs.existsSync(path.join(stagingDir, "sentinel"))).toBe(true);
    } finally {
      release();
    }
  });

  // A container that is OOMKilled or force-stopped mid-migration leaves the lock
  // directory behind. Without a liveness check the next boot reads a <6h-old lock
  // and `set -eu` crash-loops the entrypoint for the whole stale window.
  it("reclaims a lock whose owner process is gone, without waiting for the stale window", () => {
    const root = tempRoot();
    const dataDir = path.join(root, "data");
    const migrationDir = path.join(root, "migration");
    const lockPath = path.join(dataDir, ".legacy-migration.lock");
    fs.mkdirSync(lockPath, { recursive: true });
    fs.writeFileSync(path.join(lockPath, "owner.json"), JSON.stringify({ pid: deadPid(), startedAt: new Date().toISOString() }));

    const result = migrateLegacyVolume({ dataDir, migrationDir, Database });

    expect(result.status).toBe("no-migration-source");
    expect(fs.existsSync(lockPath)).toBe(false);
  });

  it("still refuses when the recorded owner is alive", () => {
    const root = tempRoot();
    const dataDir = path.join(root, "data");
    const migrationDir = path.join(root, "migration");
    fs.mkdirSync(migrationDir, { recursive: true });
    const lockPath = path.join(dataDir, ".legacy-migration.lock");
    fs.mkdirSync(lockPath, { recursive: true });
    fs.writeFileSync(
      path.join(lockPath, "owner.json"),
      JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }),
    );

    expect(() => migrateLegacyVolume({ dataDir, migrationDir, Database })).toThrow(/already running/);
  });
});
