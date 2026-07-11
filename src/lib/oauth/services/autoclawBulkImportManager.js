import crypto from "node:crypto";
import { execFile, execFileSync } from "node:child_process";
import path from "node:path";
import { DATA_DIR } from "../../dataDir.js";
import {
  KiroBulkImportManager,
  buildLookupResponse,
} from "./kiroBulkImportManager.js";
import { createProviderConnection, getProviderConnectionById } from "../../../models/index.js";
import {
  recoverAutoclawTokenCheckpoints,
  writeAutoclawTokenCheckpoint,
} from "./autoclawTokenCheckpoint.js";

function noopBrowser() {
  return { close: async () => {}, __ninerouterProxyUrl: null };
}

function findPythonBinary() {
  for (const bin of ["python3", "python"]) {
    try {
      execFileSync(bin, ["--version"], { stdio: "ignore" });
      return bin;
    } catch { /* try next */ }
  }
  return "python3"; // default, will fail with clear ENOENT
}

const PYTHON_BIN = findPythonBinary();

const AUTOCLAW_PROVIDER_ID = "autoclaw";
const MAX_SIGNIN_RETRY_ATTEMPTS = 3;

/**
 * Rotate the session ID in a cliproxy-style URL to get a fresh IP.
 * Format: http://user-region-HK-sid-XXXXXXXX-t-5:pass@host:port
 * We replace the sid value with a new random one so the proxy pool assigns
 * a different IP for the next attempt.
 *
 * If the URL doesn't match the expected pattern, return it unchanged.
 */
function rotateProxySessionId(proxyUrl) {
  if (!proxyUrl) return proxyUrl;
  try {
    const parsed = new URL(proxyUrl);
    if (!parsed.username) return proxyUrl;
    // Match sid-XXXX pattern in username and replace with new random sid
    const newSid = Math.random().toString(36).slice(2, 10);
    const newUsername = parsed.username.replace(/sid-[a-zA-Z0-9_]+/i, `sid-${newSid}`);
    if (newUsername === parsed.username) return proxyUrl; // no sid pattern found
    parsed.username = newUsername;
    return parsed.toString();
  } catch {
    return proxyUrl;
  }
}

async function defaultSocialExchange({ access_token, refresh_token, user_id, user_name, device_id }) {
  const device = device_id || crypto.randomUUID();
  const conn = await createProviderConnection({
    provider: AUTOCLAW_PROVIDER_ID,
    authType: "access_token",
    name: user_name || String(user_id || "autoclaw-import"),
    email: String(user_id || "unknown"),
    accessToken: access_token,
    refreshToken: refresh_token,
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    testStatus: "active",
    lastRefreshAt: new Date().toISOString(),
    providerSpecificData: {
      deviceId: device,
      userName: user_name,
      refreshExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      importedAt: new Date().toISOString(),
    },
  });
  return { connection: conn };
}

async function assertConnectionPersisted(connection) {
  if (!connection?.id) throw new Error("AutoClaw connection save returned no connection id");
  const saved = await getProviderConnectionById(connection.id);
  if (!saved) throw new Error(`AutoClaw connection ${connection.id} was not found in the database after save`);
  return saved;
}

export class AutoclawBulkImportManager extends KiroBulkImportManager {
  constructor({
    browserLauncher,
    socialExchange = defaultSocialExchange,
    storageName = "autoclaw-bulk-import",
  } = {}) {
    super({ browserLauncher: browserLauncher || (async () => noopBrowser()), googleAutomation: null, socialExchange, storageName });
  }

  async processAccount(job, account, workerId, browser = job.browser) {
    // Python subprocess mode — delegates Playwright automation to python -m autoclaw.
    // Python script manages its own browser — no in-process browser lifecycle needed.
    return this._processAccountPythonRetry(job, account, workerId);
  }

  async cancelJob(jobId) {
    const job = this.jobs.get(jobId);
    if (job?._pythonChildren) {
      for (const child of job._pythonChildren.values()) {
        if (child && !child.killed && child.exitCode === null) {
          child.kill("SIGTERM");
        }
      }
      job._pythonChildren.clear();
    }
    return super.cancelJob(jobId);
  }

