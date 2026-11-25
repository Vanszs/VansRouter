// Shared OpenCode egress-error policy. Both the free/zen executor and the Go
// executor must classify the same upstream refusals the same way; keeping the
// regexes in one place prevents the two lanes from drifting.
import {
  OPENCODE_IP_LIMIT_POOL_TTL_MS,
  OPENCODE_TRANSIENT_POOL_TTL_MS,
} from "../config/runtimeConfig.js";

export const OPENCODE_IP_LIMIT_BODY = /limit|rate|quota|exhausted|capacity|too many|overload|abusive|unusual activity|suspicious|current network|not available from your current network|try again/i;
export const OPENCODE_HARD_IP_LIMIT_BODY = /abusive|unusual activity|suspicious|current network|not available from your current network/i;
export const OPENCODE_FREE_LIMIT_BODY = /FreeUsageLimitError|free usage limit/i;
// Model/endpoint rejections are not egress faults: rotating the IP cannot fix
// them, and benching a healthy pool would burn the next request too.
const NON_EGRESS_BODY = /model .* is not supported|endpoint is unavailable|model is unavailable|not supported for this model/i;

/**
 * Classify an HTTP refusal as egress-scoped. Returns null when the status is
 * not an OpenCode egress failure, so callers can keep their own special cases.
 */
export function classifyOpencodeEgressError(status, text) {
  const body = String(text || "");
  if (NON_EGRESS_BODY.test(body)) return null;
  if ((status === 429 || status === 403) && OPENCODE_IP_LIMIT_BODY.test(body)) {
    const hardBan = OPENCODE_HARD_IP_LIMIT_BODY.test(body) || OPENCODE_FREE_LIMIT_BODY.test(body);
    return {
      resetsAtMs: Date.now() + (hardBan ? OPENCODE_IP_LIMIT_POOL_TTL_MS : OPENCODE_TRANSIENT_POOL_TTL_MS),
      poolScoped: { reason: hardBan ? "ip-limit" : "rate-limit", deferRotation: true },
    };
  }
  if (status === 403 || status === 429) {
    // No recognizable body: still egress-scoped on the OpenCode lanes.
    return {
      resetsAtMs: Date.now() + OPENCODE_TRANSIENT_POOL_TTL_MS,
      poolScoped: { reason: "egress", deferRotation: true },
    };
  }
  if (status >= 500) {
    return {
      resetsAtMs: Date.now() + OPENCODE_TRANSIENT_POOL_TTL_MS,
      poolScoped: { reason: "upstream-5xx", deferRotation: true },
    };
  }
  return null;
}

export function opencodeNetworkPoolScoped() {
  return {
    reason: "network",
    deferRotation: true,
    resetsAtMs: Date.now() + OPENCODE_TRANSIENT_POOL_TTL_MS,
  };
}
