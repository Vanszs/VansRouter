import { randomUUID } from "crypto";
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "../../dataDir.js";
import { getOptimalWorkerCount, isAutoConcurrencyValue } from "../../systemSpecs.js";
import { KiroService } from "./kiro.js";
import { createKiroCallbackMonitor, runKiroGoogleAutomation } from "./kiroGoogleAutomation.js";

export const KIRO_BULK_IMPORT_DEFAULT_CONCURRENCY = 4;
export const KIRO_BULK_IMPORT_MIN_CONCURRENCY = 1;
export const KIRO_BULK_IMPORT_MAX_CONCURRENCY = 8;

const TERMINAL_ACCOUNT_STATUSES = new Set([
  "success",
  "failed",
  "failed_invalid_credentials",
  "failed_exchange",
  "failed_timeout",
  "cancelled",
]);

const MAX_ACCOUNT_LOG_ENTRIES = 40;
const MAX_JOB_ACTIVITY_ENTRIES = 80;
const PREVIEW_CAPTURE_INTERVAL_MS = 800;
const PREVIEW_CAPTURE_TIMEOUT_MS = 2000;
const RECENT_TERMINAL_JOB_WINDOW_MS = 30 * 60_000;
const KIRO_BULK_IMPORT_DIR = path.join(DATA_DIR, "kiro-bulk-import");
const KIRO_BULK_IMPORT_META_FILE = path.join(KIRO_BULK_IMPORT_DIR, "meta.json");
const ACTIVE_JOB_STATUSES = new Set(["queued", "running", "needs_manual"]);

function nowIso() {
  return new Date().toISOString();
}

function ensurePersistenceDir(dir = KIRO_BULK_IMPORT_DIR) {
  fs.mkdirSync(dir, { recursive: true });
}

function getJobFile(jobId, dir = KIRO_BULK_IMPORT_DIR) {
  ensurePersistenceDir(dir);
  return path.join(dir, `${jobId}.json`);
}

function readJsonFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function writeJsonFile(filePath, payload) {
  ensurePersistenceDir(path.dirname(filePath));
  const tempFile = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tempFile, JSON.stringify(payload, null, 2), "utf8");
  fs.renameSync(tempFile, filePath);
}

function readPersistedLatestJobId(metaFile = KIRO_BULK_IMPORT_META_FILE) {
  return readJsonFile(metaFile)?.latestJobId || null;
}

function writePersistedLatestJobId(jobId, metaFile = KIRO_BULK_IMPORT_META_FILE) {
  writeJsonFile(metaFile, {
    latestJobId: jobId || null,
    updatedAt: nowIso(),
  });
}

