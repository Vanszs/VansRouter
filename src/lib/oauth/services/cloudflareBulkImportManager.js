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
import { execFile as execFileCb, spawn } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const execFile = promisify(execFileCb);
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const CF_SIGNUP_SCRIPT = join(__dirname, "..", "..", "..", "..", "scripts", "cf_signup.py");

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

async function mailTmToken(address, password) {
  const res = await fetch("https://api.mail.tm/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ address, password }),
  });
  if (!res.ok) throw new Error(`mail.tm token error: ${res.status}`);
  const data = await res.json();
  return data.token || data.jwt || "";
}

const NAME_PARTS = [
  ["james", "michael", "robert", "john", "david", "william", "richard", "joseph", "thomas", "daniel"],
  ["smith", "johnson", "williams", "brown", "jones", "garcia", "miller", "davis", "martinez", "wilson"],
];

function generateNameLocal() {
  const first = NAME_PARTS[0][Math.floor(Math.random() * NAME_PARTS[0].length)];
  const last = NAME_PARTS[1][Math.floor(Math.random() * NAME_PARTS[1].length)];
  const num = Math.floor(Math.random() * 999);
  return `${first}.${last}${num}`;
}

async function mailTmGenerate(domain, desiredLocal) {
  for (let attempt = 0; attempt < 5; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 2000 * attempt));
    const local = desiredLocal || generateNameLocal();
    const address = `${local}@${domain}`;
    const password = "Gomugomu123098!@";
    const res = await fetch("https://api.mail.tm/accounts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address, password }),
    });
    if (res.ok) {
      const data = await res.json();
      const id = data.id || "";
      await new Promise((r) => setTimeout(r, 500));
      const jwt = await mailTmToken(address, password);
      return { address, password, jwt, id };
    }
    if (res.status === 429) {
      await new Promise((r) => setTimeout(r, 5000 * (attempt + 1)));
      continue;
    }
    if (res.status !== 422) throw new Error(`mail.tm account error: ${res.status}`);
  }
  throw new Error("mail.tm: failed to create account after 5 retries");
}

