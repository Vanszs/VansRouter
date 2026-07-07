// Migration 003: add allowedProviders/allowedCombos/allowedKinds columns to apiKeys
// for legacy databases that pre-date the permissions refactor.
// The column addition is idempotent: skipped if the column already exists.
const migration = {
  version: 3,
  name: "add-allowed-lists-columns",
  up(db) {
    const rows = db.all("PRAGMA table_info(apiKeys)");
    const columns = Array.isArray(rows) ? rows.map((row) => row.name) : [];
    if (!columns.includes("allowedProviders")) {
      db.exec("ALTER TABLE apiKeys ADD COLUMN allowedProviders TEXT");
    }
    if (!columns.includes("allowedCombos")) {
      db.exec("ALTER TABLE apiKeys ADD COLUMN allowedCombos TEXT");
    }
    if (!columns.includes("allowedKinds")) {
      db.exec("ALTER TABLE apiKeys ADD COLUMN allowedKinds TEXT");
    }
  },
};

export default migration;
