#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");

function syncFile(filePath) {
  const fd = fs.openSync(filePath, "r");
  try {
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

function syncDirectory(directory) {
  try {
    const fd = fs.openSync(directory, "r");
    try {
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    // Some filesystems do not allow fsync on directories; the rename is still atomic.
  }
}

function loadDatabaseConstructor() {
  const appRoot = process.env.APP_ROOT || process.cwd();
  const requireFromApp = createRequire(path.join(appRoot, "package.json"));
  return requireFromApp("better-sqlite3");
}

function validateSqlite(filePath, Database = loadDatabaseConstructor()) {
  if (!fs.existsSync(filePath)) return false;
  let db;
  try {
    db = new Database(filePath, { readonly: true, fileMustExist: true });
    return db.pragma("integrity_check", { simple: true }) === "ok";
  } catch {
    return false;
  } finally {
    try {
      db?.close();
    } catch {
      // The validation result is already determined.
    }
  }
}

function copyMissing(source, target, relative = "") {
  fs.mkdirSync(target, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const sourcePath = path.join(source, entry.name);
    const relativePath = path.join(relative, entry.name);
    if (relativePath === path.join("db", "data.sqlite") || relativePath.startsWith(`db${path.sep}data.sqlite-`)) continue;

    const targetPath = path.join(target, entry.name);
    if (entry.isDirectory() && !entry.isSymbolicLink()) {
      copyMissing(sourcePath, targetPath, relativePath);
    } else if (!fs.existsSync(targetPath)) {
      fs.cpSync(sourcePath, targetPath, {
        recursive: true,
        force: false,
        errorOnExist: false,
        dereference: false,
      });
    }
  }
}

function writeMarker(markerPath) {
  const temporaryPath = `${markerPath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(temporaryPath, "migrated\n", { mode: 0o600 });
  syncFile(temporaryPath);
  fs.renameSync(temporaryPath, markerPath);
  syncDirectory(path.dirname(markerPath));
}

function cleanStagingDirectories(dataDir) {
  for (const entry of fs.readdirSync(dataDir, { withFileTypes: true })) {
    if (entry.isDirectory() && entry.name.startsWith(".legacy-migration-")) {
      fs.rmSync(path.join(dataDir, entry.name), { recursive: true, force: true });
    }
  }
}

function migrateLegacyVolume({
  dataDir = process.env.DATA_DIR || "/app/data",
  migrationDir = process.env.MIGRATION_DATA_DIR || "/migration-data",
  Database = loadDatabaseConstructor(),
} = {}) {
  const resolvedDataDir = path.resolve(dataDir);
  const resolvedMigrationDir = path.resolve(migrationDir);
  const destinationDb = path.join(resolvedDataDir, "db", "data.sqlite");
  const markerPath = path.join(resolvedDataDir, "db", ".legacy-volume-migrated");

  fs.mkdirSync(path.join(resolvedDataDir, "db"), { recursive: true });
  cleanStagingDirectories(resolvedDataDir);

  const destinationExists = fs.existsSync(destinationDb);
  const destinationValid = destinationExists && validateSqlite(destinationDb, Database);
  if (fs.existsSync(markerPath) && destinationValid) {
    return { status: "already-migrated", destinationDb };
  }
  if (fs.existsSync(markerPath) && !destinationValid) {
    fs.rmSync(markerPath, { force: true });
  }
  if (!fs.existsSync(resolvedMigrationDir)) {
    if (destinationExists && !destinationValid) {
      throw new Error(`Canonical database is invalid and no migration source exists: ${destinationDb}`);
    }
    writeMarker(markerPath);
    return { status: "no-migration-source", destinationDb };
  }

  const stagingDir = path.join(resolvedDataDir, `.legacy-migration-${process.pid}-${Date.now()}`);
  fs.cpSync(resolvedMigrationDir, stagingDir, {
    recursive: true,
    force: false,
    errorOnExist: false,
    dereference: false,
  });

  try {
    const stagedDb = path.join(stagingDir, "db", "data.sqlite");
    const stagedDbExists = fs.existsSync(stagedDb);
    for (const suffix of ["-wal", "-shm"]) {
      if (fs.existsSync(`${stagedDb}${suffix}`)) {
        throw new Error(`Migration source contains an active SQLite sidecar (${path.basename(stagedDb + suffix)}); checkpoint it before migration`);
      }
    }
    if (stagedDbExists && !validateSqlite(stagedDb, Database)) {
      throw new Error(`Migration source contains an invalid SQLite database: ${stagedDb}`);
    }

    copyMissing(stagingDir, resolvedDataDir);

    if (destinationValid) {
      writeMarker(markerPath);
      return { status: "preserved-existing-database", destinationDb };
    }
    if (stagedDbExists) {
      if (destinationExists) {
        const backupPath = `${destinationDb}.invalid-${Date.now()}-${process.pid}`;
        fs.renameSync(destinationDb, backupPath);
        for (const suffix of ["-wal", "-shm"]) {
          const sidecar = `${destinationDb}${suffix}`;
          if (fs.existsSync(sidecar)) fs.renameSync(sidecar, `${backupPath}${suffix}`);
        }
      }
      fs.mkdirSync(path.dirname(destinationDb), { recursive: true });
      fs.renameSync(stagedDb, destinationDb);
      syncDirectory(path.dirname(destinationDb));
      if (!validateSqlite(destinationDb, Database)) {
        throw new Error(`Migrated database failed validation: ${destinationDb}`);
      }
      writeMarker(markerPath);
      return { status: "migrated", destinationDb };
    }
    if (destinationExists) {
      throw new Error(`Canonical database is invalid and migration source has no SQLite database: ${destinationDb}`);
    }
    writeMarker(markerPath);
    return { status: "copied-non-sqlite-migration", destinationDb };
  } finally {
    fs.rmSync(stagingDir, { recursive: true, force: true });
  }
}

if (require.main === module) {
  try {
    const result = migrateLegacyVolume();
    console.log(`[migration] ${result.status}`);
  } catch (error) {
    console.error(`[migration] ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { copyMissing, migrateLegacyVolume, validateSqlite };