function clampConcurrency(value) {
  // "auto" (or boolean true) defers to system spec detection so users on
  // beefier machines automatically get more workers without editing the form.
  if (isAutoConcurrencyValue(value)) {
    const detected = getOptimalWorkerCount();
    const safeDetected = Number.isFinite(detected) ? detected : KIRO_BULK_IMPORT_DEFAULT_CONCURRENCY;
    return Math.min(KIRO_BULK_IMPORT_MAX_CONCURRENCY, Math.max(KIRO_BULK_IMPORT_MIN_CONCURRENCY, safeDetected));
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return KIRO_BULK_IMPORT_DEFAULT_CONCURRENCY;
  return Math.min(KIRO_BULK_IMPORT_MAX_CONCURRENCY, Math.max(KIRO_BULK_IMPORT_MIN_CONCURRENCY, parsed));
}

export function parseKiroBulkAccounts(accounts = []) {
  const lines = Array.isArray(accounts) ? accounts : [];
  const parsed = [];
  const invalidLines = [];

  lines.forEach((line, index) => {
    const raw = String(line || "").trim();
    if (!raw) return;
    // Skip comment lines
    if (raw.startsWith("#")) return;

    let email = "";
    let password = "";

    if (raw.includes("|")) {
      // Pipe separator (original behavior) — password may contain |
      const [emailPart = "", ...passwordParts] = raw.split("|");
      email = emailPart.trim();
      password = passwordParts.join("|").trim();
    } else if (raw.includes("\t")) {
      // Tab separator (spreadsheet paste)
      const tabIdx = raw.indexOf("\t");
      email = raw.substring(0, tabIdx).trim();
      password = raw.substring(tabIdx + 1).trim();
    } else if (raw.includes(":")) {
      // Colon separator — only if part before first : looks like email
      const colonIdx = raw.indexOf(":");
      const beforeColon = raw.substring(0, colonIdx).trim();
      if (beforeColon.includes("@")) {
        email = beforeColon;
        password = raw.substring(colonIdx + 1).trim();
      }
    }

    if (!email || !password) {
      invalidLines.push(index + 1);
      return;
    }

    parsed.push({
      line: index + 1,
      email,
      password,
    });
  });

  return {
    parsed,
    invalidLines,
  };
}

function getFailedCount(accounts) {
  return accounts.filter((account) => (
    account.status === "failed"
    || account.status === "failed_invalid_credentials"
    || account.status === "failed_exchange"
    || account.status === "failed_timeout"
  )).length;
}

function buildSummary(accounts) {
  return {
    total: accounts.length,
    queued: accounts.filter((account) => account.status === "queued").length,
    running: accounts.filter((account) => account.status === "running").length,
    success: accounts.filter((account) => account.status === "success").length,
    failed: getFailedCount(accounts),
    needs_manual: accounts.filter((account) => account.status === "needs_manual").length,
  };
}

function resolveFinishedJobStatus(accounts) {
  const summary = buildSummary(accounts);
  if (summary.needs_manual > 0) return "needs_manual";
  if (summary.success > 0) return "completed";
  if (summary.failed > 0) return "failed";
  return "completed";
}

function createLogEntry(step, message, level = "info") {
  return {
    id: randomUUID(),
    at: nowIso(),
    step,
    message,
    level,
  };
}

function appendAccountLog(account, step, message, level = "info") {
  const entry = createLogEntry(step, message, level);
  account.currentStep = step;
  account.updatedAt = entry.at;
  account.logs = account.logs || [];
  account.logs.push(entry);
  if (account.logs.length > MAX_ACCOUNT_LOG_ENTRIES) {
    account.logs.splice(0, account.logs.length - MAX_ACCOUNT_LOG_ENTRIES);
  }
  return entry;
}

function buildJobActivity(accounts) {
  return accounts
    .flatMap((account) => (account.logs || []).map((entry) => ({
      ...entry,
      email: account.email,
      line: account.line,
      workerId: account.workerId || null,
      status: account.status,
    })))
    .sort((left, right) => String(left.at).localeCompare(String(right.at)))
    .slice(-MAX_JOB_ACTIVITY_ENTRIES);
}

function sanitizeAccount(account) {
  return {
    email: account.email,
    status: account.status,
    error: account.error || null,
    connectionId: account.connectionId || null,
    workerId: account.workerId || null,
    line: account.line,
    currentStep: account.currentStep || null,
    detailedSteps: account.detailedSteps || null,
    updatedAt: account.updatedAt || null,
    logs: (account.logs || []).slice(-8),
    manualSessionAvailable: Boolean(account.manualSession?.page) && account.status === "needs_manual",
    manualSessionOpened: Boolean(account.manualSession?.opened),
  };
}

function sanitizeJob(job, extras = {}) {
  return {
    jobId: job.jobId,
    status: job.status,
    summary: buildSummary(job.accounts),
    concurrency: job.concurrency,
    proxyMode: job.proxyMode || "none",
    proxyPoolId: job.proxyPoolId || null,
    proxySource: job.proxySource || null,
    proxyCount: Array.isArray(job.proxyUrls) ? job.proxyUrls.length : (job.proxyUrl ? 1 : 0),
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    accounts: job.accounts.map(sanitizeAccount),
    activity: buildJobActivity(job.accounts),
    error: job.error || null,
    preview: extras.preview || null,
  };
}

function buildPersistedSnapshot(job) {
  return sanitizeJob(job, {
    preview: job.lastPreview || null,
  });
}

function isRecentTerminalJob(job) {
  if (!job || ACTIVE_JOB_STATUSES.has(job.status)) return false;
  const finishedAtMs = job.finishedAt ? Date.parse(job.finishedAt) : NaN;
  if (!Number.isFinite(finishedAtMs)) return false;
  return (Date.now() - finishedAtMs) <= RECENT_TERMINAL_JOB_WINDOW_MS;
}

export function buildLookupResponse(job, extras = {}) {
  if (!job) {
    return {
      found: false,
      stale: Boolean(extras.stale),
      recoverable: false,
      job: null,
    };
  }

  return {
    found: true,
    stale: false,
    recoverable: ACTIVE_JOB_STATUSES.has(job.status),
    job,
  };
}

async function defaultBrowserLauncher(job) {
  const { launchBulkImportBrowser } = await import("./bulkImportBrowserEngine.js");
  return launchBulkImportBrowser({
    engine: job?.engine || "chromium",
    proxyUrl: job?.proxyUrl || undefined,
    headless: job?.headless ?? false,
    args: ["--disable-blink-features=AutomationControlled"],
  });
}

function normalizeProxyUrls(proxyUrl, proxyUrls) {
  const values = Array.isArray(proxyUrls) ? proxyUrls : (proxyUrl ? [proxyUrl] : []);
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
}

export function randomizeProxySessionId(proxyUrl) {
  if (!proxyUrl) return proxyUrl;
  try {
    const parsed = new URL(proxyUrl);
    if (!parsed.username || !/sid-[a-zA-Z0-9_]+/i.test(parsed.username)) return proxyUrl;
    parsed.username = parsed.username.replace(/sid-[a-zA-Z0-9_]+/i, `sid-${randomUUID().replaceAll("-", "").slice(0, 10)}`);
    return parsed.toString();
  } catch {
    return proxyUrl;
  }
}

function resolveWorkerProxyUrl(job, workerId) {
  const proxyUrls = Array.isArray(job.proxyUrls) ? job.proxyUrls : [];
  const proxyUrl = proxyUrls.length > 1
    ? proxyUrls[(Math.max(1, workerId) - 1) % proxyUrls.length]
    : (job.proxyUrl || proxyUrls[0] || null);
  return job.randomizeProxySession ? randomizeProxySessionId(proxyUrl) : proxyUrl;
}

async function defaultSocialExchange(args) {
  const { exchangeAndSaveKiroSocialConnection } = await import("./kiroConnections.js");
  return exchangeAndSaveKiroSocialConnection(args);
}

// Proxy-friendly default timeouts. Playwright defaults are 30s for both, which
// is too short when routing through SOCKS5/HTTP proxies (residential rotating
// proxies can take 5-10s per new connection just for the handshake). These
// apply to EVERY page created from this context, so all bulk automation
// providers (Kiro, CodeBuddy, AutoClaw, Qoder, Cloudflare) inherit them.
//
// - navigationTimeout: page.goto(), page.goBack(), page.goForward(),
//   page.reload(), page.waitForURL(), page.waitForLoadState()
// - defaultTimeout: page.waitForSelector(), page.click(), page.fill(),
//   locator.isVisible(), etc. (any auto-waiting assertion)
//
// Individual call sites can still pass a shorter `timeout` option to override
// these for fast-fail cases (e.g. "wrong password" detection).
const BULK_IMPORT_DEFAULT_NAVIGATION_TIMEOUT_MS = 120_000; // 2 minutes
const BULK_IMPORT_DEFAULT_TIMEOUT_MS = 60_000; // 1 minute

export async function createFreshContext(browser, { locale = "en-US" } = {}) {
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    viewport: { width: 1280, height: 800 },
    locale,
    // Context-level defaults — inherited by every page created from this context.
    // Playwright supports these in BrowserContextOptions since v1.x.
    defaultNavigationTimeout: BULK_IMPORT_DEFAULT_NAVIGATION_TIMEOUT_MS,
    defaultTimeout: BULK_IMPORT_DEFAULT_TIMEOUT_MS,
  });
  const page = await context.newPage();
  // Belt-and-suspenders: also set on the page directly so any code that creates
  // additional pages from the same context via context.newPage() still benefits
  // if the context-level defaults were stripped by a Playwright version quirk.
  page.setDefaultNavigationTimeout(BULK_IMPORT_DEFAULT_NAVIGATION_TIMEOUT_MS);
  page.setDefaultTimeout(BULK_IMPORT_DEFAULT_TIMEOUT_MS);
  return { context, page };
}

