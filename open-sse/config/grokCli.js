/**
 * Client version advertised to cli-chat-proxy.grok.com.
 *
 * The upstream gates on a minimum version and answers HTTP 426 Upgrade Required
 * for anything older, so this default tracks the lowest accepted release.
 * Env: GROK_CLI_VERSION — lets operators clear a future gate without a code
 * change or redeploy. Read once at import time: restart the process to apply.
 */
const GROK_CLI_VERSION_DEFAULT = "1.0.13";

function envGrokCliVersion(def) {
  const raw = process.env.GROK_CLI_VERSION?.trim();
  if (!raw) return def;
  // The upstream compares this value as a version; a malformed one would be
  // rejected the same as an outdated one, so keep only dotted numeric releases.
  if (!/^\d+(\.\d+)*$/.test(raw)) {
    console.warn(
      `[grok-cli] ignoring invalid GROK_CLI_VERSION=${JSON.stringify(raw)} (expected digits and dots)`,
    );
    return def;
  }
  return raw;
}

export const GROK_CLI_VERSION = envGrokCliVersion(GROK_CLI_VERSION_DEFAULT);
export const GROK_CLI_MODEL = "grok-build";
export const GROK_CLI_BASE_URL = "https://cli-chat-proxy.grok.com/v1";
export const GROK_CLI_CLIENT_IDENTIFIER = "grok-shell";
export const GROK_CLI_USER_AGENT = `grok-shell/${GROK_CLI_VERSION} (linux; x86_64)`;

// OAuth device-code endpoints (auth.x.ai) are reached with the pager-prefixed
// User-Agent rather than the inference one. Shape is part of the fingerprint —
// only the version tracks GROK_CLI_VERSION.
export const GROK_CLI_PAGER_USER_AGENT = `grok-pager/${GROK_CLI_VERSION} grok-shell/${GROK_CLI_VERSION} (linux; x86_64)`;

export function supportsGrokCliReasoningEffort(model) {
  // ponytail: unknown models omit effort until live metadata reaches dispatch.
  return /^grok-4\.[56](?:$|-)/.test(String(model || ""));
}