async function mailTmMessages(token) {
  const res = await fetch("https://api.mail.tm/messages", {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return [];
  const data = await res.json();
  return data["hydra:member"] || [];
}

async function mailTmMessageDetail(id, token) {
  const res = await fetch(`https://api.mail.tm/messages/${id}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  return res.json();
}

function isMailTm(mailApi) {
  return mailApi && (mailApi.includes("api.mail.tm") || mailApi === "mail.tm" || mailApi === "mailtm");
}

function isCfEmail(mailApi) {
  return mailApi && (mailApi.includes("cf-email") || mailApi === "cf-email");
}

async function cfEmailGenerate(mailApi, domain, desiredLocal) {
  const base = mailApi.replace(/\/+$/, "");
  const params = new URLSearchParams({ domain });
  if (desiredLocal) params.set("local", desiredLocal);
  const res = await fetch(`${base}/api/address?${params}`);
  if (!res.ok) throw new Error(`CF Email API error: ${res.status}`);
  const data = await res.json();
  const address = data.address || "";
  if (!address) throw new Error("CF Email API missing address field");
  return { address, jwt: address };
}

async function cfEmailMessages(mailApi, addr) {
  const base = mailApi.replace(/\/+$/, "");
  const res = await fetch(`${base}/api/messages?addr=${encodeURIComponent(addr)}`);
  if (!res.ok) return [];
  return res.json();
}

async function cfEmailMessageRaw(mailApi, addr, idx) {
  const base = mailApi.replace(/\/+$/, "");
  const res = await fetch(`${base}/api/messages/${idx}/raw?addr=${encodeURIComponent(addr)}`);
  if (!res.ok) return { html: "" };
  const data = await res.json();
  return data;
}

async function generateTempEmail(mailApi, domain, password, mailProvider, desiredLocal) {
  if (mailProvider === "mailtm" || isMailTm(mailApi)) {
    return mailTmGenerate(domain, desiredLocal);
  }
  if (mailProvider === "cf-email" || isCfEmail(mailApi)) {
    return cfEmailGenerate(mailApi, domain, desiredLocal);
  }
  const res = await fetch(mailApi, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ domain }),
  });
  if (!res.ok) throw new Error(`Mail API error: ${res.status} ${res.statusText}`);
  const data = await res.json();
  const address = data.address || data.email || data.email_address || "";
  const jwt = data.jwt || data.token || data.key || "";
  if (!address) throw new Error("Mail API response missing address field");
  return { address, jwt };
}

async function waitForEmailVerification(mailApi, email, jwt, timeoutMs = 180_000, mailProvider) {
  const start = Date.now();
  const isMail = mailProvider === "mailtm" || isMailTm(mailApi);
  const isCf = mailProvider === "cf-email" || isCfEmail(mailApi);
  const base = isCf ? mailApi.replace(/\/+$/, "") : "";
  while (Date.now() - start < timeoutMs) {
    await new Promise((r) => setTimeout(r, 5_000));
    try {
      let messages = [];
      if (isMail) {
        messages = await mailTmMessages(jwt);
      } else if (isCf) {
        messages = await cfEmailMessages(base, jwt || email);
      } else {
        const res = await fetch(mailApi.replace("/new_address", "/parsed_mails"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ address: email, jwt }),
        });
        if (res.ok) {
          const data = await res.json();
          messages = Array.isArray(data) ? data : (data.mails || data.messages || []);
        }
      }
      for (const [idx, mail] of messages.entries()) {
        if (isMail) {
          const detail = await mailTmMessageDetail(mail.id, jwt);
          if (!detail) continue;
          const html = (detail.html || detail.text || "").toLowerCase();
          const subject = (detail.subject || "").toLowerCase();
          if (!subject.includes("verify") && !html.includes("verify")) continue;
          const linkMatch = html.match(/https?:\/\/[^\s"']+/);
          if (linkMatch) return linkMatch[0];
        } else if (isCf) {
          const subject = (mail.subject || "").toLowerCase();
          const text = (mail.text || "").toLowerCase();
          if (!subject.includes("verify") && !text.includes("verify")) continue;
          let body = mail.text || mail.html || "";
          if (!body) {
            const raw = await cfEmailMessageRaw(base, jwt || email, idx);
            body = raw.html || "";
          }
          const linkMatch = body.match(/https?:\/\/[^\s"']+/);
          if (linkMatch) return linkMatch[0];
        } else {
          const body = (mail.body || mail.text || mail.html || "").toLowerCase();
          const subject = (mail.subject || "").toLowerCase();
          const from = (mail.from || "").toLowerCase();
          if ((subject.includes("verify") || body.includes("verify")) &&
              (from.includes("cloudflare") || body.includes("cloudflare"))) {
            const linkMatch = body.match(/https?:\/\/[^\s"']+/);
            if (linkMatch) return linkMatch[0];
          }
        }
      }
    } catch {}
  }
  return null;
}

async function handleTurnstile(page, onStep) {
  const start = Date.now();
  const TIMEOUT = 30_000;

  while (Date.now() - start < TIMEOUT) {
    if (await isTurnstilePassed(page, onStep)) {
      onStep?.("turnstile_passed", "Turnstile resolved (token found)");
      return true;
    }

    // use Playwright frames() API — lists ALL frames including cross-origin iframes
    // that document.querySelectorAll('iframe') can't access properly
    const frames = page.frames();
    const turnstileFrames = frames.filter(f => {
      const url = f.url();
      return url.includes("challenges") || url.includes("turnstile") || url.includes("cloudflare");
    });
    onStep?.("turnstile_frames", `${frames.length} total frames, ${turnstileFrames.length} Turnstile frame(s): ${turnstileFrames.map(f => f.url().slice(0, 60)).join(", ")}`);

    // try clicking checkbox inside each Turnstile frame
    for (const frame of turnstileFrames) {
      try {
        const cb = frame.locator('input[type="checkbox"], [role="checkbox"]').first();
        if (await cb.count()) {
          await cb.click({ timeout: 3_000 });
          onStep?.("turnstile_frame_cb_clicked", `Frame checkbox clicked: ${frame.url().slice(0, 50)}`);
          await page.waitForTimeout(3_000);
          if (await isTurnstilePassed(page, onStep)) return true;
        }
      } catch (e) {
        onStep?.("turnstile_frame_cb_error", `${frame.url().slice(0, 40)}: ${e.message.slice(0, 80)}`);
      }
      // try "Verify you are human" text
      try {
        const textEl = frame.getByText("Verify you are human").first();
        if (await textEl.count()) {
          await textEl.click({ timeout: 3_000 });
          onStep?.("turnstile_frame_text_clicked", "Frame text clicked");
          await page.waitForTimeout(3_000);
          if (await isTurnstilePassed(page, onStep)) return true;
        }
      } catch {}
    }

    // try ALL frames (not just Turnstile-named ones — CF might use unexpected URL)
    for (const frame of frames) {
      if (frame === page.mainFrame()) continue;
      const url = frame.url();
      if (url.includes("onetrust") || url.includes("google") || url.includes("analytics")) continue;
      try {
        const cb = frame.locator('input[type="checkbox"], [role="checkbox"]').first();
        if (await cb.count()) {
          await cb.click({ timeout: 2_000 });
          onStep?.("turnstile_anyframe_cb_clicked", `Checkbox in frame: ${url.slice(0, 50)}`);
          await page.waitForTimeout(3_000);
          if (await isTurnstilePassed(page, onStep)) return true;
        }
      } catch {}
    }

    // coordinate click: find any visible iframe > 50px and click left side (checkbox position)
    try {
      const visibleIframes = page.locator('iframe:visible');
      const count = await visibleIframes.count();
      for (let i = 0; i < count; i++) {
        const box = await visibleIframes.nth(i).boundingBox();
        if (box && box.width > 50 && box.height > 30) {
          await page.mouse.move(box.x + 25, box.y + box.height / 2);
          await page.mouse.click(box.x + 25, box.y + box.height / 2);
          onStep?.("turnstile_coord_click", `Coord click iframe #${i + 1} (${Math.round(box.width)}x${Math.round(box.height)}) at (${Math.round(box.x + 25)}, ${Math.round(box.y + box.height / 2)})`);
          await page.waitForTimeout(3_000);
          if (await isTurnstilePassed(page, onStep)) return true;
        }
      }
    } catch (e) {
      onStep?.("turnstile_coord_error", `Coord click error: ${e.message.slice(0, 80)}`);
    }

    const elapsed = Math.floor((Date.now() - start) / 1000);
    onStep?.("turnstile_waiting", `Waiting for Turnstile (${elapsed}s)`);
    await page.waitForTimeout(3_000);
  }

  onStep?.("turnstile_failed", "Turnstile not resolved after 30s, submitting anyway");
  return false;
}

