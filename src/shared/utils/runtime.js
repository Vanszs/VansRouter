import { readFileSync, existsSync } from "node:fs";

/**
 * Detect the runtime environment that manages this Node.js process.
 *
 * Used by the auto-update flow to decide whether we can spawn a detached
 * install + restart child (PM2 / systemd / screen / tmux / Docker), or
 * have to fall back to the manual copy-and-restart flow.
 *
 * Heuristics are intentionally lightweight (sync reads, no child_process)
 * so this is safe to call from any server-side context.
 *
 * @returns {"pm2"|"systemd"|"screen"|"tmux"|"docker"|"direct"}
 */
export function detectRuntime() {
  if (isPm2()) return "pm2";
  if (isSystemd()) return "systemd";
  if (isTmux()) return "tmux";
  if (isScreen()) return "screen";
  if (isDocker()) return "docker";
  return "direct";
}

function isPm2() {
  // PM2 sets these env vars when running a script under its supervision.
  // PM2_HOME_PATH is set on every PM2-launched process.
  if (process.env.PM2_HOME_PATH) return true;
  if (process.env.PM2_JSON_PROCESSING) return true;
  // Older PM2 versions only set pm2_env; keep as a last fallback.
  if (process.env.pm2_env) return true;
  return false;
}

function isSystemd() {
  // systemd sets INVOCATION_ID for every service it starts.
  if (process.env.INVOCATION_ID) return true;
  // /run/systemd/system exists on systemd-managed hosts.
  if (existsSync("/run/systemd/system")) return true;
  return false;
}

function isScreen() {
  // GNU screen sets STY=localhost.<id> for every window inside it.
  // TERM is usually "screen" too, but STY is the canonical marker.
  return typeof process.env.STY === "string" && process.env.STY.length > 0;
}

function isTmux() {
  // tmux sets TMUX=... for every pane inside a session.
  return typeof process.env.TMUX === "string" && process.env.TMUX.length > 0;
}

function isDocker() {
  // The canonical marker: Docker creates /.dockerenv on container start.
  if (existsSync("/.dockerenv")) return true;
  // Belt-and-suspenders: cgroup often contains "docker" / "containerd" /
  // "kubepods" when running inside a container.
  try {
    const cgroup = readFileSync("/proc/1/cgroup", "utf8");
    if (/docker|containerd|kubepods|buildkit/i.test(cgroup)) return true;
  } catch {
    // /proc/1/cgroup may not be readable; fall through.
  }
  return false;
}

/**
 * Return the shell command sequence that, when run, installs the latest
 * npm package and restarts the currently-running server. Caller is
 * responsible for spawning this detached.
 *
 * Returns null when the runtime cannot self-restart (e.g. plain CLI
 * foreground process without screen/tmux — user has to manually
 * re-run the binary).
 *
 * @param {"pm2"|"systemd"|"screen"|"tmux"|"docker"|"direct"} runtime
 * @param {string} packageName  npm package name (e.g. "vansrouter")
 * @returns {string|null}
 */
export function updateAndRestartCommand(runtime, packageName) {
  const installCmd = `npm i -g ${packageName}@latest --prefer-online`;
  switch (runtime) {
    case "pm2":
      // Detect PM2 process name from process.env (PM2 sets pm2_env.name).
      const pm2Name = readPm2ProcessName() || "vansrouter";
      return `${installCmd} && pm2 restart ${pm2Name}`;
    case "systemd":
      // Convention: systemd unit named after the binary. Best-effort guess
      // — if the unit name differs, user can fix their service file later.
      const unitName = readSystemdUnitName() || packageName;
      return `${installCmd} && sudo systemctl restart ${unitName}`;
    case "screen":
      // Re-launch in a detached screen window named "vansrouter".
      // The user's existing screen session keeps running — they can
      // `screen -r vansrouter` to attach to the new instance.
      return `${installCmd} && screen -dmS vansrouter vansrouter`;
    case "tmux":
      // Re-launch in a detached tmux session named "vansrouter".
      // User can `tmux attach -t vansrouter` to attach to the new instance.
      return `${installCmd} && tmux new-session -d -s vansrouter 'vansrouter'`;
    case "docker":
      // For Docker we can't self-restart inside the container — the host
      // must pull a new image. Return a hint that the user can use
      // watchtower or `docker run` again.
      return `${installCmd} # NOTE: inside Docker — pull new image on host (docker compose pull && up -d) or use Watchtower`;
    case "direct":
    default:
      // Pure foreground (no PM2/systemd/screen/tmux). The user has to
      // re-run the binary manually in their original terminal.
      return null;
  }
}

function readPm2ProcessName() {
  // PM2 exposes the process name via pm2_env (stringified JSON).
  const env = process.env.pm2_env;
  if (!env) return null;
  try {
    const parsed = JSON.parse(env);
    return parsed?.name || null;
  } catch {
    return null;
  }
}

function readSystemdUnitName() {
  // Best-effort: derive unit name from the binary path.
  // Caller can override via systemd unit if the auto-detected name is wrong.
  try {
    const exe = process.execPath.split("/").pop() || "vansrouter";
    return `${exe}.service`;
  } catch {
    return null;
  }
}