  async _processAccountPythonRetry(job, account, workerId) {
    let currentProxyUrl = job.proxyUrl || null;

    for (let attempt = 1; attempt <= MAX_SIGNIN_RETRY_ATTEMPTS; attempt++) {
      if (job.cancelRequested) {
        this.finalizeAccount(account, "cancelled", { error: "Job cancelled" });
        return;
      }

      if (attempt > 1) {
        const rotatedProxyUrl = rotateProxySessionId(currentProxyUrl);
        if (rotatedProxyUrl !== currentProxyUrl) {
          this.setAccountStep(account, "retrying_with_fresh_ip", `Retrying with fresh proxy IP (attempt ${attempt}/${MAX_SIGNIN_RETRY_ATTEMPTS})`);
        } else {
          this.setAccountStep(account, "retrying_signin", `Retrying sign-in (attempt ${attempt}/${MAX_SIGNIN_RETRY_ATTEMPTS})`);
        }
        await this.persistJobSnapshot(job, { forcePreview: false });
        currentProxyUrl = rotatedProxyUrl;
      }

      const result = await this._processAccountPython(job, account, workerId, currentProxyUrl, attempt);

      if (result !== "needs_retry") {
        account.password = undefined;
        return;
      }
    }

    this.finalizeAccount(account, "failed", {
      error: `AutoClaw sign-in failed after ${MAX_SIGNIN_RETRY_ATTEMPTS} Python automation attempts.`,
      step: "signin_failed_exhausted",
      message: `Sign-in failed after ${MAX_SIGNIN_RETRY_ATTEMPTS} attempts`,
    });
    account.password = undefined;
    await this.persistJobSnapshot(job, { forcePreview: true });
  }

