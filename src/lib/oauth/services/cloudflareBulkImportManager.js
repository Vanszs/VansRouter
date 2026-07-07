import {
  KIRO_BULK_IMPORT_DEFAULT_CONCURRENCY,
  KiroBulkImportManager,
  createFreshContext,
  buildLookupResponse,
  parseKiroBulkAccounts,
  randomizeProxySessionId,
  stopCdpScreencast,
} from "./kiroBulkImportManager.js";
import { runGoogleAccountAutomation } from "./googleAutomation.js";

const PROVIDER_ID = "cloudflare-ai";

function parseCloudflareLine(raw, index) {
  const line = String(raw || "").trim();
  if (!line || line.startsWith("#")) return null;
  let token = "";
  let accountId = "";
  let name = "";
  let email = "";
  let password = "";
  let mode = "token";
  if (line.startsWith("{")) {
    const parsed = JSON.parse(line);
    token = parsed.apiToken || parsed.apiKey || parsed.token || "";
    accountId = parsed.accountId || parsed.account_id || "";
    email = parsed.email || "";
    password = parsed.password || "";
    name = parsed.name || "";
    mode = token ? "token" : (parsed.mode === "google" || parsed.google ? "google" : "browser");
  } else {
    const colonIndex = line.indexOf(":");
    const parts = line.includes("|")
      ? line.split("|")
      : (line.includes(",") ? line.split(",") : (colonIndex > 0 ? [line.slice(0, colonIndex), line.slice(colonIndex + 1)] : [line]));
    const first = (parts[0] || "").trim();
    const second = (parts[1] || "").trim();
    const third = (parts[2] || "").trim();
    if (["google", "register-google", "signup-google"].includes(first.toLowerCase())) {
      email = second;
      password = third;
      accountId = (parts[3] || "").trim();
      mode = "google";
    } else if (first.includes("@")) {
      email = first;
      password = second;
      accountId = third;
      mode = "google";
    } else {
      token = first;
      accountId = second;
      name = third;
    }
  }
  if (mode === "token" && (!token || !accountId)) return { invalid: true, line: index + 1 };
  if ((mode === "browser" || mode === "google") && (!email || !password)) return { invalid: true, line: index + 1 };
  return { line: index + 1, email: mode === "token" ? (name || accountId) : email, password: mode === "token" ? token : password, apiToken: token, accountId, name, mode };
}

export function parseCloudflareBulkAccounts(accounts = []) {
  const parsed = [];
  const invalidLines = [];
  (Array.isArray(accounts) ? accounts : []).forEach((raw, index) => {
    try {
      const item = parseCloudflareLine(raw, index);
      if (!item) return;
      if (item.invalid) invalidLines.push(item.line);
      else parsed.push(item);
    } catch {
      invalidLines.push(index + 1);
    }
  });
  return { parsed, invalidLines };
}

async function cloudflareFetch(path, token, init = {}) {
  const res = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  let payload = null;
  try { payload = await res.json(); } catch {}
  return { res, payload };
}

async function verifyCloudflareToken(token) {
  const { res, payload } = await cloudflareFetch("/user/tokens/verify", token, { method: "GET" });
  if (!res.ok) {
    console.log(`[cloudflare] token verify failed: status=${res.status} tokenPrefix=${String(token).slice(0, 12)}... tokenLen=${String(token).length} errors=${JSON.stringify(payload?.errors || payload)}`);
  }
  return { ok: res.ok && payload?.success !== false, status: res.status, payload };
}