function isHeadlessBrowser(browser) {
  if (!browser) return true;
  const opts = browser._options || browser._initializer || {};
  if (typeof opts.headless === "boolean") return opts.headless;
  return true;
}

async function relaunchAsHeaded(account) {
  if (!account?.manualSession?.context) return false;
  const oldContext = account.manualSession.context;
  const oldPage = account.manualSession.page;
  const oldBrowser = oldContext.browser?.();

  let storageState = null;
  let lastUrl = "";
  try {
    storageState = await oldContext.storageState();
  } catch {
    storageState = null;
  }
  try {
    lastUrl = oldPage?.url?.() || "";
  } catch {
    lastUrl = "";
  }

  let newBrowser;
  try {
    const { launchBulkImportBrowser } = await import("./bulkImportBrowserEngine.js");
    newBrowser = await launchBulkImportBrowser({
      engine: "chromium",
      headless: false,
      args: ["--start-maximized"],
      proxyUrl: account?.manualSession?.proxyUrl || account?.runtimeSession?.proxyUrl || null,
    });
  } catch {
    return false;
  }

  let newContext;
  try {
    newContext = await newBrowser.newContext({
      viewport: null,
      ...(storageState ? { storageState } : {}),
      // Match the proxy-friendly defaults from createFreshContext so manual
      // assist sessions (CAPTCHA, 2FA) don't time out on slow proxies either.
      defaultNavigationTimeout: BULK_IMPORT_DEFAULT_NAVIGATION_TIMEOUT_MS,
      defaultTimeout: BULK_IMPORT_DEFAULT_TIMEOUT_MS,
    });
  } catch {
    await newBrowser.close().catch(() => null);
    return false;
  }

  const newPage = await newContext.newPage();
  newPage.setDefaultNavigationTimeout(BULK_IMPORT_DEFAULT_NAVIGATION_TIMEOUT_MS);
  newPage.setDefaultTimeout(BULK_IMPORT_DEFAULT_TIMEOUT_MS);
  if (lastUrl) {
    try {
      await newPage.goto(lastUrl, { waitUntil: "domcontentloaded", timeout: 20_000 });
    } catch {}
  }

  const rebind = account.manualSession.rebind;
  account.manualSession.context = newContext;
  account.manualSession.page = newPage;
  account.manualSession.headedBrowser = newBrowser;

  if (typeof rebind === "function") {
    try {
      await rebind({ context: newContext, page: newPage });
    } catch {}
  }

  void oldContext.close().catch(() => null);
  if (oldBrowser && oldBrowser !== newBrowser) {
    void oldBrowser.close().catch(() => null);
  }

  return true;
}

