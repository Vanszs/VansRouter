// Verify schema migration chain runs correctly across versions.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

let tempDir;
const originalDataDir = process.env.DATA_DIR;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-mig-"));
  process.env.DATA_DIR = tempDir;
  // Reset global singleton so each test gets fresh adapter pointed at tempDir
  delete global._dbAdapter;
  vi.resetModules();
});

afterEach(() => {
  // Close adapter to release file handles before rm
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter;
  vi.doUnmock("@/lib/db/migrate.js");
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

describe("Schema migrations", () => {
  it("fresh DB → applies migrations & stamps schemaVersion", async () => {
    const { getAdapter } = await import("@/lib/db/driver.js");
    const { latestVersion } = await import("@/lib/db/migrations/index.js");
    const db = await getAdapter();
    const row = db.get(`SELECT value FROM _meta WHERE key='schemaVersion'`);
    expect(parseInt(row.value, 10)).toBe(latestVersion());

    const tables = db.all(`SELECT name FROM sqlite_master WHERE type='table'`).map(t => t.name);
    expect(tables).toEqual(expect.arrayContaining([
      "_meta", "settings", "providerConnections", "providerNodes",
      "proxyPools", "apiKeys", "combos", "kv", "usageHistory", "usageDaily", "requestDetails",
    ]));
  });

  it("existing DB at older schemaVersion → re-applies pending migrations on restart", async () => {
    // 1st boot
    const { getAdapter } = await import("@/lib/db/driver.js");
    const db = await getAdapter();
    db.run(`INSERT INTO settings(id, data) VALUES(1, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data`, ['{"foo":"bar"}']);
    db.run(`UPDATE _meta SET value = '0' WHERE key = 'schemaVersion'`);
    db.close?.();

    // 2nd boot: full reset to simulate process restart
    delete global._dbAdapter;
    vi.resetModules();
    const { getAdapter: getAdapter2 } = await import("@/lib/db/driver.js");
    const { latestVersion } = await import("@/lib/db/migrations/index.js");
    const db2 = await getAdapter2();
    const row = db2.get(`SELECT value FROM _meta WHERE key='schemaVersion'`);
    expect(parseInt(row.value, 10)).toBe(latestVersion());

    const settings = db2.get(`SELECT data FROM settings WHERE id=1`);
    expect(JSON.parse(settings.data)).toEqual({ foo: "bar" });
  });

  it("fresh DB + legacy db.json → imports data automatically", async () => {
    // Simulate user upgrading: place legacy JSON in DATA_DIR before first boot
    const legacy = {
      settings: { foo: "legacy-value" },
      apiKeys: [{ id: "k1", key: "abc", name: "test", createdAt: new Date().toISOString() }],
      modelAliases: { "gpt-4": "gpt-4-turbo" },
    };
    fs.writeFileSync(path.join(tempDir, "db.json"), JSON.stringify(legacy));

    const { getAdapter } = await import("@/lib/db/driver.js");
    const db = await getAdapter();

    const settings = db.get(`SELECT data FROM settings WHERE id=1`);
    expect(JSON.parse(settings.data)).toEqual({ foo: "legacy-value" });

    const keys = db.all(`SELECT * FROM apiKeys`);
    expect(keys).toHaveLength(1);
    expect(keys[0].key).toBe("abc");

    const aliases = db.all(`SELECT * FROM kv WHERE scope='modelAliases'`);
    expect(aliases).toHaveLength(1);
  });

  it("version 4 DB → adds context_length and preserves combo data", async () => {
    const { getAdapter } = await import("@/lib/db/driver.js");
    const db = await getAdapter();
    db.run(`INSERT INTO combos(id, name, kind, models, context_length, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?, ?)`, [
      "combo-1", "legacy-combo", "fallback", '["m1"]', 128000, "2024-01-01", "2024-01-01",
    ]);
    db.exec(`ALTER TABLE combos DROP COLUMN context_length`);
    db.run(`UPDATE _meta SET value = '4' WHERE key = 'schemaVersion'`);
    db.close?.();

    delete global._dbAdapter;
    vi.resetModules();
    const { getAdapter: getAdapter2 } = await import("@/lib/db/driver.js");
    const { latestVersion } = await import("@/lib/db/migrations/index.js");
    const db2 = await getAdapter2();
    expect(db2.all(`PRAGMA table_info(combos)`).map((c) => c.name)).toContain("context_length");
    expect(db2.get(`SELECT name, models FROM combos WHERE id = 'combo-1'`)).toEqual({ name: "legacy-combo", models: '["m1"]' });
    expect(parseInt(db2.get(`SELECT value FROM _meta WHERE key='schemaVersion'`).value, 10)).toBe(latestVersion());
  });

  it("failed migration can retry on the same adapter", async () => {
    const { createSqlJsAdapter } = await import("@/lib/db/adapters/sqljsAdapter.js");
    const { runMigrationOnce } = await import("@/lib/db/migrate.js");
    const adapter = await createSqlJsAdapter(path.join(tempDir, "retry.sqlite"));
    let fail = true;
    const transaction = adapter.transaction;
    adapter.transaction = (fn) => {
      if (fail) {
        fail = false;
        throw new Error("transient migration failure");
      }
      return transaction(fn);
    };

    await expect(runMigrationOnce(adapter)).rejects.toThrow("transient migration failure");
    await expect(runMigrationOnce(adapter)).resolves.toBeUndefined();
    expect(parseInt(adapter.get(`SELECT value FROM _meta WHERE key='schemaVersion'`).value, 10)).toBe(8);
    expect(adapter.all(`PRAGMA table_info(combos)`).map((c) => c.name)).toContain("context_length");
    adapter.close();
  });

  it("getAdapter retries after initialization failure", async () => {
    let attempts = 0;
    vi.doMock("@/lib/db/migrate.js", async () => {
      const actual = await vi.importActual("@/lib/db/migrate.js");
      return {
        ...actual,
        runMigrationOnce: async (adapter) => {
          attempts += 1;
          if (attempts === 1) throw new Error("transient initialization failure");
          return actual.runMigrationOnce(adapter);
        },
      };
    });

    const { getAdapter } = await import("@/lib/db/driver.js");
    await expect(getAdapter()).rejects.toThrow("transient initialization failure");
    const db = await getAdapter();

    expect(attempts).toBe(2);
    expect(db.driver).toBeDefined();
    expect(db.get("SELECT value FROM _meta WHERE key = 'schemaVersion'")).toBeTruthy();
    db.close?.();
  });

  it("auto-sync re-creates missing index when DB lacks it", async () => {
    const { getAdapter } = await import("@/lib/db/driver.js");
    const db = await getAdapter();
    db.exec(`DROP INDEX IF EXISTS idx_pn_type`);
    expect(db.all(`PRAGMA index_list(providerNodes)`).map(i => i.name)).not.toContain("idx_pn_type");
    db.close?.();

    delete global._dbAdapter;
    vi.resetModules();
    const { getAdapter: getAdapter2 } = await import("@/lib/db/driver.js");
    const db2 = await getAdapter2();
    const idx = db2.all(`PRAGMA index_list(providerNodes)`).map(i => i.name);
    expect(idx).toContain("idx_pn_type");
  });
});
