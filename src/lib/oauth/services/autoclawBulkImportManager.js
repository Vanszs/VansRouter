import crypto from "node:crypto";
import {
  KiroBulkImportManager,
  createFreshContext,
  buildLookupResponse,
} from "./kiroBulkImportManager.js";
import { createAutoclawTokenMonitor, runAutoclawGoogleAutomation } from "./autoclawAutomation.js";
import { createProviderConnection, getProviderConnectionById } from "../../../models/index.js";
import {
  recoverAutoclawTokenCheckpoints,
  writeAutoclawTokenCheckpoint,
} from "./autoclawTokenCheckpoint.js";

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
    googleAutomation = runAutoclawGoogleAutomation,
    socialExchange = defaultSocialExchange,
    storageName = "autoclaw-bulk-import",
  } = {}) {
    super({ browserLauncher, googleAutomation, socialExchange, storageName });
  }

  async processAccount(job, account, workerId, browser = job.browser) {
    let currentBrowser = browser;
    let currentProxyUrl = browser?.__ninerouterProxyUrl || job.proxyUrl || null;
    let ownsBrowser = false;

    for (let attempt = 1; attempt <= MAX_SIGNIN_RETRY_ATTEMPTS; attempt++) {
      if (job.cancelRequested) {
        this.finalizeAccount(account, "cancelled", { error: "Job cancelled" });
        return;
      }

      // For retry attempts (attempt > 1), close the old browser and launch a
      // new one with a rotated proxy session ID to get a fresh IP.
      if (attempt > 1) {
        if (ownsBrowser && currentBrowser) {
          await currentBrowser.close().catch(() => null);
          currentBrowser = null;
        }
        const rotatedProxyUrl = rotateProxySessionId(currentProxyUrl);
        if (rotatedProxyUrl !== currentProxyUrl) {
          this.setAccountStep(account, "retrying_with_fresh_ip", `Retrying with fresh proxy IP (attempt ${attempt}/${MAX_SIGNIN_RETRY_ATTEMPTS})`);
        } else {
          this.setAccountStep(account, "retrying_signin", `Retrying sign-in (attempt ${attempt}/${MAX_SIGNIN_RETRY_ATTEMPTS})`);
        }
        await this.persistJobSnapshot(job, { forcePreview: false });
        currentProxyUrl = rotatedProxyUrl;

        try {
          currentBrowser = await this.browserLauncher({ ...job, proxyUrl: currentProxyUrl });
          currentBrowser.__ninerouterProxyUrl = currentProxyUrl;
          job.workerBrowsers.add(currentBrowser);
          ownsBrowser = true;
        } catch (e) {
          this.finalizeAccount(account, "failed", {
            error: `Failed to launch browser for retry: ${e.message}`,
            step: "failed",
            message: `Failed to launch browser for retry: ${e.message}`,
          });
          await this.persistJobSnapshot(job, { forcePreview: false });
          return;
        }
      }

      const result = await this.processAccountOnce(job, account, workerId, currentBrowser, currentProxyUrl, attempt);

      // If the automation returned needs_retry, loop again with fresh IP.
      // Otherwise, the account is finalized (success/failed/needs_manual) and
      // we're done.
      if (result !== "needs_retry") {
        account.password = undefined;
        // Clean up owned browser on terminal states
        if (ownsBrowser && currentBrowser) {
          await currentBrowser.close().catch(() => null);
          if (job.workerBrowsers) job.workerBrowsers.delete(currentBrowser);
        }
        return;
      }

      // needs_retry — close context and loop to retry with fresh IP
      this.setAccountStep(account, "signin_failed_retry", `Sign-in failed on attempt ${attempt}/${MAX_SIGNIN_RETRY_ATTEMPTS} — rotating proxy IP`);
      await this.persistJobSnapshot(job, { forcePreview: false });
    }

    // All retry attempts exhausted
    this.finalizeAccount(account, "failed", {
      error: `AutoClaw sign-in failed after ${MAX_SIGNIN_RETRY_ATTEMPTS} attempts with different proxy IPs. The account may be rate-limited or blocked.`,
      step: "signin_failed_exhausted",
      message: `Sign-in failed after ${MAX_SIGNIN_RETRY_ATTEMPTS} attempts`,
    });
    account.password = undefined;
    if (ownsBrowser && currentBrowser) {
      await currentBrowser.close().catch(() => null);
      if (job.workerBrowsers) job.workerBrowsers.delete(currentBrowser);
    }
    await this.persistJobSnapshot(job, { forcePreview: false });
  }

  async processAccountOnce(job, account, workerId, browser, currentProxyUrl, attempt = 1) {
    if (job.cancelRequested || !browser) {
      this.finalizeAccount(account, "cancelled", { error: "Job cancelled" });
      return "done";
    }

    const deviceId = crypto.randomUUID();
    const { context, page } = await createFreshContext(browser);
    const callbackPromise = createAutoclawTokenMonitor(context);
    account.runtimeSession = {
      context,
      page,
      proxyUrl: currentProxyUrl || browser.__ninerouterProxyUrl || job.proxyUrl || null,
    };

    try {
      this.setAccountStep(account, "preparing_worker", `Worker ${workerId} preparing AutoClaw browser context`);
      await this.persistJobSnapshot(job, { forcePreview: false });

      const automationResult = await this.googleAutomation({
        page,
        email: account.email,
        password: account.password,
        deviceId,
        proxyUrl: currentProxyUrl || browser.__ninerouterProxyUrl || job.proxyUrl || null,
        callbackPromise,
        onStep: (step, message) => {
          this.setAccountStep(account, step, message);
          void this.persistJobSnapshot(job, { forcePreview: false });
        },
      });

      if (automationResult.status === "success") {
        this.setAccountStep(account, "exchanging_tokens", "Saving AutoClaw connection");
        await this.persistJobSnapshot(job, { forcePreview: false });
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
          message: "AutoClaw connection saved successfully",
        });
        account.runtimeSession = null;
        await context.close().catch(() => null);
        await this.persistJobSnapshot(job, { forcePreview: false });
        return "done";
      }

      if (automationResult.status === "needs_manual") {
        account.manualSession = {
          context,
          page,
          opened: false,
          openedAt: null,
          rebind: typeof callbackPromise?.rebind === "function" ? callbackPromise.rebind : null,
        };
        this.setAccountStep(account, "awaiting_manual", "Waiting for manual completion in the browser session");
        this.finalizeAccount(account, "needs_manual", {
          error: automationResult.error,
          step: "awaiting_manual",
          message: automationResult.error,
        });
        await this.persistJobSnapshot(job, { forcePreview: false });
        await this.runManualFollowup(
          job,
          account,
          workerId,
          context,
          callbackPromise,
          deviceId
        );
        return "done";
      }

      if (automationResult.status === "needs_retry") {
        // Sign-in failed (rate limit / IP block). Close context and signal
        // the retry loop in processAccount to re-launch with fresh proxy IP.
        account.runtimeSession = null;
        await context.close().catch(() => null);
        return "needs_retry";
      }

      const terminalStatus = ["failed", "failed_invalid_credentials", "failed_timeout", "failed_restricted", "cancelled"].includes(
        automationResult.status
      )
        ? automationResult.status
        : "failed";
      this.finalizeAccount(account, terminalStatus, {
        error: automationResult.error || "AutoClaw automation failed.",
        step: terminalStatus,
        message: automationResult.error || "AutoClaw automation failed.",
      });
      account.runtimeSession = null;
      await context.close().catch(() => null);
      await this.persistJobSnapshot(job, { forcePreview: false });
      return "done";
    } catch (error) {
      this.finalizeAccount(account, "failed", {
        error: error.message || "Unexpected AutoClaw bulk import failure.",
        step: "failed",
        message: error.message || "Unexpected AutoClaw bulk import failure.",
      });
      account.runtimeSession = null;
      await context.close().catch(() => null);
      await this.persistJobSnapshot(job, { forcePreview: false });
      return "done";
    } finally {
      // Only clear password on final attempt — retry needs it
      if (attempt >= MAX_SIGNIN_RETRY_ATTEMPTS) {
        account.password = undefined;
      }
    }
  }

  async runManualFollowup(job, account, workerId, context, callbackPromise, deviceId) {
    const followupPromise = (async () => {
      const closeManualResources = async () => {
        const ms = account.manualSession;
        const ctx = ms?.context || context;
        const headed = ms?.headedBrowser || null;
        if (ctx) await ctx.close().catch(() => null);
        if (headed) await headed.close().catch(() => null);
      };
      try {
        const callback = await callbackPromise;
        if (job.cancelRequested) {
          this.finalizeAccount(account, "cancelled", {
            error: "Job cancelled",
            step: "cancelled",
            message: "Job cancelled while waiting for manual completion",
          });
          await this.persistJobSnapshot(job, { forcePreview: false });
          return;
        }

        this.setAccountStep(account, "exchanging_tokens", "Saving AutoClaw connection");
        await this.persistJobSnapshot(job, { forcePreview: false });
        writeAutoclawTokenCheckpoint({
          jobId: job.jobId,
          line: account.line,
          email: account.email,
          tokens: {
            accessToken: callback.access_token,
            refreshToken: callback.refresh_token,
            deviceId: callback.device_id,
            userId: callback.user_id,
            userName: callback.user_name,
          },
        });
        const { connection } = await this.socialExchange({
          access_token: callback.access_token,
          refresh_token: callback.refresh_token,
          user_id: callback.user_id,
          user_name: callback.user_name,
          device_id: callback.device_id,
        });
        await assertConnectionPersisted(connection);

        this.finalizeAccount(account, "success", {
          connectionId: connection.id,
          step: "connection_saved",
          message: "AutoClaw connection saved successfully",
        });
        await this.persistJobSnapshot(job, { forcePreview: false });
      } catch (error) {
        if (job.cancelRequested) {
          this.finalizeAccount(account, "cancelled", {
            error: "Job cancelled",
            step: "cancelled",
            message: "Job cancelled while waiting for manual completion",
          });
        } else {
          this.finalizeAccount(account, "failed_exchange", {
            error: error.message || "Manual assist flow failed during token exchange.",
            step: "exchange_failed",
            message: error.message || "Manual assist flow failed during token exchange.",
          });
        }
        await this.persistJobSnapshot(job, { forcePreview: false });
      } finally {
        await closeManualResources();
        account.manualSession = null;
        account.runtimeSession = null;
        job.manualFollowups.delete(followupPromise);
        await this.persistJobSnapshot(job, { forcePreview: false });
      }
    })();

    job.manualFollowups.add(followupPromise);
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
