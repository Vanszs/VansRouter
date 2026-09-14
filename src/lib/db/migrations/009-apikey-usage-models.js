// Migration 009: Add usage counters, allowedModels, and rateLimit columns to apiKeys
export default {
  version: 9,
  name: "apikey-usage-models",
  up(db) {
    // Usage counters
    try { db.exec(`ALTER TABLE apiKeys ADD COLUMN totalRequests INTEGER DEFAULT 0`); } catch {}
    try { db.exec(`ALTER TABLE apiKeys ADD COLUMN totalPromptTokens INTEGER DEFAULT 0`); } catch {}
    try { db.exec(`ALTER TABLE apiKeys ADD COLUMN totalCompletionTokens INTEGER DEFAULT 0`); } catch {}
    try { db.exec(`ALTER TABLE apiKeys ADD COLUMN lastUsedAt TEXT`); } catch {}

    // Model restriction: null = all allowed, JSON array = specific models
    try { db.exec(`ALTER TABLE apiKeys ADD COLUMN allowedModels TEXT`); } catch {}

    // Per-key rate limit (RPM). null = use default (60)
    try { db.exec(`ALTER TABLE apiKeys ADD COLUMN rateLimitRpm INTEGER`); } catch {}

    // Index for usage queries
    try { db.exec(`CREATE INDEX IF NOT EXISTS idx_uh_apikey ON usageHistory(apiKey)`); } catch {}

    // Backfill counters from existing usageHistory
    try {
      db.exec(`
        UPDATE apiKeys SET
          totalRequests = COALESCE((SELECT COUNT(*) FROM usageHistory WHERE usageHistory.apiKey = apiKeys.key), 0),
          totalPromptTokens = COALESCE((SELECT SUM(promptTokens) FROM usageHistory WHERE usageHistory.apiKey = apiKeys.key), 0),
          totalCompletionTokens = COALESCE((SELECT SUM(completionTokens) FROM usageHistory WHERE usageHistory.apiKey = apiKeys.key), 0),
          lastUsedAt = (SELECT MAX(timestamp) FROM usageHistory WHERE usageHistory.apiKey = apiKeys.key)
      `);
    } catch {}
  },
};
