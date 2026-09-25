const DEVELOPMENT_DEFAULT_PASSWORD = "123456";
const PLACEHOLDER_PASSWORDS = new Set([
  "123456",
  "change-me",
  "change-me-in-production",
  "change-me-to-a-long-random-secret",
  "password",
  "changeme",
]);

export function getInitialPassword(env = process.env) {
  const configured = typeof env.INITIAL_PASSWORD === "string" ? env.INITIAL_PASSWORD.trim() : "";
  if (env.NODE_ENV !== "production") return configured || DEVELOPMENT_DEFAULT_PASSWORD;
  if (configured.length < 12 || PLACEHOLDER_PASSWORDS.has(configured.toLowerCase())) return null;
  return configured;
}

export function isPlaceholderPassword(value) {
  return PLACEHOLDER_PASSWORDS.has(String(value || "").trim().toLowerCase());
}
