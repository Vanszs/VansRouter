// Migration 004: add comboName column to usageHistory for per-combo usage
// tracking, for legacy databases that pre-date the combo feature.
// Idempotent: skipped if the column already exists.
export default {
  version: 4,
  name: "add-combo-name-column",
  up(db) {
    const rows = db.all("PRAGMA table_info(usageHistory)");
    const columns = Array.isArray(rows) ? rows.map((row) => row.name) : [];
    if (!columns.includes("comboName")) {
      db.exec("ALTER TABLE usageHistory ADD COLUMN comboName TEXT");
    }
  },
};
