import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");
const { migrateLegacyVolume } = require("../../docker/migrate-legacy-volume.cjs");

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
});
