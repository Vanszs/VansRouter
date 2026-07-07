// Migration 002: convert empty JSON arrays to NULL for allowedProviders/allowedCombos/allowedKinds.
// Before this change, [] meant "all allowed" (no restriction). After the permissions refactor,
// [] means "none allowed" (block all). Any existing key with "[]" stored was saved under the old
// semantics and must be treated as NULL (unrestricted) to avoid silently blocking all requests.
export default {
  version: 2,
  name: "fix-empty-allowed-lists",
  up(db) {
    const rows = db.all("PRAGMA table_info(apiKeys)");
    const columns = Array.isArray(rows) ? rows.map((row) => row.name) : [];
    if (!columns.includes("allowedProviders")) db.exec("ALTER TABLE apiKeys ADD COLUMN allowedProviders TEXT");
    if (!columns.includes("allowedCombos")) db.exec("ALTER TABLE apiKeys ADD COLUMN allowedCombos TEXT");
    if (!columns.includes("allowedKinds")) db.exec("ALTER TABLE apiKeys ADD COLUMN allowedKinds TEXT");

    db.exec(`UPDATE apiKeys SET allowedProviders = NULL WHERE allowedProviders = '[]'`);
    db.exec(`UPDATE apiKeys SET allowedCombos    = NULL WHERE allowedCombos    = '[]'`);
    db.exec(`UPDATE apiKeys SET allowedKinds     = NULL WHERE allowedKinds     = '[]'`);
  },
};
