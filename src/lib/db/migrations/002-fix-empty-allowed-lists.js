// Migration 002: convert empty JSON arrays to NULL for allowedProviders/allowedCombos/allowedKinds.
// Before this change, [] meant "all allowed" (no restriction). After the permissions refactor,
// [] means "none allowed" (block all). Any existing key with "[]" stored was saved under the old
// semantics and must be treated as NULL (unrestricted) to avoid silently blocking all requests.
//
// NOTE: This migration must be idempotent — the columns may not exist yet if migrating from
// a pre-ACL schema (e.g. 9Router v0.5.x). Migration 003 adds them. Running UPDATE on
// non-existent columns would crash the entire migration chain.
export default {
  version: 2,
  name: "fix-empty-allowed-lists",
  up(db) {
    const rows = db.all("PRAGMA table_info(apiKeys)");
    const columns = Array.isArray(rows) ? rows.map((row) => row.name) : [];

    if (columns.includes("allowedProviders")) {
      db.exec(`UPDATE apiKeys SET allowedProviders = NULL WHERE allowedProviders = '[]'`);
    }
    if (columns.includes("allowedCombos")) {
      db.exec(`UPDATE apiKeys SET allowedCombos    = NULL WHERE allowedCombos    = '[]'`);
    }
    if (columns.includes("allowedKinds")) {
      db.exec(`UPDATE apiKeys SET allowedKinds     = NULL WHERE allowedKinds     = '[]'`);
    }
  },
};