async function revealBrowserWindow(page, { account } = {}) {
  if (!page) return false;

  try {
    const context = page.context?.();
    const browser = context?.browser?.();

    if (account && isHeadlessBrowser(browser)) {
      const relaunched = await relaunchAsHeaded(account);
      if (relaunched) {
        await account.manualSession.page.bringToFront?.().catch(() => null);
        return true;
      }
    }

    if (!context?.newCDPSession) {
      await page.bringToFront?.().catch(() => null);
      return true;
    }

    const session = await context.newCDPSession(page);
    let windowId = null;

    try {
      const targetInfo = await session.send("Target.getTargetInfo");
      const targetId = targetInfo?.targetInfo?.targetId;
      const windowInfo = await session.send("Browser.getWindowForTarget", targetId ? { targetId } : {});
      windowId = windowInfo?.windowId ?? null;
    } catch {
      windowId = null;
    }

    if (windowId != null) {
      await session.send("Browser.setWindowBounds", {
        windowId,
        bounds: {
          windowState: "normal",
          left: 80,
          top: 80,
          width: 1280,
          height: 960,
        },
      }).catch(() => null);
    }

    await page.bringToFront?.().catch(() => null);
    await session.detach?.().catch(() => null);
    return true;
  } catch {
    await page.bringToFront?.().catch(() => null);
    return true;
  }
}

const cdpSessions = new WeakMap();
const cdpFrames = new WeakMap();

async function ensureCdpScreencast(page) {
  if (!page || typeof page.context !== "function") return null;
  if (cdpFrames.has(page)) return cdpFrames.get(page);

  try {
    const context = page.context();
    if (typeof context.newCDPSession !== "function") return null;
    const session = await context.newCDPSession(page);
    const state = { frames: [], active: true, session };
    cdpSessions.set(page, session);
    cdpFrames.set(page, state);

    session.on("Page.screencastFrame", (event) => {
      if (event?.data) {
        state.frames.push(event.data);
        if (state.frames.length > 2) state.frames.shift();
      }
      if (event?.sessionId) {
        session.send("Page.screencastFrameAck", { sessionId: event.sessionId }).catch(() => {});
      }
    });

    await session.send("Page.startScreencast", {
      format: "jpeg",
      quality: 50,
      maxWidth: 1280,
      maxHeight: 720,
      everyNthFrame: 2,
    }).catch(() => null);

    return state;
  } catch {
    return null;
  }
}

async function captureCdpFrame(page) {
  const state = await ensureCdpScreencast(page);
  if (!state || !state.frames.length) return null;
  const frame = state.frames[state.frames.length - 1];
  return `data:image/jpeg;base64,${frame}`;
}

async function stopCdpScreencast(page) {
  const state = cdpFrames.get(page);
  const session = cdpSessions.get(page);
  if (state) state.active = false;
  try {
    if (session) await session.send("Page.stopScreencast").catch(() => null);
  } catch {}
  cdpFrames.delete(page);
  cdpSessions.delete(page);
}

export { stopCdpScreencast };

export class KiroBulkImportManager {
  constructor({
    browserLauncher = defaultBrowserLauncher,
    googleAutomation = runKiroGoogleAutomation,
    socialExchange = defaultSocialExchange,
    kiroServiceFactory = () => new KiroService(),
    storageName = "kiro-bulk-import",
  } = {}) {
    this.browserLauncher = browserLauncher;
    this.googleAutomation = googleAutomation;
    this.socialExchange = socialExchange;
    this.kiroServiceFactory = kiroServiceFactory;
    this.storageDir = path.join(DATA_DIR, storageName);
    this.metaFile = path.join(this.storageDir, "meta.json");
    this.jobs = new Map();
    this.latestJobId = readPersistedLatestJobId(this.metaFile);
  }

