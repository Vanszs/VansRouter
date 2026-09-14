import { randomUUID } from "node:crypto";
import { getAdapter } from "../driver.js";

// Parse a JSON TEXT column with null=all / []=none semantics.
// DB NULL → null (all allowed). DB "[]" → [] (none). DB "[x]" → [x].
function parsePermList(raw) {
  if (raw === null || raw === undefined) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

// Serialize back: null → null (DB NULL), [] → "[]", [x] → "[x]"
function serializePermList(val) {
  if (val === null || val === undefined) return null;
  return JSON.stringify(Array.isArray(val) ? val : []);
}

function rowToKey(row) {
  if (!row) return null;
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    machineId: row.machineId,
    isActive: row.isActive === 1 || row.isActive === true,
    createdAt: row.createdAt,
    allowedProviders: parsePermList(row.allowedProviders),
    allowedCombos: parsePermList(row.allowedCombos),
    allowedKinds: parsePermList(row.allowedKinds),
    allowedModels: parsePermList(row.allowedModels),
    rateLimitRpm: row.rateLimitRpm ?? null,
    totalRequests: row.totalRequests ?? 0,
    totalPromptTokens: row.totalPromptTokens ?? 0,
    totalCompletionTokens: row.totalCompletionTokens ?? 0,
    lastUsedAt: row.lastUsedAt ?? null,
  };
}

export async function getApiKeys() {
  const db = await getAdapter();
  const rows = db.all(`SELECT * FROM apiKeys ORDER BY createdAt ASC`);
  return rows.map(rowToKey);
}

export async function getApiKeyById(id) {
  const db = await getAdapter();
  const row = db.get(`SELECT * FROM apiKeys WHERE id = ?`, [id]);
  return rowToKey(row);
}

export async function createApiKey(name, machineId) {
  if (!machineId) throw new Error("machineId is required");
  const [db, { generateApiKeyWithMachine }] = await Promise.all([
    getAdapter(),
    import("@/shared/utils/apiKey"),
  ]);
  const result = generateApiKeyWithMachine(machineId);
  const apiKey = {
    id: randomUUID(),
    name,
    key: result.key,
    machineId,
    isActive: true,
    createdAt: new Date().toISOString(),
    allowedProviders: null,
    allowedCombos: null,
    allowedKinds: null,
  };
  db.run(
    `INSERT INTO apiKeys(id, key, name, machineId, isActive, createdAt, allowedProviders, allowedCombos, allowedKinds) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [apiKey.id, apiKey.key, apiKey.name, apiKey.machineId, 1, apiKey.createdAt, null, null, null]
  );
  return apiKey;
}

export async function updateApiKey(id, data) {
  const db = await getAdapter();
  let result = null;
  db.transaction(() => {
    const row = db.get(`SELECT * FROM apiKeys WHERE id = ?`, [id]);
    if (!row) return;
    const current = rowToKey(row);
    // Merge: only override fields explicitly present in data
    const merged = { ...current };
    if (data.isActive !== undefined) merged.isActive = data.isActive;
    if (data.name !== undefined) merged.name = data.name;
    if ("allowedProviders" in data) merged.allowedProviders = data.allowedProviders;
    if ("allowedCombos" in data) merged.allowedCombos = data.allowedCombos;
    if ("allowedKinds" in data) merged.allowedKinds = data.allowedKinds;
    if ("allowedModels" in data) merged.allowedModels = data.allowedModels;
    if ("rateLimitRpm" in data) merged.rateLimitRpm = data.rateLimitRpm;
    db.run(
      `UPDATE apiKeys SET key = ?, name = ?, machineId = ?, isActive = ?, allowedProviders = ?, allowedCombos = ?, allowedKinds = ?, allowedModels = ?, rateLimitRpm = ? WHERE id = ?`,
      [
        merged.key,
        merged.name,
        merged.machineId,
        merged.isActive ? 1 : 0,
        serializePermList(merged.allowedProviders),
        serializePermList(merged.allowedCombos),
        serializePermList(merged.allowedKinds),
        serializePermList(merged.allowedModels),
        merged.rateLimitRpm ?? null,
        id,
      ]
    );
    result = merged;
  });
  return result;
}

export async function deleteApiKey(id) {
  const db = await getAdapter();
  const res = db.run(`DELETE FROM apiKeys WHERE id = ?`, [id]);
  return (res?.changes ?? 0) > 0;
}

export async function validateApiKey(key) {
  const db = await getAdapter();
  const row = db.get(`SELECT * FROM apiKeys WHERE key = ?`, [key]);
  if (!row || row.isActive !== 1 && row.isActive !== true) return null;
  return rowToKey(row);
}

/**
 * Increment usage counters for an API key after a successful request.
 * @param {string} apiKeyStr - The raw API key string
 * @param {number} promptTokens
 * @param {number} completionTokens
 */
export async function incrementApiKeyUsage(apiKeyStr, promptTokens = 0, completionTokens = 0) {
  if (!apiKeyStr) return;
  const db = await getAdapter();
  db.run(
    `UPDATE apiKeys SET totalRequests = totalRequests + 1, totalPromptTokens = totalPromptTokens + ?, totalCompletionTokens = totalCompletionTokens + ?, lastUsedAt = ? WHERE key = ?`,
    [promptTokens || 0, completionTokens || 0, new Date().toISOString(), apiKeyStr]
  );
}

/**
 * Reset usage counters for an API key.
 * @param {string} id - API key UUID
 */
export async function resetApiKeyUsage(id) {
  const db = await getAdapter();
  db.run(
    `UPDATE apiKeys SET totalRequests = 0, totalPromptTokens = 0, totalCompletionTokens = 0, lastUsedAt = NULL WHERE id = ?`,
    [id]
  );
}

/**
 * Get per-key usage breakdown from usageHistory.
 * @param {string} apiKeyStr - The raw API key string
 * @param {string} [period] - "today", "7d", "30d", "all"
 */
export async function getApiKeyUsageDetails(apiKeyStr, period = "all") {
  const db = await getAdapter();
  let where = "WHERE apiKey = ?";
  const params = [apiKeyStr];

  if (period !== "all") {
    const days = period === "today" ? 0 : period === "7d" ? 7 : period === "30d" ? 30 : 0;
    const since = new Date();
    since.setDate(since.getDate() - days);
    if (period === "today") { since.setHours(0, 0, 0, 0); }
    where += " AND timestamp >= ?";
    params.push(since.toISOString());
  }

  const rows = db.all(
    `SELECT model, provider, COUNT(*) as requests, SUM(promptTokens) as promptTokens, SUM(completionTokens) as completionTokens, SUM(cost) as cost FROM usageHistory ${where} GROUP BY model, provider ORDER BY requests DESC`,
    params
  );

  const totals = db.get(
    `SELECT COUNT(*) as requests, SUM(promptTokens) as promptTokens, SUM(completionTokens) as completionTokens, SUM(cost) as cost FROM usageHistory ${where}`,
    params
  );

  return { models: rows || [], totals: totals || { requests: 0, promptTokens: 0, completionTokens: 0, cost: 0 } };
}
