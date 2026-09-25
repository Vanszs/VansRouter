import { NextResponse } from "next/server";
import { spawn } from "node:child_process";
import { killAppProcesses } from "@/lib/appUpdater";
import { detectRuntime, updateAndRestartCommand } from "@/shared/utils/runtime";

// POST /api/version/shutdown
//
// Gracefully shut down the running server so the npm install can replace
// files. If the current runtime supports self-restart (PM2, systemd, screen,
// tmux, Docker), spawn a detached child that runs the install + restart
// command after a short delay so this server has time to exit first.
// For plain foreground processes (no runtime manager), just exit and let
// the user restart manually.
//
// Request body (all optional):
//   { packageName?: string, mode?: "auto" | "manual" }
//     - packageName: npm package to install (default: from runtime helper)
//     - mode:        "auto"  → spawn detached child if possible
//                    "manual" → only shut down, return install command for user
//
// Response:
//   { success, message, runtime, mode, autoRestart: boolean,
//     installCommand?: string, // when mode="manual" or runtime unsupported
//     autoRestartCommand?: string }
export async function POST(request) {
  // Detect runtime as early as possible — it informs the response shape.
  const runtime = detectRuntime();

  let body = {};
  try {
    body = await request.json();
  } catch {
    // body may be empty for the simple "just shut down" call
  }
  const packageName = body.packageName || "vansrouter";
  const mode = body.mode === "manual" ? "manual" : "auto";

  // Best effort: kill sibling processes that might hold file locks
  // (cloudflared, MITM child, stray next-server).
  try {
    await killAppProcesses();
  } catch { /* best effort */ }

  const updateCommand = updateAndRestartCommand(runtime, packageName);
  const canAutoRestart = mode === "auto" && updateCommand !== null;

  // If we can auto-restart, spawn a detached child that will install the
  // new version and bring the server back up. The child must outlive
  // process.exit(0) below — detached + unref ensures that.
  if (canAutoRestart) {
    try {
      const child = spawn(
        "bash",
        ["-c", `sleep 2 && ${updateCommand}`],
        {
          detached: true,
          stdio: "ignore",
          // Inherit current working directory and most env vars. Drop
          // PM2-specific vars so the child isn't mistaken for a managed
          // process by itself.
          env: {
            ...process.env,
            PM2_HOME_PATH: undefined,
            pm2_env: undefined,
            PM2_JSON_PROCESSING: undefined,
          },
        },
      );
      child.unref();
    } catch {
      // If spawn fails we still proceed with the shutdown — the user can
      // run the install manually.
    }
  }

  // Schedule the actual exit. 1500ms gives the response time to flush
  // and the killAppProcesses to finish cleaning up.
  setTimeout(() => process.exit(0), 1500);

  return NextResponse.json({
    success: true,
    runtime,
    mode,
    autoRestart: canAutoRestart,
    autoRestartCommand: canAutoRestart ? updateCommand : undefined,
    installCommand: !canAutoRestart ? updateCommand : undefined,
    message: canAutoRestart
      ? `Update scheduled. Server will exit in ~1.5s, then ${runtime} will install v${packageName}@latest and restart automatically.`
      : runtime === "direct"
        ? `Shutting down. Server is running in foreground — manually restart with: \`${packageName}\``
        : `Shutting down. After exit, run this command to update: \`${updateCommand || `npm i -g ${packageName}@latest`}\``,
  });
}
