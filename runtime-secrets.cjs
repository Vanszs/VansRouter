#!/usr/bin/env node

const PLACEHOLDER_SECRETS = new Set([
  "change-me-to-a-long-random-secret",
  "change-me-in-production",
  "change-me",
  "changeme",
  "password",
]);

function assertProductionSecrets(env = process.env) {
  if (env.NODE_ENV !== "production") return;
  const invalid = ["JWT_SECRET", "API_KEY_SECRET"].filter((name) => {
    const value = typeof env[name] === "string" ? env[name].trim().toLowerCase() : "";
    return PLACEHOLDER_SECRETS.has(value);
  });
  if (invalid.length) {
    throw new Error(`[config] Replace placeholder production secret(s): ${invalid.join(", ")}`);
  }
}

module.exports = { PLACEHOLDER_SECRETS, assertProductionSecrets };