async function isTurnstilePassed(page, onStep) {
  try {
    const result = await page.evaluate(() => {
      // 1. any input with "turnstile" in name/id, or inside .cf-turnstile
      const inputs = document.querySelectorAll('input[name*="turnstile"], input[id*="turnstile"], .cf-turnstile input, [name="cf-turnstile-response"]');
      for (const el of inputs) {
        if (el.value && el.value.length > 10) return { src: "input", val: el.value.slice(0, 20) };
      }
      // 2. any iframe with data-token
      const iframes = document.querySelectorAll('iframe');
      for (const f of iframes) {
        const dt = f.getAttribute("data-token");
        if (dt && dt.length > 10) return { src: "iframe", val: dt.slice(0, 20) };
      }
      // 3. turnstile.getResponse() — try without ID, then with all widget IDs
      if (typeof window !== "undefined" && typeof window.turnstile !== "undefined" && typeof window.turnstile.getResponse === "function") {
        const r = window.turnstile.getResponse();
        if (r && r.length > 10) return { src: "api", val: r.slice(0, 20) };
        const widgets = document.querySelectorAll('[data-widget-id]');
        for (const w of widgets) {
          const id = w.getAttribute("data-widget-id");
          if (id) {
            const r2 = window.turnstile.getResponse(id);
            if (r2 && r2.length > 10) return { src: "api:" + id, val: r2.slice(0, 20) };
          }
        }
      }
      // 4. any hidden input with very long value (Turnstile tokens are 240+ chars)
      const allInputs = document.querySelectorAll('input[type="hidden"]');
      for (const el of allInputs) {
        if (el.value && el.value.length > 100) return { src: "hidden", val: el.value.slice(0, 20) };
      }
      return null;
    });
    if (result) {
      onStep?.("turnstile_detected", `Token found via ${result.src}: ${result.val}...`);
      return true;
    }
  } catch (e) {
    onStep?.("turnstile_detect_error", `Detection error: ${e.message}`);
  }
  return false;
}

