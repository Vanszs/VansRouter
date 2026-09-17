import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import nextConfig from "../../next.config.mjs";

const require = createRequire(import.meta.url);
const { webpack } = require("next/dist/compiled/webpack/webpack");
const projectRoot = path.resolve(import.meta.dirname, "../..");
let tempDir;
let bundle;

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-sqlite-bundle-"));
  const entry = path.join(tempDir, "entry.js");
  bundle = path.join(tempDir, "output", "main.cjs");
  fs.writeFileSync(entry, `
    import { getAdapter } from ${JSON.stringify(path.join(projectRoot, "src/lib/db/driver.js"))};
    import assert from 'node:assert/strict';
    (async () => {
      const db = await getAdapter();
      try {
        assert.equal(db.driver, process.versions.bun ? 'bun:sqlite' : 'node:sqlite');
        assert.equal(db.get("SELECT value FROM fixture WHERE id = 1").value, 'keep-me');
        db.run("UPDATE fixture SET starts = starts + 1 WHERE id = 1");
        assert.equal(db.get('PRAGMA integrity_check').integrity_check, 'ok');
      } finally { db.close(); }
    })().catch(error => { console.error(error); process.exitCode = 1; });
  `);
  const config = nextConfig.webpack({
    mode: "production",
    target: "node",
    entry,
    output: { path: path.dirname(bundle), filename: path.basename(bundle), chunkFilename: "[id].cjs" },
    resolve: { alias: { "@": path.join(projectRoot, "src") }, modules: [path.join(projectRoot, "node_modules"), "node_modules"] },
    // Simulate the CLI artifact without its optional native addon. This forces
    optimization: { minimize: false },
    // node:sqlite rather than letting better-sqlite3 hide a broken builtin import.
    externals: [({ request }, callback) => {
      if (request === "better-sqlite3") return callback(null, "commonjs ./missing-native-addon.cjs");
      if (request === "sql.js") return callback(null, "commonjs sql.js");
      callback();
    }],
    plugins: [],
  }, { isServer: true, webpack });
  await new Promise((resolve, reject) => {
    const compiler = webpack(config);
    compiler.run((error, stats) => {
      compiler.close(closeError => {
        if (error || closeError) return reject(error || closeError);
        if (stats.hasErrors()) return reject(new Error(stats.toString({ all: false, errors: true })));
        resolve();
      });
    });
  });
}, 60000);

afterAll(() => {
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
});

const runtimes = [{ name: "Node", executable: process.execPath }];
if (process.env.BUN_BINARY) runtimes.push({ name: "Bun", executable: process.env.BUN_BINARY });

describe("server webpack SQLite imports", () => {
  for (const { name, executable } of runtimes) {
    it(`${name} reopens an existing database without quarantining it`, () => {
      const dataDir = path.join(tempDir, name);
      const dbDir = path.join(dataDir, "db");
      fs.mkdirSync(dbDir, { recursive: true });
      const filename = path.join(dbDir, "data.sqlite");
      const fixture = new DatabaseSync(filename);
      fixture.exec("CREATE TABLE fixture (id INTEGER PRIMARY KEY, value TEXT, starts INTEGER); INSERT INTO fixture VALUES (1, 'keep-me', 0)");
      fixture.close();
      for (let start = 0; start < 2; start++) {
        const child = spawnSync(executable, [bundle], {
          cwd: projectRoot,
          encoding: "utf8",
          timeout: 30000,
          env: { ...process.env, DATA_DIR: dataDir, APPDATA: dataDir, HOME: dataDir, NODE_ENV: "production" },
        });
        expect(child.error, child.stderr).toBeUndefined();
        expect(child.status, child.stdout + child.stderr).toBe(0);
      }
      const reopened = new DatabaseSync(filename, { readOnly: true });
      try {
        expect(reopened.prepare("SELECT value, starts FROM fixture WHERE id = 1").get()).toMatchObject({ value: "keep-me", starts: 2 });
        expect(reopened.prepare("PRAGMA integrity_check").get().integrity_check).toBe("ok");
      } finally { reopened.close(); }
      expect(fs.readdirSync(dbDir).filter(name => name.includes(".corrupt-"))).toEqual([]);
    }, 60000);
  }
});