  async startJob({ accounts, concurrency, engine, proxyUrl, proxyUrls, proxyMode, proxyPoolId, proxySource, randomizeProxySession, headless, jobFields }) {
    const { parsed, invalidLines } = parseKiroBulkAccounts(accounts);
    if (!parsed.length) {
      const error = invalidLines.length > 0
        ? "Invalid account format. Use one account per line: gmail@example.com|password"
        : "At least one account entry is required";
      const response = { error };
      if (invalidLines.length > 0) response.invalidLines = invalidLines;
      throw Object.assign(new Error(error), response);
    }

    if (invalidLines.length > 0) {
      const error = "Invalid account format. Use one account per line: gmail@example.com|password";
      throw Object.assign(new Error(error), { error, invalidLines });
    }

    const jobId = randomUUID();
    const createdAt = nowIso();
    const { normalizeBulkImportEngine, DEFAULT_BULK_IMPORT_ENGINE } = await import("./bulkImportBrowserEngine.js");
    const resolvedEngine = engine ? normalizeBulkImportEngine(engine) : DEFAULT_BULK_IMPORT_ENGINE;
    const resolvedProxyUrls = normalizeProxyUrls(proxyUrl, proxyUrls);
    const job = {
      jobId,
      status: "running",
      concurrency: clampConcurrency(concurrency),
      engine: resolvedEngine,
      headless: headless ?? false,
      proxyUrl: resolvedProxyUrls[0] || null,
      proxyUrls: resolvedProxyUrls,
      proxyMode: proxyMode || (resolvedProxyUrls.length > 1 ? "round-robin" : (resolvedProxyUrls.length === 1 ? "single" : "none")),
      proxyPoolId: proxyPoolId || null,
      proxySource: proxySource || null,
      randomizeProxySession: Boolean(randomizeProxySession),
      createdAt,
      startedAt: createdAt,
      finishedAt: null,
      error: null,
      cancelRequested: false,
      browser: null,
      workerBrowsers: new Set(),
      nextIndex: 0,
      manualFollowups: new Set(),
      persistPromise: Promise.resolve(),
      lastPreview: null,
      lastPreviewCapturedAt: 0,
      accounts: parsed.map((account) => ({
        line: account.line,
        email: account.email,
        password: account.password,
        status: "queued",
        error: null,
        connectionId: null,
        workerId: null,
        manualSession: null,
        runtimeSession: null,
        currentStep: "queued",
        updatedAt: createdAt,
        logs: [createLogEntry("queued", "Queued and waiting for an available worker")],
      })),
      ...(jobFields || {}),
    };

    this.jobs.set(jobId, job);
    this.latestJobId = jobId;
    writePersistedLatestJobId(jobId, this.metaFile);
    await this.persistJobSnapshot(job, { forcePreview: false });
    void this.runJob(jobId);
    return sanitizeJob(job);
  }

  getJob(jobId) {
    const job = this.jobs.get(jobId);
    if (job) return sanitizeJob(job, { preview: job.lastPreview || null });
    return readJsonFile(getJobFile(jobId, this.storageDir));
  }

  async getJobWithPreview(jobId) {
    const job = this.jobs.get(jobId);
    if (!job) return readJsonFile(getJobFile(jobId, this.storageDir));
    const preview = await this.capturePreviewWithTimeout(job);
    if (preview) job.lastPreview = preview;
    job.lastPreviewCapturedAt = Date.now();
    await this.persistJobSnapshot(job, { forcePreview: false });
    return sanitizeJob(job, { preview: job.lastPreview || null });
  }

  async getLatestJobWithPreview({ includeRecentTerminal = false } = {}) {
    const latestJobId = this.latestJobId || readPersistedLatestJobId(this.metaFile);
    if (!latestJobId) return null;
    const job = await this.getJobWithPreview(latestJobId);
    if (!job) return null;
    if (ACTIVE_JOB_STATUSES.has(job.status)) {
      return job;
    }
    if (includeRecentTerminal && isRecentTerminalJob(job)) {
      return job;
    }
    return null;
  }

  async cancelJob(jobId) {
    const job = this.jobs.get(jobId);
    if (!job) {
      const snapshot = readJsonFile(getJobFile(jobId, this.storageDir));
      if (!snapshot || !ACTIVE_JOB_STATUSES.has(snapshot.status)) return snapshot;

      const cancelledAt = nowIso();
      snapshot.status = "cancelled";
      snapshot.finishedAt = snapshot.finishedAt || cancelledAt;
      snapshot.error = "Job cancelled";
      snapshot.accounts = (snapshot.accounts || []).map((account) => (
        ACTIVE_JOB_STATUSES.has(account.status)
          ? { ...account, status: "cancelled", error: "Job cancelled", updatedAt: cancelledAt }
          : account
      ));
      writeJsonFile(getJobFile(jobId, this.storageDir), snapshot);
      return snapshot;
    }

    job.cancelRequested = true;
    if (job.status === "queued") {
      job.status = "cancelled";
      job.finishedAt = nowIso();
      job.accounts.forEach((account) => {
        if (account.status === "queued") account.status = "cancelled";
      });
    }

    if (job.browser) {
      void job.browser.close().catch(() => null);
      job.browser = null;
    }
    if (job.workerBrowsers) {
      for (const browser of job.workerBrowsers) {
        void browser.close().catch(() => null);
      }
      job.workerBrowsers.clear();
    }

    await this.persistJobSnapshot(job, { forcePreview: true });

    return sanitizeJob(job);
  }

