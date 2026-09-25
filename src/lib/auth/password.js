const DEFAULT_INITIAL_PASSWORD = "123456";
const PLACEHOLDER_PASSWORDS = new Set([
  "123456",
  "change-me",
  "change-me-in-production",
  "change-me-to-a-long-random-secret",
  "password",
  "changeme",
]);

export function isStrongInitialPassword(value) {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized.length >= 12 && !PLACEHOLDER_PASSWORDS.has(normalized.toLowerCase());
}

export function getInitialPassword(env = process.env) {
  const configured = typeof env.INITIAL_PASSWORD === "string" ? env.INITIAL_PASSWORD.trim() : "";
  if (!configured) return DEFAULT_INITIAL_PASSWORD;
  if (env.NODE_ENV !== "production" || configured === DEFAULT_INITIAL_PASSWORD) return configured;
  return isStrongInitialPassword(configured) ? configured : null;
}

export function isPlaceholderPassword(value) {
  return PLACEHOLDER_PASSWORDS.has(String(value || "").trim().toLowerCase());
}