async function testWorkersAi(token, accountId) {
  const url = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/ai/run/@cf/meta/llama-3.1-8b-instruct`;
  const { res, payload } = await cloudflareFetch(
    `/accounts/${encodeURIComponent(accountId)}/ai/run/@cf/meta/llama-3.1-8b-instruct`,
    token,
    {
      method: "POST",
      body: JSON.stringify({ messages: [{ role: "user", content: "test" }], max_tokens: 1 }),
    }
  );
  const ok = res.status !== 401 && res.status !== 403 && res.status !== 404;
  if (!ok) {
    console.log(`[cloudflare] Workers AI test failed: status=${res.status} errors=${JSON.stringify(payload?.errors || payload)}`);
  }
  return { ok, status: res.status, payload };
}

async function saveCloudflareConnection({ token, accountId, name, workerAi }) {
  const { createProviderConnection } = await import("../../../models/index.js");
  const connection = await createProviderConnection({
    provider: PROVIDER_ID,
    authType: "apikey",
    name: name || `Cloudflare ${accountId}`,
    apiKey: token,
    testStatus: workerAi.ok ? "active" : "unknown",
    providerSpecificData: {
      accountId,
      automation: "bulk-token-import",
      tokenVerifiedAt: new Date().toISOString(),
      workerAiStatus: workerAi.status,
    },
  });
  return { connection };
}

async function defaultBrowserLauncher(job) {
  const { launchBulkImportBrowser } = await import("./bulkImportBrowserEngine.js");
  const proxyUrl = job?.randomizeProxySession ? randomizeProxySessionId(job?.proxyUrl) : job?.proxyUrl;
  const browser = await launchBulkImportBrowser({ engine: job?.engine || "cloakbrowser", proxyUrl: proxyUrl || undefined, headless: job?.headless ?? false });
  browser.__ninerouterProxyUrl = proxyUrl || null;
  return browser;
}

async function fillFirst(page, selectors, value) {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    try {
      if (await locator.count()) {
        await locator.fill(value, { timeout: 3_000 });
        return true;
      }
    } catch {}
  }
  return false;
}

async function clickFirst(page, selectors) {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    try {
      if (await locator.count()) {
        await locator.click({ timeout: 3_000 });
        return true;
      }
    } catch {}
  }
  return false;
}

async function waitForDashboardSession(page, timeoutMs = 5 * 60_000) {
  const start = Date.now();
  let lastStatus = 0;
  while (Date.now() - start < timeoutMs) {
    try {
      const result = await page.evaluate(async () => {
        try {
          const res = await fetch("https://dash.cloudflare.com/api/v4/accounts", {
            credentials: "include",
            headers: {
              "Content-Type": "application/json",
              "X-Requested-With": "XMLHttpRequest",
            },
          });
          let payload = null;
          try { payload = await res.json(); } catch {}
          return { ok: res.ok && payload?.success !== false, status: res.status, success: payload?.success };
        } catch (err) {
          return { ok: false, status: 0, error: err.message };
        }
      });
      lastStatus = result.status || 0;
      if (result.ok) return true;
    } catch {}
    await page.waitForTimeout(2_000);
  }
  console.log(`[cloudflare] waitForDashboardSession timed out (lastStatus=${lastStatus})`);
  return false;
}

async function detectLoginError(page) {
  try {
    const errorTexts = [
      "There was a problem with verification",
      "Please reload and try again",
      "Something went wrong",
      "An error occurred",
      "Try again later",
    ];
    const bodyText = await page.evaluate(() => document.body?.innerText || "");
    return errorTexts.some((text) => bodyText.includes(text));
  } catch {
    return false;
  }
}

async function loginCloudflare(page, email, password, onStep) {
  onStep?.("opening_cloudflare_login", "Opening Cloudflare login");
  await page.goto("https://dash.cloudflare.com/login", { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForTimeout(2_000);

  let loginReady = false;

  for (let reloadAttempt = 0; reloadAttempt < 3; reloadAttempt += 1) {
    if (reloadAttempt > 0) {
      onStep?.("reloading_login_page", `Reloading Cloudflare login page (attempt ${reloadAttempt + 1})`);
      await page.reload({ waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => {});
      await page.waitForTimeout(2_000);
    }

    if (await detectLoginError(page)) {
      onStep?.("login_error_detected", `Login error detected on page (attempt ${reloadAttempt + 1}/3)`);
      if (reloadAttempt < 2) continue;
      onStep?.("login_error_manual", "Login still erroring after 3 reloads, switching to manual mode");
      return false;
    }

    const googleSelectors = [
      'button:has-text("Continue with Google")',
      'a:has-text("Continue with Google")',
      'button:has-text("Sign in with Google")',
      'a:has-text("Sign in with Google")',
      '#social-google',
      'a#social-google',
      'button[class*="Google"]',
      'a[class*="Google"]',
      '[data-provider*="google" i]',
      'button:has-text("Google")',
      'a:has-text("Google")',
    ];

    let clickedGoogle = false;
    for (let attempt = 0; attempt < 5 && !clickedGoogle; attempt += 1) {
      for (const selector of googleSelectors) {
        try {
          const locator = page.locator(selector).first();
          if (await locator.count() && await locator.isVisible()) {
            await locator.click({ timeout: 5_000 });
            clickedGoogle = true;
            onStep?.("clicked_google_login", "Clicked 'Continue with Google' on Cloudflare");
            break;
          }
        } catch {}
      }
      if (!clickedGoogle) await page.waitForTimeout(1_500);
    }

    if (clickedGoogle) {
      loginReady = true;
      break;
    }

    if (reloadAttempt < 2) {
      onStep?.("google_button_not_found", "Google button not found, will reload and retry");
      continue;
    }

    onStep?.("google_button_not_found", "Google button not found, trying direct OAuth URL");
    try {
      await page.goto("https://dash.cloudflare.com/login/google", { waitUntil: "domcontentloaded", timeout: 30_000 });
    } catch {
      await page.goto("https://dash.cloudflare.com/login", { waitUntil: "domcontentloaded", timeout: 30_000 });
    }
    await page.waitForTimeout(2_000);
    loginReady = true;
    break;
  }

  if (!loginReady) {
    onStep?.("login_failed_manual", "Could not proceed with login after 3 attempts, switching to manual mode");
    return false;
  }

  await page.waitForTimeout(2_000);

  const isGooglePage = await page.evaluate(() => {
    const url = window.location.href;
    return url.includes("accounts.google.com") || url.includes("google.com/o/oauth2");
  });

  if (!isGooglePage) {
    onStep?.("waiting_google_redirect", "Waiting for Google login page to load");
    try {
      await page.waitForURL(/accounts\.google\.com|google\.com\/o\/oauth2/, { timeout: 15_000 });
    } catch {
      throw new Error("Did not redirect to Google login page after clicking 'Continue with Google'");
    }
  }

  onStep?.("entering_google_email", "Entering email on Google login page");
  await page.waitForTimeout(1_000);

  if (await detectLoginError(page)) {
    onStep?.("google_login_error", "Error detected on Google login page, reloading...");
    await page.reload({ waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => {});
    await page.waitForTimeout(2_000);
  }

  await fillFirst(page, ["input[type=email]", "input[name=email]", "input#email", "input[type=email]"], email);
  await clickFirst(page, ["button[type=submit]", "button:has-text('Next')", "button:has-text('Log in')", "#next"]);
  await page.waitForTimeout(2_000);

  onStep?.("entering_google_password", "Entering password on Google login page");
  await fillFirst(page, ["input[type=password]", "input[name=password]", "input#password"], password);
  await clickFirst(page, ["button[type=submit]", "button:has-text('Log in')", "button:has-text('Sign in')", "#next"]);

  onStep?.("waiting_cloudflare_session", "Waiting for Cloudflare dashboard session; complete captcha/2FA in opened browser if needed");
  const ok = await waitForDashboardSession(page);
  if (!ok) throw new Error("Cloudflare dashboard session not ready after login timeout");
}

async function loginCloudflareWithGoogle(page, email, password, onStep) {
  const successPromise = waitForDashboardSession(page).then((ok) => {
    if (!ok) throw new Error("Cloudflare dashboard session not ready after Google login timeout");
    return { ok: true };
  });

  onStep?.("opening_cloudflare_login", "Opening Cloudflare login page");
  await page.goto("https://dash.cloudflare.com/login", { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForTimeout(2_000);

  const googleSelectors = [
    'button:has-text("Continue with Google")',
    'button:has-text("Sign in with Google")',
    'button:has-text("Log in with Google")',
    'a:has-text("Continue with Google")',
    'a:has-text("Sign in with Google")',
    '#social-google',
    'a#social-google',
    'button[class*="Google"]',
    'a[class*="Google"]',
    '[data-provider*="google" i]',
    'button:has-text("Google")',
    'a:has-text("Google")',
    'div[role="button"]:has-text("Google")',
  ];

  let clickedGoogle = false;
  for (let attempt = 0; attempt < 3 && !clickedGoogle; attempt += 1) {
    for (const selector of googleSelectors) {
      try {
        const locator = page.locator(selector).first();
        if (await locator.count() && await locator.isVisible()) {
          await locator.click({ timeout: 5_000 });
          clickedGoogle = true;
          onStep?.("selecting_google_login", `Clicked Google login button (attempt ${attempt + 1})`);
          break;
        }
      } catch {}
    }
    if (!clickedGoogle) {
      await page.waitForTimeout(2_000);
    }
  }

  if (!clickedGoogle) {
    onStep?.("google_button_not_found", "Google login button not found; trying direct OAuth URL");
    try {
      await page.goto("https://dash.cloudflare.com/login/google", { waitUntil: "domcontentloaded", timeout: 30_000 });
    } catch {
      await page.goto("https://dash.cloudflare.com/login", { waitUntil: "domcontentloaded", timeout: 30_000 });
    }
    await page.waitForTimeout(2_000);
  }

  await page.waitForTimeout(1_000);

  const result = await runGoogleAccountAutomation({
    page,
    authUrl: null,
    skipNavigation: true,
    email,
    password,
    successPromise,
    shortTimeoutMs: 5 * 60_000,
    serviceLabel: "Cloudflare",
    openingStep: "cloudflare_google_auth",
    openingMessage: "Starting Google OAuth for Cloudflare",
    successStep: "cloudflare_session_ready",
    successMessage: "Cloudflare dashboard session ready",
    onStep,
  });
  if (result.status !== "success") {
    throw new Error(result.error || "Cloudflare Google signup/login failed");
  }
}

async function createCloudflareTokenFromDashboard(page, preferredAccountId, tokenName, onStep) {
  onStep?.("reading_account_id", "Reading Cloudflare account ID from dashboard URL");
  await page.waitForTimeout(2_000);

  let accountId = preferredAccountId;
  if (!accountId) {
    try {
      await page.waitForURL(/dash\.cloudflare\.com\/[a-f0-9]{20,}/i, { timeout: 30_000 });
    } catch {}
    const currentUrl = page.url();
    const match = currentUrl.match(/dash\.cloudflare\.com\/([a-f0-9]{20,})/i);
    if (match) accountId = match[1];
  }
  if (!accountId) throw new Error("Could not determine Cloudflare account ID from dashboard URL");
  onStep?.("account_id_found", `Found Cloudflare account ID: ${accountId.slice(0, 8)}...`);

  const finalTokenName = tokenName || `9router-workers-ai-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}`;

  onStep?.("navigating_to_api_quick_start", "Navigating to Workers AI API quick start page");
  await page.goto(`https://dash.cloudflare.com/${accountId}/ai/workers-ai/api-quick-start`, {
    waitUntil: "domcontentloaded",
    timeout: 30_000,
  }).catch(() => {});

  const createSelectors = [
    'a:has-text("Create a Workers AI API Token")',
    'button:has-text("Create a Workers AI API Token")',
    'a:has-text("Create API Token")',
    'button:has-text("Create API Token")',
    'a:has-text("Create Token")',
    'button:has-text("Create Token")',
    'a:has-text("Get started")',
    'a[href*="api-tokens/create"]',
    '[data-testid*="create-token"]',
  ];

  let clickedCreate = false;
  onStep?.("looking_for_create_button", "Looking for 'Create a Workers AI API Token' button");
  for (let attempt = 0; attempt < 10 && !clickedCreate; attempt += 1) {
    for (const selector of createSelectors) {
      try {
        const locator = page.locator(selector).first();
        if (await locator.count() && await locator.isVisible()) {
          await locator.click({ timeout: 5_000 });
          clickedCreate = true;
          onStep?.("clicked_create_button", "Clicked 'Create a Workers AI API Token' button");
          break;
        }
      } catch {}
    }
    if (!clickedCreate) await page.waitForTimeout(1_500);
  }

  if (!clickedCreate) throw new Error("Could not find 'Create a Workers AI API Token' button");

  await page.waitForTimeout(2_000);

  onStep?.("filling_token_name", `Filling token name: ${finalTokenName}`);
  await fillFirst(page, ["input[name=tokenName]", "input[placeholder*=token]", "input[placeholder*=name]", "input[type=text]"], finalTokenName).catch(() => {});
  await page.waitForTimeout(500);

  onStep?.("clicking_continue", "Clicking 'Continue to summary'");
  for (const selector of [
    'button:has-text("Continue to summary")',
    'button:has-text("Continue")',
    'button[type=submit]',
    'button:has-text("Next")',
  ]) {
    try {
      const locator = page.locator(selector).first();
      if (await locator.count() && await locator.isVisible()) {
        await locator.click({ timeout: 5_000 });
        break;
      }
    } catch {}
  }

  await page.waitForTimeout(2_000);

  onStep?.("clicking_create_token", "Clicking 'Create Token' to finalize");
  for (const selector of [
    'button:has-text("Create Token")',
    'button[type=submit]:has-text("Create")',
    'button:has-text("Create")',
  ]) {
    try {
      const locator = page.locator(selector).first();
      if (await locator.count() && await locator.isVisible()) {
        await locator.click({ timeout: 5_000 });
        break;
      }
    } catch {}
  }

  await page.waitForTimeout(2_000);

  onStep?.("waiting_for_token_display", "Waiting for API token to be displayed");
  let token = null;

  try {
    await page.waitForSelector('button:has-text("Copy API Token")', { timeout: 15_000 });
  } catch {
    onStep?.("copy_button_not_found", "'Copy API Token' button not found after 15s");
  }

  for (let attempt = 0; attempt < 3 && !token; attempt += 1) {
    const copyBtn = page.locator('button:has-text("Copy API Token")').first();
    if (await copyBtn.count()) {
      onStep?.("clicking_copy_button", `Clicking 'Copy API Token' button (attempt ${attempt + 1})`);
      await copyBtn.click({ timeout: 5_000 }).catch(() => {});
      await page.waitForTimeout(800);

      try {
        const copied = await page.locator('button:has-text("Copied")').first();
        if (await copied.count()) {
          onStep?.("token_copied_to_clipboard", "Button changed to 'Copied' — token copied to clipboard");
        }
      } catch {}

      token = await page.evaluate(async () => {
        try {
          const text = await navigator.clipboard.readText();
          if (text && text.length >= 40 && text.length <= 120) return text.trim();
        } catch {}
        return null;
      });
      if (token) onStep?.("token_captured", `Token captured from clipboard (attempt ${attempt + 1})`);
    }

    if (!token) {
      onStep?.("reading_token_from_dom", `Reading token value from page DOM (attempt ${attempt + 1})`);
      token = await page.evaluate(() => {
        const tokenDiv = document.querySelector('div.c_oo');
        if (tokenDiv) {
          const text = (tokenDiv.textContent || "").trim();
          if (text.length >= 40 && text.length <= 120 && /^[A-Za-z0-9_-]+$/.test(text)) return text;
        }
        const candidates = document.querySelectorAll('div.c_oo, [class*="token-value"], code, pre, input[readonly]');
        for (const el of candidates) {
          const val = (el.value || el.textContent || "").trim();
          if (val.length >= 40 && val.length <= 120 && /^[A-Za-z0-9_-]+$/.test(val)) return val;
        }
        const allText = document.body?.innerText || "";
        const match = allText.match(/(cfut_[A-Za-z0-9_-]{20,80})/);
        return match ? match[1] : null;
      });
      if (token) onStep?.("token_captured", `Token captured from DOM (attempt ${attempt + 1})`);
    }

    if (!token) await page.waitForTimeout(1_000);
  }

  if (token) {
    onStep?.("token_capture_success", `Token captured: ${token.slice(0, 12)}... (length: ${token.length})`);
  }

  if (!token) throw new Error("Could not capture created token value from the page");

  return { apiToken: token, accountId, accountName: accountId, tokenName: finalTokenName };
}

