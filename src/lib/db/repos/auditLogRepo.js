import { getAdapter } from "../driver.js";
import { stringifyJson, parseJson } from "../helpers/jsonCol.js";

const MAX_ENTRIES = 10000;
const PRUNE_BATCH = 500; // delete this many oldest when pruning

function rowToLog(row) {
  if (!row) return null;
  return {
    id: row.id,
    timestamp: row.timestamp,
    action: row.action,
    actor: row.actor,
    target: row.target,
    details: parseJson(row.details, null),
    ip: row.ip,
  };
}

/**
 * Record an audit event. Auto-prunes old entries when MAX_ENTRIES exceeded.
 */
export async function auditLog({ action, actor = null, target = null, details = null, ip = null }) {
  const db = await getAdapter();
  const timestamp = new Date().toISOString();
  db.run(
    `INSERT INTO auditLogs(timestamp, action, actor, target, details, ip) VALUES(?, ?, ?, ?, ?, ?)`,
    [timestamp, action, actor, target, stringifyJson(details), ip]
  );

  // Auto-cleanup: keep last MAX_ENTRIES
  try {
    const count = db.get(`SELECT COUNT(*) as cnt FROM auditLogs`);
    if (count?.cnt > MAX_ENTRIES) {
      db.run(
        `DELETE FROM auditLogs WHERE id IN (SELECT id FROM auditLogs ORDER BY id ASC LIMIT ?)`,
        [Math.max(PRUNE_BATCH, count.cnt - MAX_ENTRIES)]
      );
    }
  } catch { /* best effort */ }
}

/**
 * Query audit logs with pagination and filtering.
 */
export async function getAuditLogs({ page = 1, limit = 50, action = null, actor = null, from = null, to = null } = {}) {
  const db = await getAdapter();
  const conditions = [];
  const params = [];

  if (action) {
    conditions.push("action = ?");
    params.push(action);
  }
  if (actor) {
    conditions.push("actor = ?");
    params.push(actor);
  }
  if (from) {
    conditions.push("timestamp >= ?");
    params.push(from);
  }
  if (to) {
    conditions.push("timestamp <= ?");
    params.push(to);
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const offset = (Math.max(1, page) - 1) * limit;

  const countRow = db.get(`SELECT COUNT(*) as cnt FROM auditLogs ${where}`, params);
  const total = countRow?.cnt || 0;

  const rows = db.all(
    `SELECT * FROM auditLogs ${where} ORDER BY id DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );

  return {
    data: rows.map(rowToLog),
    total,
    page,
    limit,
    pages: Math.ceil(total / limit),
  };
}

/**
 * Get distinct actions for filter dropdowns.
 */
export async function getAuditActions() {
  const db = await getAdapter();
  const rows = db.all(`SELECT DISTINCT action FROM auditLogs ORDER BY action`);
  return rows.map((r) => r.action);
}