  async openManualSession(jobId, workerId) {
    const job = this.jobs.get(jobId);
    if (!job) return null;

    const numericWorkerId = Number.parseInt(workerId, 10);
    const account = job.accounts.find((entry) => (
      entry.workerId === numericWorkerId
      && entry.status === "needs_manual"
      && entry.manualSession?.page
    ));

    if (!account) {
      return {
        ok: false,
        error: "Manual session not found for this worker",
        job: sanitizeJob(job),
      };
    }

    const opened = await revealBrowserWindow(account.manualSession.page, { account });
    account.manualSession.opened = opened;
    account.manualSession.openedAt = opened
      ? (account.manualSession.openedAt || nowIso())
      : account.manualSession.openedAt || null;
    await this.persistJobSnapshot(job, { forcePreview: true });

    return {
      ok: true,
      job: sanitizeJob(job),
      account: sanitizeAccount(account),
    };
  }

  dequeueAccount(job, workerId) {
    while (job.nextIndex < job.accounts.length) {
      const account = job.accounts[job.nextIndex];
      job.nextIndex += 1;
      if (account.status !== "queued") continue;
      account.status = "running";
      account.workerId = workerId;
      account.error = null;
      appendAccountLog(account, "worker_assigned", `Worker ${workerId} picked up this account`);
      void this.persistJobSnapshot(job, { forcePreview: false });
      return account;
    }
    return null;
  }

  finalizeAccount(account, status, extras = {}) {
    account.status = status;
    account.error = extras.error || null;
    account.connectionId = extras.connectionId || null;
    if (extras.step || extras.message) {
      appendAccountLog(
        account,
        extras.step || status,
        extras.message || extras.error || status.replaceAll("_", " ")
      );
    }
    return account;
  }

  setAccountStep(account, step, message, level = "info") {
    appendAccountLog(account, step, message, level);
  }

  async capturePreviewWithTimeout(job) {
    // Defence in depth. capturePreview already hard-caps page.screenshot, but
    // any caller (including subclasses or future overrides) must never be able
    // to freeze the worker or the frontend polling request. Two failure modes
    // are bug-equivalent: a hung page.screenshot, and a hung capturePreview
    // that someone monkey-patched. Both are bounded here.
    let preview = null;
    try {
      preview = await Promise.race([
        this.capturePreview(job),
        new Promise((resolve) => setTimeout(() => resolve(null), PREVIEW_CAPTURE_TIMEOUT_MS)),
      ]);
    } catch {
      preview = null;
    }
    return preview;
  }

  async persistJobSnapshot(job, { forcePreview = false } = {}) {
    if (!job) return;

    const runPersist = async () => {
      const shouldCapturePreview = forcePreview || (Date.now() - (job.lastPreviewCapturedAt || 0) >= PREVIEW_CAPTURE_INTERVAL_MS);
      if (shouldCapturePreview) {
        const preview = await this.capturePreviewWithTimeout(job);
        if (preview) {
          job.lastPreview = preview;
        }
        job.lastPreviewCapturedAt = Date.now();
      }

      try {
        writeJsonFile(getJobFile(job.jobId, this.storageDir), buildPersistedSnapshot(job));
      } catch {
        // Best-effort persistence; never break the worker over a write failure.
      }
    };

    job.persistPromise = Promise.resolve(job.persistPromise).catch(() => null).then(runPersist);
    await job.persistPromise;
  }

  capturePreviewAccount(job) {
    return job.accounts.find((account) => account.status === "running" && account.runtimeSession?.page)
      || job.accounts.find((account) => account.status === "needs_manual" && account.manualSession?.page)
      || job.accounts.find((account) => account.runtimeSession?.page)
      || job.accounts.find((account) => account.manualSession?.page)
      || null;
  }

