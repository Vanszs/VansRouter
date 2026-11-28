// Scoped WARP egress for the OpenCode free lane only.
//
// WARP runs in a local Docker container that exposes an HTTP/SOCKS proxy on
// loopback. The host route never changes: only OpenCode free connections point
// at this URL, so every other provider keeps leaving from the server address.
// Rotating recreates the container, which registers a new WARP identity (the
// assigned egress address can repeat).
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const WARP_EGRESS_ID = "warp:local";
export const WARP_EGRESS_CONTAINER = process.env.WARP_EGRESS_CONTAINER || "warp-socks";
const WARP_EGRESS_PORT = Number(process.env.WARP_EGRESS_PORT || 9091);
const WARP_EGRESS_IMAGE = process.env.WARP_EGRESS_IMAGE || "ghcr.io/mon-ius/docker-warp-socks:latest";
export const WARP_EGRESS_URL = `http://127.0.0.1:${WARP_EGRESS_PORT}`;

// Readiness ranges from ~3 s (clean registration) to ~24 s when Cloudflare
// throttles repeated registrations; the budget only affects the error path.
const ROTATE_WAIT_MS = 45_000;
// Re-registering on every fast retry would hammer the WARP API; reuse the
// address that was just issued and make the client wait out the window.
const MIN_ROTATE_INTERVAL_MS = Number(process.env.WARP_EGRESS_MIN_ROTATE_INTERVAL_MS || 60_000);

let rotation = null;
let lastRotation = { at: 0, ip: null };

async function containerRunning() {
  try {
    const { stdout } = await execFileAsync("docker", [
      "inspect", "-f", "{{.State.Running}}", WARP_EGRESS_CONTAINER,
    ], { timeout: 5_000 });
    return String(stdout || "").trim() === "true";
  } catch {
    return false;
  }
}

/** Probe the local WARP proxy: ok only when the trace says warp=on. */
export async function probeWarpEgress() {
  // curl is the same path the deployment was verified with; undici's
  // ProxyAgent hung on the tunnel during startup and burned the whole budget.
  const { stdout } = await execFileAsync("curl", [
    "-sS", "--max-time", "4", "-x", WARP_EGRESS_URL,
    "https://cloudflare.com/cdn-cgi/trace",
  ], { timeout: 6_000 });
  const text = String(stdout || "");
  const ip = /^ip=(.+)$/m.exec(text)?.[1]?.trim() || null;
  return { ok: /^warp=on$/m.test(text) && !!ip, ip };
}

/**
 * Replace the local WARP egress and wait until it carries traffic.
 * Returns {ok, ip, reused} — used=true means the previous address is still in
 * its cooldown window and the caller should just advertise the wait.
 */
export async function rotateWarpEgress({ waitMs = ROTATE_WAIT_MS } = {}) {
  const remaining = MIN_ROTATE_INTERVAL_MS - (Date.now() - lastRotation.at);
  // A deleted container must not be masked by the cooldown: the cached address
  // is only reusable while the process that carries it is still running.
  if (lastRotation.at && remaining > 0 && await containerRunning()) {
    return { ok: true, ip: lastRotation.ip, reused: true, retryAfterMs: remaining };
  }
  // One rotation at a time: concurrent refusals must not fight over the name.
  if (rotation) return rotation;
  rotation = (async () => {
    await execFileAsync("docker", ["rm", "-f", WARP_EGRESS_CONTAINER], { timeout: 30_000 }).catch(() => {});
    await execFileAsync("docker", [
      "run", "-d", "--name", WARP_EGRESS_CONTAINER, "--restart=always",
      "--cap-add", "NET_ADMIN", "--device", "/dev/net/tun",
      "-p", `127.0.0.1:${WARP_EGRESS_PORT}:9091`,
      WARP_EGRESS_IMAGE,
    ], { timeout: 30_000 });
    const deadline = Date.now() + waitMs;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 1_000));
      const status = await probeWarpEgress().catch(() => null);
      if (status?.ok) {
        lastRotation = { at: Date.now(), ip: status.ip };
        return { ...status, reused: false };
      }
    }
    return { ok: false, ip: null, reused: false };
  })().finally(() => { rotation = null; });
  return rotation;
}