async function signupCloudflareViaPython(email, password, proxyUrl, headless, mailApi, tokenName, engine, onStep, onPreview, jobRef) {
  onStep?.("python_signup_start", "Starting Python signup + verify + token creation");
  const args = [
    CF_SIGNUP_SCRIPT,
    "--email", email,
    "--password", password,
  ];
  if (mailApi) args.push("--mail-api", mailApi);
  if (tokenName) args.push("--token-name", tokenName);
  if (proxyUrl) args.push("--proxy", proxyUrl);
  if (headless) args.push("--headless");
  if (engine) args.push("--engine", engine);

  onStep?.("python_signup_running", `Running: python3 cf_signup.py --email ${email.slice(0, 10)}...`);
  return new Promise((resolve) => {
    const child = spawn("python3", args, {
      timeout: 300_000,
      stdio: ["ignore", "pipe", "pipe"],
    });
    // allow cancel button to kill subprocess
    if (jobRef) {
      if (!jobRef._pythonChildren) jobRef._pythonChildren = new Set();
      jobRef._pythonChildren.add(child);
    }
    let stdout = "";
    let stderrLast = "";
    let stderrBuffer = "";

    child.stderr.on("data", (chunk) => {
      stderrBuffer += chunk.toString();
      const lines = stderrBuffer.split("\n");
      stderrBuffer = lines.pop() || "";
      for (const line of lines) {
        if (!line.trim()) continue;
        stderrLast = line.trim();
        const previewMatch = line.match(/^\[preview\]\s+(\S+)\s+(.+)$/);
        if (previewMatch) {
          console.log(`[cloudflare] preview received: step=${previewMatch[1]} b64_len=${previewMatch[2].length}`);
          onPreview?.(previewMatch[1], previewMatch[2]);
          continue;
        }
        if (line.includes("[poll]") || line.includes("[verify] error") || line.includes("[verify] HTTP")) continue;
        onStep?.("python_log", line);
      }
    });

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    const _cleanup = () => {
      if (jobRef?._pythonChildren) jobRef._pythonChildren.delete(child);
    };

    child.on("close", (code) => {
      _cleanup();
      try {
        const result = JSON.parse(stdout.trim().split("\n").pop());
        if (result.success) {
          onStep?.("python_signup_success", `Signup success, account_id: ${result.account_id?.slice(0, 8)}... token: ${result.api_token ? result.api_token.slice(0, 8) + "..." : "no"}`);
          resolve({
            submitted: true,
            needsVerification: false,
            accountId: result.account_id,
            apiToken: result.api_token || null,
            cookies: result.cookies || [],
            error: null,
          });
        } else {
          onStep?.("python_signup_failed", `Signup failed: ${result.error}`);
          resolve({ submitted: false, needsVerification: false, accountId: result.account_id || null, apiToken: null, cookies: result.cookies || [], error: result.error });
        }
      } catch (e) {
        onStep?.("python_signup_error", `Python output parse error: ${e.message}`);
        resolve({ submitted: false, needsVerification: false, accountId: null, apiToken: null, cookies: [], error: `Parse error (exit ${code}): ${stderrLast}` });
      }
    });

    child.on("error", (err) => {
      _cleanup();
      onStep?.("python_signup_error", `Python spawn error: ${err.message}`);
      resolve({ submitted: false, needsVerification: false, accountId: null, apiToken: null, cookies: [], error: err.message });
    });
  });
}