export async function importCloudflareToken({ token, accountId, name }) {
  if (!token || !accountId) {
    const err = new Error("Missing apiToken or accountId");
    err.code = "missing_fields";
    throw err;
  }

  const tokenCheck = await verifyCloudflareToken(token);
  if (!tokenCheck.ok) {
    const err = new Error(`Token verify failed (HTTP ${tokenCheck.status})`);
    err.code = "token_invalid";
    err.status = tokenCheck.status;
    err.payload = tokenCheck.payload;
    throw err;
  }

  const workerAi = await testWorkersAi(token, accountId);
  if (!workerAi.ok) {
    const err = new Error(`Workers AI test failed (HTTP ${workerAi.status})`);
    err.code = "workers_ai_failed";
    err.status = workerAi.status;
    err.payload = workerAi.payload;
    throw err;
  }

  const { connection } = await saveCloudflareConnection({ token, accountId, name, workerAi });
  return { connection, tokenCheck, workerAi };
}

export class CloudflareBulkImportManager extends KiroBulkImportManager {
  constructor() {
    super({
      browserLauncher: defaultBrowserLauncher,
      googleAutomation: null,
      socialExchange: null,
      storageName: "cloudflare-bulk-import",
    });
  }

  async startJob({ accounts, concurrency, engine, headless, proxyUrl, proxyUrls, proxyMode, proxyPoolId, proxySource, randomizeProxySession, jobFields }) {
    const { parsed, invalidLines } = parseCloudflareBulkAccounts(accounts);
    if (!parsed.length || invalidLines.length) {
      const error = "Invalid Cloudflare format. Use email:password, email|password|optionalAccountId, apiToken|accountId|optionalName, or JSON.";
      throw Object.assign(new Error(error), { error, invalidLines });
    }
    return super.startJob({
      accounts: parsed.map((a) => `${a.email}|${a.password}`),
      concurrency: concurrency || KIRO_BULK_IMPORT_DEFAULT_CONCURRENCY,
      engine,
      headless,
      proxyUrl,
      proxyUrls,
      proxyMode,
      proxyPoolId,
      proxySource,
      randomizeProxySession,
      jobFields: {
        ...(jobFields || {}),
        accountsMeta: parsed,
      },
    });
  }

