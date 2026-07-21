import { getAdapter } from "../driver.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";

export async function getCachedProviderModels() {
  const db = await getAdapter();
  try {
    const rows = db.all(`SELECT providerId, modelId, kind, ownedBy, capabilities, updatedAt FROM cachedProviderModels`);
    return rows.map((r) => ({
      id: r.modelId.includes("/") ? r.modelId : `${r.ownedBy}/${r.modelId}`,
      object: "model",
      owned_by: r.ownedBy,
      kind: r.kind !== "llm" ? r.kind : undefined,
      capabilities: parseJson(r.capabilities, undefined),
      updatedAt: r.updatedAt,
    }));
  } catch {
    return [];
  }
}

export async function saveCachedProviderModels(models) {
  if (!Array.isArray(models) || models.length === 0) return;
  const db = await getAdapter();
  const now = Date.now();
  const sql = `
    INSERT INTO cachedProviderModels (providerId, modelId, kind, ownedBy, capabilities, updatedAt)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(providerId, modelId) DO UPDATE SET
      kind = excluded.kind,
      ownedBy = excluded.ownedBy,
      capabilities = excluded.capabilities,
      updatedAt = excluded.updatedAt
  `;
  db.transaction(() => {
    for (const m of models) {
      if (!m?.id) continue;
      const ownedBy = m.owned_by || (m.id.includes("/") ? m.id.split("/")[0] : "combo");
      const providerId = ownedBy;
      const modelId = m.id;
      const kind = m.kind || "llm";
      const caps = m.capabilities ? stringifyJson(m.capabilities) : null;
      db.run(sql, [providerId, modelId, kind, ownedBy, caps, now]);
    }
  });
}


export async function clearCachedProviderModels() {
  const db = await getAdapter();
  try {
    db.run(`DELETE FROM cachedProviderModels`);
  } catch {
    /* empty */
  }
}