async function signupCloudflare(page, email, password, onStep) {
  onStep?.("opening_signup", "Opening Cloudflare signup page");
  await page.goto("https://dash.cloudflare.com/signup", { waitUntil: "load", timeout: 60_000 });
  await page.waitForTimeout(3_000);

  const emailSelectors = [
    "input[type=email]", "input[name=email]", "input#email",
    "input[placeholder*=email]", "input[autocomplete=email]",
  ];
  const passwordSelectors = [
    "input[type=password]", "input[name=password]", "input#password",
    "input[placeholder*=password]",
  ];

  onStep?.("entering_email", "Entering email on signup form");
  await fillFirst(page, emailSelectors, email);
  await page.waitForTimeout(500);

  onStep?.("entering_password", "Entering password on signup form");
  await fillFirst(page, passwordSelectors, password);
  await page.waitForTimeout(500);

  onStep?.("handling_turnstile", "Attempting to pass Turnstile challenge");
  await handleTurnstile(page, onStep);
  await page.waitForTimeout(3_000);

  const submitSelectors = [
    'button[type=submit]:not([disabled])', 'button:has-text("Create Account"):not([disabled])',
    'button:has-text("Sign Up"):not([disabled])', 'button:has-text("Get Started"):not([disabled])',
    'button:has-text("Continue"):not([disabled])',
    'button[type=submit]', 'button:has-text("Create Account")',
    'button:has-text("Sign Up")', 'button:has-text("Get Started")',
    'button:has-text("Continue")',
  ];
  onStep?.("submitting_signup", "Submitting signup form");
  await clickFirst(page, submitSelectors);

  onStep?.("waiting_verification", "Waiting for email verification page after signup");
  await page.waitForTimeout(3_000);

  const currentUrl = page.url();
  const verifyPrompt = currentUrl.includes("verify") || currentUrl.includes("confirm");
  if (verifyPrompt) {
    onStep?.("verification_needed", "Signup submitted — verification email sent. Waiting for user to verify via email link.");
    return { submitted: true, needsVerification: true };
  }

  await page.waitForTimeout(2_000);
  const signupError = await detectLoginError(page);
  if (signupError) {
    onStep?.("signup_error", "Error detected on signup page — may need manual intervention");
    return { submitted: false, needsVerification: false, error: "Signup page showing error" };
  }

  return { submitted: true, needsVerification: false };
}