  /**
   * Python subprocess path — calls python -m autoclaw instead of in-process Playwright.
   * Activated by AUTOCLAW_USE_PYTHON=1. Social exchange, checkpoint, and DB persistence
   * stay identical to the JS path.
   *
   * ponytail: per-account timeout from DEFAULT_MANUAL_TIMEOUT_MS. Add configurable
   * timeout per proxy speed tier if slow proxies cause premature kills.
   */
  async _processAccountPython(job, account, workerId, currentProxyUrl, attempt) {
    const PYTHON_MODULE = "autoclaw";
    const DB_PATH = path.join(DATA_DIR, "db", "data.sqlite");
    const SCRIPT_DIR = path.join(process.cwd(), "scripts", "python");
    const TIMEOUT_MS = 15 * 60_000; // 15 min same as JS path

    this.setAccountStep(account, "python_automation", `Worker ${workerId} invoking ${PYTHON_BIN} -m ${PYTHON_MODULE} (attempt ${attempt})`);
    await this.persistJobSnapshot(job, { forcePreview: false });

    const args = ["-m", PYTHON_MODULE, account.email, account.password];
    if (currentProxyUrl) args.push("--proxy", currentProxyUrl);
    args.push("--db", DB_PATH);
    if (job.engine) args.push("--engine", job.engine);

    const env = {
      ...process.env,
      PYTHONPATH: SCRIPT_DIR,
      PYTHONUNBUFFERED: "1",
    };

    const childPromise = new Promise((resolve, reject) => {
      const child = execFile(
        PYTHON_BIN,
        args,
        { cwd: SCRIPT_DIR, env, timeout: TIMEOUT_MS, maxBuffer: 1024 * 1024 },
        (err, stdout, stderr) => {
          // Residual stderr — catch any lines missed by streaming
          if (stderr) {
            for (const line of String(stderr).split("\n")) {
              const match = line.match(/\[(\w+)\]\s+(.+)/);
              if (match) {
                this.setAccountStep(account, match[1], match[2].trim());
              }
            }
          }
          if (err) {
            if (err.killed) {
              reject(new Error(`Python subprocess timed out after ${TIMEOUT_MS}ms`));
            } else {
              reject(new Error(`Python subprocess exited with code ${err.code}: ${String(stdout || "").slice(0, 200)}`));
            }
            return;
          }
          resolve(stdout);
        }
      );

      // Real-time stderr streaming for live activity log
      let stderrBuf = "";
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk) => {
        stderrBuf += chunk;
        const lines = stderrBuf.split("\n");
        stderrBuf = lines.pop() || ""; // keep incomplete last line
        for (const line of lines) {
          const match = line.match(/\[(\w+)\]\s+(.+)/);
          if (match) {
            this.setAccountStep(account, match[1], match[2].trim());
          }
        }
      });

      const cancelKey = `python-${account.line ?? account.email}`;
      job._pythonChildren = job._pythonChildren || new Map();
      job._pythonChildren.set(cancelKey, child);
    });

    try {
      const stdout = await childPromise;
      const automationResult = JSON.parse(String(stdout).trim());

      if (automationResult.status === "success") {
        this.setAccountStep(account, "exchanging_tokens", "Saving AutoClaw connection (Python)");
        await this.persistJobSnapshot(job, { forcePreview: true });
        writeAutoclawTokenCheckpoint({
          jobId: job.jobId,
          line: account.line,
          email: account.email,
          tokens: {
            accessToken: automationResult.access_token,
            refreshToken: automationResult.refresh_token,
            deviceId: automationResult.device_id,
            userId: automationResult.user_id,
            userName: automationResult.user_name,
          },
        });
        const { connection } = await this.socialExchange({
          access_token: automationResult.access_token,
          refresh_token: automationResult.refresh_token,
          user_id: automationResult.user_id,
          user_name: automationResult.user_name,
          device_id: automationResult.device_id,
        });
        await assertConnectionPersisted(connection);
        this.finalizeAccount(account, "success", {
          connectionId: connection.id,
          step: "connection_saved",
          message: "AutoClaw connection saved successfully (Python)",
        });
        account.runtimeSession = null;
        await this.persistJobSnapshot(job, { forcePreview: true });
        return "done";
      }

      if (automationResult.status === "needs_retry") {
        this.setAccountStep(account, "signin_failed_retry", `Python: ${automationResult.error || "needs retry"}`);
        await this.persistJobSnapshot(job, { forcePreview: false });
        return "needs_retry";
      }

      // needs_manual — no browser to keep open in subprocess mode, treat as terminal
      if (automationResult.status === "needs_manual") {
        this.finalizeAccount(account, "failed_manual_no_browser", {
          error: automationResult.error || "Python automation needs manual assist — not supported in subprocess mode",
          step: "needs_manual_python",
          message: automationResult.error || "Manual assist required but not supported in Python subprocess mode",
        });
        account.runtimeSession = null;
        await this.persistJobSnapshot(job, { forcePreview: true });
        return "done";
      }

      const terminalStatus = ["failed", "failed_invalid_credentials", "failed_timeout", "failed_restricted", "cancelled"].includes(
        automationResult.status
      )
        ? automationResult.status
        : "failed";
      this.finalizeAccount(account, terminalStatus, {
        error: automationResult.error || "Python automation failed.",
        step: terminalStatus,
        message: automationResult.error || "Python automation failed.",
      });
      account.runtimeSession = null;
      await this.persistJobSnapshot(job, { forcePreview: true });
      return "done";
    } catch (error) {
      this.finalizeAccount(account, "failed", {
        error: `Python subprocess error: ${error.message}`,
        step: "python_subprocess_failed",
        message: `Python subprocess error: ${error.message}`,
      });
      account.runtimeSession = null;
      await this.persistJobSnapshot(job, { forcePreview: true });
      return "done";
    } finally {
      if (job._pythonChildren) {
        const cancelKey = `python-${account.line ?? account.email}`;
        const child = job._pythonChildren.get(cancelKey);
        if (child && !child.killed && child.exitCode === null) {
          child.kill("SIGTERM");
        }
        job._pythonChildren.delete(cancelKey);
      }
    }
  }

  async getJobWithPreview(jobId) {
    await recoverAutoclawTokenCheckpoints();
    return super.getJobWithPreview(jobId);
  }

  async getLatestJobWithPreview(options) {
    await recoverAutoclawTokenCheckpoints();
    return super.getLatestJobWithPreview(options);
  }

}

function getSingletonStore() {
  if (!globalThis.__autoclawBulkImportSingleton) {
    globalThis.__autoclawBulkImportSingleton = {
      manager: new AutoclawBulkImportManager(),
    };
  }
  return globalThis.__autoclawBulkImportSingleton;
}

export function getAutoclawBulkImportManager() {
  return getSingletonStore().manager;
}

export { buildLookupResponse };