  async runJob(jobId) {
    const job = this.jobs.get(jobId);
    if (!job) return;
    const metas = job.accountsMeta || [];
    const concurrency = Math.max(1, Math.min(job.concurrency || 1, job.accounts.length));
    const workers = Array.from({ length: concurrency }, (_, index) => this.runWorker(job, index + 1, metas));
    await Promise.allSettled(workers);
    for (const browser of job.workerBrowsers || []) {
      await browser.close().catch(() => null);
    }
    job.workerBrowsers?.clear?.();
    job.status = job.cancelRequested ? "cancelled" : "completed";
    job.finishedAt = new Date().toISOString();
    await this.persistJobSnapshot(job, { forcePreview: false });
  }

  async runWorker(job, workerId, metas) {
    while (!job.cancelRequested) {
      const account = this.dequeueAccount(job, workerId);
      if (!account) return;
      const meta = metas.find((item) => item.line === account.line) || {};
      await this.processAccount(job, account, workerId, meta);
    }
  }

  async processAccount(job, account, workerId, meta) {
    let context = null;
    let browser = null;
    try {
      if (meta.mode === "browser" || meta.mode === "google") {
        this.setAccountStep(account, "creating_cloudflare_token", `Worker ${workerId} creating Cloudflare token from dashboard`);
        await this.persistJobSnapshot(job, { forcePreview: false });
        browser = await this.browserLauncher(job);
        job.workerBrowsers.add(browser);
        const fresh = await createFreshContext(browser);
        context = fresh.context;
        try {
          await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: "https://dash.cloudflare.com" });
        } catch {}
        account.runtimeSession = { context, page: fresh.page, proxyUrl: browser.__ninerouterProxyUrl || job.proxyUrl || null };
        if (meta.mode === "google") {
          await loginCloudflareWithGoogle(fresh.page, meta.email, meta.password, (step, message) => this.setAccountStep(account, step, message));
        } else {
          const loginOk = await loginCloudflare(fresh.page, meta.email, meta.password, (step, message) => this.setAccountStep(account, step, message));
          if (loginOk === false) {
            account.manualSession = { context, page: fresh.page, opened: false, openedAt: null };
            this.finalizeAccount(account, "needs_manual", {
              error: "Login failed after 3 reloads — manual intervention required",
              step: "awaiting_manual",
              message: "Login failed after 3 reloads — please complete login manually in the browser",
            });
            await this.persistJobSnapshot(job, { forcePreview: true });
            return;
          }
        }
        const created = await createCloudflareTokenFromDashboard(fresh.page, meta.accountId, meta.name, (step, message) => this.setAccountStep(account, step, message));
        if (!created?.apiToken) {
          throw new Error("Token creation completed but no token value was captured");
        }
        meta.apiToken = created.apiToken;
        console.log(`[cloudflare] captured token: prefix=${created.apiToken.slice(0, 12)}... length=${created.apiToken.length}`);
        meta.accountId = created.accountId;
        meta.name = meta.name || created.accountName || created.tokenName;
        this.setAccountStep(account, "token_captured", `Worker ${workerId} captured API token (${created.apiToken.slice(0, 8)}...)`);
        await this.persistJobSnapshot(job, { forcePreview: false });
      }