async function loginCloudflareWithPassword(page, email, password, onStep) {
  onStep?.("opening_login", "Opening Cloudflare login page");
  await page.goto("https://dash.cloudflare.com/login", { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForTimeout(3_000);

  const emailSelectors = [
    "input[type=email]", "input[name=email]", "input#email",
    "input[placeholder*=email]", "input[autocomplete=email]",
  ];
  const passwordSelectors = [
    "input[type=password]", "input[name=password]", "input#password",
    "input[placeholder*=password]",
  ];

  onStep?.("entering_login_email", "Entering email on login page");
  await fillFirst(page, emailSelectors, email);
  await page.waitForTimeout(500);

  onStep?.("clicking_login_continue", "Clicking continue after email");
  await clickFirst(page, [
    'button[type=submit]', 'button:has-text("Continue")',
    'button:has-text("Next")', 'button:has-text("Sign in")',
  ]);
  await page.waitForTimeout(2_000);

  onStep?.("entering_login_password", "Entering password on login page");
  await fillFirst(page, passwordSelectors, password);
  await page.waitForTimeout(500);

  onStep?.("submitting_login", "Submitting login");
  await clickFirst(page, [
    'button[type=submit]', 'button:has-text("Sign in")',
    'button:has-text("Log in")', 'button:has-text("Continue")',
  ]);

  onStep?.("waiting_dashboard_session", "Waiting for Cloudflare dashboard session");
  const ok = await waitForDashboardSession(page);
  if (!ok) throw new Error("Cloudflare dashboard session not ready after login");
  return true;
}

async function generatePassword() {
  return "Gomugomu123098!@";
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

  async startJob({ accounts, concurrency, engine, headless, proxyUrl, proxyUrls, proxyMode, proxyPoolId, proxySource, randomizeProxySession, jobFields, mailApi, mailDomains, signupMode, mailProvider }) {
    if (signupMode && mailApi) {
      const domains = Array.isArray(mailDomains) ? mailDomains : (String(mailDomains || "").split(",").map((d) => d.trim()).filter(Boolean));
      if (!domains.length) {
        const error = "mailDomains required for signup mode";
        throw Object.assign(new Error(error), { error });
      }
      const placeholders = accounts.map((_, i) => ({
        line: i + 1, email: `pending-${i + 1}@placeholder`, password: "",
        jwt: "", mode: "signup", apiToken: "", accountId: "", name: "",
        _mailDomain: domains[i % domains.length],
      }));
      return super.startJob({
        accounts: placeholders.map((a) => `${a.email}|placeholder`),
        concurrency: concurrency || 1,
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
          accountsMeta: placeholders,
          mailApi,
          mailDomains: domains,
          mailProvider: mailProvider || "custom",
        },
      });
    }

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
    console.log(`[cloudflare] runJob jobId=${jobId} concurrency=${concurrency} accounts=${job.accounts.length} job.concurrency=${job.concurrency}`);
    const workers = Array.from({ length: concurrency }, (_, index) => this.runWorker(job, index + 1, metas));
    await Promise.allSettled(workers);
    for (const browser of job.workerBrowsers || []) {
      await browser.close().catch(() => null);
    }
    job.workerBrowsers?.clear?.();
    if (job._pythonChildren) {
      for (const child of job._pythonChildren) {
        child.kill("SIGTERM");
      }
      job._pythonChildren.clear();
    }
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
    const email = meta.email || account.email || "";
    const password = meta.password || account.password || "";
    try {
      if (meta.mode === "signup") {
        const mailApi = job.mailApi || "";
        const mailProvider = job.mailProvider || "custom";
        const isMail = mailProvider === "mailtm" || isMailTm(mailApi);
        const domains = job.mailDomains || [];
        const mailDomain = meta._mailDomain || (Array.isArray(domains) ? domains[0] : String(domains).split(",")[0]) || "web-library.net";

        this.setAccountStep(account, "generating_temp_email", `Worker ${workerId} generating disposable email`);
        await this.persistJobSnapshot(job, { forcePreview: false });
        await new Promise((r) => setTimeout(r, isMail ? 2000 : 500));
        const desiredLocal = generateNameLocal();
        const { address, jwt, password: mailPassword } = await generateTempEmail(mailApi, mailDomain, undefined, mailProvider, desiredLocal);
        const realPassword = "Gomugomu123098!@";
        meta.email = address;
        meta.password = realPassword;
        meta.jwt = jwt;
        account.email = address;

        this.setAccountStep(account, "signing_up_cloudflare", `Worker ${workerId} signing up Cloudflare with ${address}`);
        await this.persistJobSnapshot(job, { forcePreview: false });

        // Phase 1: signup + Turnstile via Python (OpenCV template matching)
        const proxyUrl = job.proxyUrl || null;
        const pyHeadless = job?.headless ?? false;
        const engine = job?.engine || "cloakbrowser";
        const tokenName = meta.name || `9router-workers-ai-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}`;
        const pyResult = await signupCloudflareViaPython(
          address, realPassword, proxyUrl, pyHeadless, job.mailApi, tokenName, engine,
          (step, message) => this.setAccountStep(account, step, message),
          async (step, b64) => {
            job.lastPreview = {
              email: address,
              workerId,
              status: account.status,
              step,
              updatedAt: new Date().toISOString(),
              imageData: `data:image/jpeg;base64,${b64}`,
            };
          },
          job
        );
        if (pyResult.error) {
          this.finalizeAccount(account, "needs_manual", { error: pyResult.error, step: "signup_error", message: "Signup failed — manual intervention required" });
          await this.persistJobSnapshot(job, { forcePreview: true });
          return;
        }
        if (pyResult.accountId) meta.accountId = pyResult.accountId;

        if (pyResult.apiToken) {
          // Python did everything (signup + verify + token) — skip Playwright
          meta.apiToken = pyResult.apiToken;
          meta.name = tokenName;
          this.setAccountStep(account, "python_complete", `Worker ${workerId} Python completed full flow, token: ${pyResult.apiToken.slice(0, 8)}...`);
          await this.persistJobSnapshot(job, { forcePreview: true });
        } else {
          // Fallback: no token from Python, use Playwright for verification/login/token
          browser = await this.browserLauncher(job);
          job.workerBrowsers.add(browser);
          const fresh = await createFreshContext(browser, { engine: job.engine });
          context = fresh.context;
          if (pyResult.cookies?.length) {
            try {
              const playwrightCookies = pyResult.cookies.map(c => ({
                name: c.name,
                value: c.value,
                domain: c.domain,
                path: c.path || "/",
                secure: c.secure ?? true,
                httpOnly: c.httpOnly ?? false,
                sameSite: c.sameSite || "Lax",
              }));
              await fresh.context.addCookies(playwrightCookies);
            } catch (e) {
              this.setAccountStep(account, "cookie_inject_error", `Cookie injection failed: ${e.message}`);
            }
          }
          account.runtimeSession = { context, page: fresh.page, proxyUrl: browser.__ninerouterProxyUrl || job.proxyUrl || null };

          const signupResult = { submitted: pyResult.submitted, needsVerification: pyResult.needsVerification };
          if (signupResult.error) {
            account.manualSession = { context, page: fresh.page, opened: false, openedAt: null };
            this.finalizeAccount(account, "needs_manual", { error: signupResult.error, step: "signup_error", message: "Signup failed — manual intervention required" });
            await this.persistJobSnapshot(job, { forcePreview: true });
            return;
          }
          if (signupResult.needsVerification) {
            const mailApi = job.mailApi || "";
            const jwt = meta.jwt || "";
            this.setAccountStep(account, "verifying_email", "Waiting for Cloudflare verification email");
            await this.persistJobSnapshot(job, { forcePreview: false });
            const verifyLink = await waitForEmailVerification(mailApi, meta.email, jwt, 180_000, mailProvider);
            if (verifyLink) {
              this.setAccountStep(account, "clicking_verify_link", "Clicking email verification link");
              await fresh.page.goto(verifyLink, { waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => {});
              await fresh.page.waitForTimeout(3_000);
            } else {
              this.setAccountStep(account, "verification_timeout", "Email verification timed out — trying to proceed anyway");
            }
          }
          const currentUrl = fresh.page.url();
          const alreadyOnDashboard = /dash\.cloudflare\.com\/[a-f0-9]{20,}/i.test(currentUrl);
          if (alreadyOnDashboard) {
            this.setAccountStep(account, "already_logged_in", `Worker ${workerId} already logged in (session from signup)`);
          } else {
            this.setAccountStep(account, "logging_in_after_signup", `Worker ${workerId} logging in after signup`);
            await loginCloudflareWithPassword(fresh.page, meta.email, meta.password, (step, message) => this.setAccountStep(account, step, message));
          }
          const created = await createCloudflareTokenFromDashboard(fresh.page, meta.accountId, meta.name, (step, message) => this.setAccountStep(account, step, message));
          if (!created?.apiToken) throw new Error("Token creation completed but no token value was captured");
          meta.apiToken = created.apiToken;
          meta.accountId = created.accountId;
          meta.name = meta.name || created.accountName || created.tokenName;
          this.setAccountStep(account, "token_captured", `Worker ${workerId} captured API token (${created.apiToken.slice(0, 8)}...)`);
          await this.persistJobSnapshot(job, { forcePreview: false });
        }
      } else if (meta.mode === "browser" || meta.mode === "google") {
        this.setAccountStep(account, "creating_cloudflare_token", `Worker ${workerId} creating Cloudflare token from dashboard`);
        await this.persistJobSnapshot(job, { forcePreview: false });
        browser = await this.browserLauncher(job);
        job.workerBrowsers.add(browser);
        const fresh = await createFreshContext(browser, { engine: job.engine });
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