  async capturePreview(job) {
    const previewAccount = this.capturePreviewAccount(job);
    if (!previewAccount) return null;

    const session = previewAccount.runtimeSession || previewAccount.manualSession;
    const fallbackPage = session?.page;
    const context = session?.context;
    let page = fallbackPage;

    if (context && typeof context.pages === "function") {
      const pages = context.pages();
      if (pages.length > 1) {
        for (let i = pages.length - 1; i >= 0; i--) {
          try {
            const url = pages[i].url();
            if (url && url !== "about:blank") {
              page = pages[i];
              break;
            }
          } catch {}
        }
      }
    }

    if (!page) return null;

    const meta = {
      email: previewAccount.email,
      workerId: previewAccount.workerId || null,
      status: previewAccount.status,
      step: previewAccount.currentStep || null,
      updatedAt: previewAccount.updatedAt || nowIso(),
    };

    // Try CDP screencast first (smooth ~30fps), fallback to screenshot
    const cdpFrame = await captureCdpFrame(page);
    if (cdpFrame) {
      return { ...meta, imageData: cdpFrame };
    }

    // Fallback: screenshot
    const previousImage = job.lastPreview?.imageData || null;
    let screenshot;
    try {
      screenshot = await Promise.race([
        page.screenshot({
          type: "jpeg",
          quality: 50,
          fullPage: false,
          animations: "disabled",
          caret: "hide",
          timeout: PREVIEW_CAPTURE_TIMEOUT_MS,
        }),
        new Promise((resolve) => setTimeout(() => resolve(null), PREVIEW_CAPTURE_TIMEOUT_MS)),
      ]);
    } catch {
      return { ...meta, imageData: previousImage };
    }

    if (!screenshot) {
      return { ...meta, imageData: previousImage };
    }

    return {
      ...meta,
      imageData: `data:image/jpeg;base64,${screenshot.toString("base64")}`,
    };
  }

  async runManualFollowup(job, account, workerId, context, callbackPromise, codeVerifier) {
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
          await this.persistJobSnapshot(job, { forcePreview: true });
          return;
        }

        this.setAccountStep(account, "exchanging_tokens", "Exchanging Kiro callback for OAuth tokens");
        await this.persistJobSnapshot(job, { forcePreview: true });
        const { connection } = await this.socialExchange({
          code: callback.code,
          codeVerifier,
          provider: "google",
        });

