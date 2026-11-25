import { getErrorCode, getRelativeTime } from "@/shared/utils";

// Legacy headless rows persisted "api_key"; generic API-key rows use "apikey".
// Expand both so a provider's stats and toggle cover every connection it owns.
export function expandAuthTypes(authTypes) {
  const types = new Set(Array.isArray(authTypes) ? authTypes : [authTypes]);
  if (types.has("apikey")) types.add("api_key");
  return [...types];
}

function getConnectionErrorTag(connection) {
  if (!connection) return null;

  const explicitType = connection.lastErrorType;
  if (explicitType === "runtime_error") return "RUNTIME";
  if (
    explicitType === "upstream_auth_error" ||
    explicitType === "auth_missing" ||
    explicitType === "token_refresh_failed" ||
    explicitType === "token_expired"
  )
    return "AUTH";
  if (explicitType === "upstream_rate_limited") return "429";
  if (explicitType === "upstream_unavailable") return "5XX";
  if (explicitType === "network_error") return "NET";

  const numericCode = Number(connection.errorCode);
  if (Number.isFinite(numericCode) && numericCode >= 400)
    return String(numericCode);

  const fromMessage = getErrorCode(connection.lastError);
  if (fromMessage === "401" || fromMessage === "403") return "AUTH";
  if (fromMessage && fromMessage !== "ERR") return fromMessage;

  const msg = (connection.lastError || "").toLowerCase();
  if (
    msg.includes("runtime") ||
    msg.includes("not runnable") ||
    msg.includes("not installed")
  )
    return "RUNTIME";
  if (
    msg.includes("invalid api key") ||
    msg.includes("token invalid") ||
    msg.includes("revoked") ||
    msg.includes("unauthorized")
  )
    return "AUTH";

  return "ERR";
}

export function getProviderConnectionStats(connections, providerId, authTypes) {
  const types = expandAuthTypes(authTypes);
  const providerConnections = (connections || []).filter(
    (c) => c.provider === providerId && types.includes(c.authType),
  );

  const getEffectiveStatus = (conn) => {
    if (conn.isActive === false) return "disabled";
    const isCooldown = Object.entries(conn).some(
      ([k, v]) =>
        k.startsWith("modelLock_") && v && new Date(v).getTime() > Date.now(),
    );
    return conn.testStatus === "unavailable" && !isCooldown
      ? "active"
      : conn.testStatus;
  };

  // "Connected" = the account exists, is enabled, and is not in a failed state.
  // A freshly added account (testStatus "unknown") still counts, but an expired
  // or unavailable one must not render both "Connected" and "Error" badges.
  const connected = providerConnections.filter((c) => {
    if (c.isActive === false) return false;
    const status = getEffectiveStatus(c);
    return status !== "error" && status !== "expired" && status !== "unavailable";
  }).length;

  const errorConns = providerConnections.filter((c) => {
    const status = getEffectiveStatus(c);
    return status === "error" || status === "expired" || status === "unavailable";
  });

  const error = errorConns.length;
  const total = providerConnections.length;
  const allDisabled =
    total > 0 && providerConnections.every((c) => c.isActive === false);

  const latestError = errorConns.sort(
    (a, b) => new Date(b.lastErrorAt || 0) - new Date(a.lastErrorAt || 0),
  )[0];
  const errorCode = latestError ? getConnectionErrorTag(latestError) : null;
  const errorTime = latestError?.lastErrorAt
    ? getRelativeTime(latestError.lastErrorAt)
    : null;

  return { connected, error, errorCode, errorTime, allDisabled, total };
}