      this.setAccountStep(account, "verifying_token", `Worker ${workerId} verifying Cloudflare token`);
      await this.persistJobSnapshot(job, { forcePreview: false });
      const tokenCheck = await verifyCloudflareToken(meta.apiToken);
      if (!tokenCheck.ok) {
        this.finalizeAccount(account, "failed", { error: `Token verify failed (${tokenCheck.status})`, step: "token_invalid", message: `Token verify failed (${tokenCheck.status})` });
        return;
      }

      this.setAccountStep(account, "testing_workers_ai", "Testing Cloudflare Workers AI access");
      await this.persistJobSnapshot(job, { forcePreview: false });
      const workerAi = await testWorkersAi(meta.apiToken, meta.accountId);
      if (!workerAi.ok) {
        this.finalizeAccount(account, "failed", { error: `Workers AI test failed (${workerAi.status})`, step: "workers_ai_failed", message: `Workers AI test failed (${workerAi.status})` });
        return;
      }

      const { connection } = await saveCloudflareConnection({ token: meta.apiToken, accountId: meta.accountId, name: meta.name, workerAi });
      this.finalizeAccount(account, "success", { connectionId: connection.id, step: "connection_saved", message: "Cloudflare AI connection saved" });
    } catch (error) {
      this.finalizeAccount(account, "failed", { error: error.message, step: "failed", message: error.message });
    } finally {
      account.password = undefined;
      if (account.status === "needs_manual") {
        account.runtimeSession = null;
      } else {
        account.runtimeSession = null;
        if (context) {
          try {
            const pages = context.pages();
            for (const p of pages) await stopCdpScreencast?.(p).catch(() => null);
          } catch {}
          await context.close().catch(() => null);
        }
        if (browser) {
          job.workerBrowsers?.delete?.(browser);
          await browser.close().catch(() => null);
        }
      }
      await this.persistJobSnapshot(job, { forcePreview: false });
    }
  }
}

function getSingletonStore() {
  if (!globalThis.__cloudflareBulkImportSingleton) {
    globalThis.__cloudflareBulkImportSingleton = { manager: new CloudflareBulkImportManager() };
  }
  return globalThis.__cloudflareBulkImportSingleton;
}

export function getCloudflareBulkImportManager() {
  return getSingletonStore().manager;
}

export { buildLookupResponse, parseKiroBulkAccounts };