        this.finalizeAccount(account, "success", {
          connectionId: connection.id,
          step: "connection_saved",
          message: "Kiro connection saved successfully",
        });
        await this.persistJobSnapshot(job, { forcePreview: true });
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
        await this.persistJobSnapshot(job, { forcePreview: true });
      } finally {
        await closeManualResources();
        account.manualSession = null;
        account.runtimeSession = null;
        job.manualFollowups.delete(followupPromise);
        await this.persistJobSnapshot(job, { forcePreview: true });
      }
    })();

    job.manualFollowups.add(followupPromise);
  }

  async processAccount(job, account, workerId, browser = job.browser) {
    if (job.cancelRequested || !browser) {
      this.finalizeAccount(account, "cancelled", { error: "Job cancelled" });
      return;
    }

    const kiroService = this.kiroServiceFactory();
    const socialAuth = kiroService.createSocialAuthorization("google");
    const { context, page } = await createFreshContext(browser);
    const callbackPromise = createKiroCallbackMonitor(context, page);
    account.runtimeSession = { context, page, proxyUrl: browser.__ninerouterProxyUrl || job.proxyUrl || null };

    try {
      this.setAccountStep(account, "preparing_worker", `Worker ${workerId} is preparing a browser context`);
      await this.persistJobSnapshot(job, { forcePreview: true });
      const automationResult = await this.googleAutomation({
        page,
        authUrl: socialAuth.authUrl,
        email: account.email,
        password: account.password,
        callbackPromise,
        onStep: (step, message) => {
          this.setAccountStep(account, step, message);
          void this.persistJobSnapshot(job, { forcePreview: false });
        },
      });

      if (automationResult.status === "success") {
        this.setAccountStep(account, "exchanging_tokens", "Exchanging Kiro callback for OAuth tokens");
        await this.persistJobSnapshot(job, { forcePreview: true });
        const { connection } = await this.socialExchange({
          code: automationResult.code,
          codeVerifier: socialAuth.codeVerifier,
          provider: "google",
        });
        this.finalizeAccount(account, "success", {
          connectionId: connection.id,
          step: "connection_saved",
          message: "Kiro connection saved successfully",
        });
        account.runtimeSession = null;
        await context.close().catch(() => null);
        await this.persistJobSnapshot(job, { forcePreview: true });
        return;
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
        await this.persistJobSnapshot(job, { forcePreview: true });
        await this.runManualFollowup(
          job,
          account,
          workerId,
          context,
          callbackPromise,
          socialAuth.codeVerifier
        );
        return;
      }

      const terminalStatus = TERMINAL_ACCOUNT_STATUSES.has(automationResult.status)
        ? automationResult.status
        : "failed";
      this.finalizeAccount(account, terminalStatus, {
        error: automationResult.error || "Kiro Google automation failed.",
        step: terminalStatus,
        message: automationResult.error || "Kiro Google automation failed.",
      });
      account.runtimeSession = null;
      await context.close().catch(() => null);
      await this.persistJobSnapshot(job, { forcePreview: true });
    } catch (error) {
      this.finalizeAccount(account, "failed", {
        error: error.message || "Unexpected Kiro bulk import failure.",
        step: "failed",
        message: error.message || "Unexpected Kiro bulk import failure.",
      });
      account.runtimeSession = null;
      await context.close().catch(() => null);
      await this.persistJobSnapshot(job, { forcePreview: true });
    } finally {
      account.password = undefined;
    }
  }

  async runWorker(job, workerId, browser = job.browser) {
    let workerBrowser = browser;
    const ownsBrowser = !workerBrowser;
    try {
      if (!workerBrowser) {
        const proxyUrl = resolveWorkerProxyUrl(job, workerId);
        workerBrowser = await this.browserLauncher({ ...job, proxyUrl });
        workerBrowser.__ninerouterProxyUrl = proxyUrl || null;
        job.workerBrowsers.add(workerBrowser);
      }

      while (!job.cancelRequested) {
        const account = this.dequeueAccount(job, workerId);
        if (!account) return;
        await this.processAccount(job, account, workerId, workerBrowser);
      }
    } finally {
      if (ownsBrowser && workerBrowser && job.cancelRequested) {
        job.workerBrowsers.delete(workerBrowser);
        await workerBrowser.close().catch(() => null);
      }
    }
  }

  async runJob(jobId) {
    const job = this.jobs.get(jobId);
    if (!job) return;

    try {
      const useWorkerBrowsers = Array.isArray(job.proxyUrls) && job.proxyUrls.length > 1;
      if (!useWorkerBrowsers) {
        const proxyUrl = resolveWorkerProxyUrl(job, 1);
        job.browser = await this.browserLauncher({ ...job, proxyUrl });
        job.browser.__ninerouterProxyUrl = proxyUrl || null;
      }
      job.accounts.forEach((account) => {
        if (account.status === "queued" && (account.logs || []).length === 1) {
          this.setAccountStep(account, "waiting_for_worker", "Waiting for a free worker");
        }
      });
      await this.persistJobSnapshot(job, { forcePreview: false });
      const workerCount = Math.min(job.concurrency, Math.max(job.accounts.length, 1));
      const workers = Array.from({ length: workerCount }, (_, index) => this.runWorker(
        job,
        index + 1,
        useWorkerBrowsers ? null : job.browser
      ));

      await Promise.allSettled(workers);

      if (job.manualFollowups.size > 0) {
        await Promise.allSettled([...job.manualFollowups]);
      }

      if (job.cancelRequested) {
        job.status = "cancelled";
        job.accounts.forEach((account) => {
          if (account.status === "queued" || account.status === "running") {
            this.finalizeAccount(account, "cancelled", {
              error: "Job cancelled",
              step: "cancelled",
              message: "Job cancelled before completion",
            });
          }
        });
      } else {
        job.status = resolveFinishedJobStatus(job.accounts);
        if (job.status === "failed") {
          job.error = "All accounts failed.";
        }
      }
      await this.persistJobSnapshot(job, { forcePreview: true });
    } catch (error) {
      job.status = "failed";
      job.error = error.message || "Failed to start Kiro bulk import job.";
      job.accounts.forEach((account) => {
        if (account.status === "queued" || account.status === "running") {
          this.finalizeAccount(account, "failed", {
            error: job.error,
            step: "failed",
            message: job.error,
          });
          account.password = undefined;
        }
      });
      await this.persistJobSnapshot(job, { forcePreview: true });
    } finally {
      if (job.browser) {
        await job.browser.close().catch(() => null);
        job.browser = null;
      }
      if (job.workerBrowsers) {
        await Promise.allSettled([...job.workerBrowsers].map((browser) => browser.close().catch(() => null)));
        job.workerBrowsers.clear();
      }
      job.finishedAt = job.status === "needs_manual" ? null : nowIso();
      await this.persistJobSnapshot(job, { forcePreview: true });
    }
  }
}

function getSingletonStore() {
  if (!globalThis.__kiroBulkImportSingleton) {
    globalThis.__kiroBulkImportSingleton = {
      manager: new KiroBulkImportManager(),
    };
  }
  return globalThis.__kiroBulkImportSingleton;
}

export function getKiroBulkImportManager() {
  return getSingletonStore().manager;
}

export const __test__ = {
  clampConcurrency,
  parseKiroBulkAccounts,
  sanitizeJob,
  buildSummary,
  resolveFinishedJobStatus,
  isRecentTerminalJob,
  buildLookupResponse,
};
