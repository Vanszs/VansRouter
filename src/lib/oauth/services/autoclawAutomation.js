import { runGoogleAccountAutomation } from "./kiroGoogleAutomation.js";
import { solveShumeiCaptcha } from "@/lib/oauth/utils/captchaSolver.js";

const AUTOCLAW_WEB_URL = "https://autoclaw.z.ai/web/";
const DEFAULT_SHORT_TIMEOUT_MS = 5 * 60_000; // 5 minutes — proxy flows need room
const DEFAULT_MANUAL_TIMEOUT_MS = 15 * 60_000;

// Proxy-friendly timeouts: when routing through a SOCKS5/HTTP proxy, page
// loads, popups, and selector renders take much longer than direct. These
// budgets give each phase enough room to settle before we declare failure.
const NAV_TIMEOUT_MS = 90_000;
const DOM_READY_TIMEOUT_MS = 60_000;
const LOGIN_BUTTON_TIMEOUT_MS = 60_000;
const ZAI_BUTTON_TIMEOUT_MS = 60_000;
const POPUP_WAIT_TIMEOUT_MS = 30_000;
const ZAI_FORM_TIMEOUT_MS = 60_000;

// Selectors for AutoClaw web login gate
const AUTOCLAW_LOGIN_BUTTON_SELECTORS = [
  'button:has-text("去注册")',
  'button:has-text("登录")',
  'button:has-text("Sign in")',
  'button:has-text("Login")',
  '[class*="login-gate"] button',
  '[class*="login"] button',
];

const AUTOCLAW_ZAI_BUTTON_SELECTORS = [
  'button:has-text("Continue with Zai")',
  'button:has-text("Zai")',
  '[aria-label*="Zai"]',
  '[class*="zai"] button',
];

/**
 * Poll all browser context pages for AutoClaw tokens in localStorage.
 *
 * Flow: after Google login + Z.ai authorize, the popup redirects back to
 * autoclaw.z.ai/web/?webOAuthCallback=zai. The web app processes the callback,
 * stores tokens in localStorage, then may close the popup and refresh tab 0.
 *
 * This monitor polls every 500ms across ALL context pages (popup + main tab)
 * to catch the token regardless of which tab ends up with it.
 */
export function createAutoclawTokenMonitor(context, timeoutMs = DEFAULT_MANUAL_TIMEOUT_MS) {
  let resolveOuter;
  let rejectOuter;
  const promise = new Promise((resolve, reject) => {
    resolveOuter = resolve;
    rejectOuter = reject;
  });

  let settled = false;
  let intervalHandle = null;
  const timeoutHandle = setTimeout(() => {
    if (intervalHandle) clearInterval(intervalHandle);
    settle(null, new Error("Timed out waiting for AutoClaw token in localStorage"));
  }, timeoutMs);

  function settle(result, error = null) {
    if (settled) return;
    settled = true;
    if (intervalHandle) clearInterval(intervalHandle);
    clearTimeout(timeoutHandle);
    if (error) rejectOuter(error);
    else resolveOuter(result);
  }

  async function checkPage(page) {
    try {
      const url = page.url();
      if (!url.includes("autoclaw.z.ai")) return false;

      const data = await page.evaluate(() => {
        try {
          const authToken = localStorage.getItem("autoclaw.web.authToken") || "";
          const refreshToken = localStorage.getItem("autoclaw.web.refreshToken") || "";
          const deviceId = localStorage.getItem("autoclaw.web.deviceId") || "";
          const loginInfoRaw = localStorage.getItem("autoclaw.web.loginInfo") || "{}";
          const loginInfo = JSON.parse(loginInfoRaw);
          return { authToken, refreshToken, deviceId, loginInfo };
        } catch {
          return null;
        }
      });

      if (!data) return false;

      if (!data.authToken || !data.refreshToken) return false;

      settle({
        access_token: data.authToken.replace(/^Bearer\s+/i, ""),
        refresh_token: data.refreshToken.replace(/^Bearer\s+/i, ""),
        user_id: data.loginInfo.user_id || "",
        user_name: data.loginInfo.user_name || "",
        device_id: data.deviceId || "",
        first_login: data.loginInfo.first_login ?? false,
      });
      return true;
    } catch {
      // page may be closed or navigating — skip
      return false;
    }
  }

  intervalHandle = setInterval(async () => {
    if (settled) return;
    try {
      const pages = context.pages();
      for (const p of pages) {
        if (await checkPage(p)) return;
      }
    } catch {
      // context closed (browser killed / job cancelled) — reject immediately
      // so cancelJob doesn't hang waiting for the 15-min timeout
      settle(null, new Error("Browser context closed — monitoring stopped"));
    }
  }, 500);

  return promise;
}

/**
 * Poll for a selector to appear (visible). Returns true as soon as the selector
 * is visible, false on timeout. This replaces fixed `waitForTimeout` delays
 * after clicking a button — instead of waiting a fixed 1.5-2s, we poll every
 * 200ms and advance immediately when the next screen renders.
 */
async function waitForSelectorVisible(page, selectors, { timeoutMs = 10_000, pollIntervalMs = 200 } = {}) {
  const sel = Array.isArray(selectors) ? selectors.join(", ") : selectors;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const loc = page.locator(sel).first();
      const visible = await loc.isVisible({ timeout: pollIntervalMs }).catch(() => false);
      if (visible) return true;
    } catch {
      // page may be navigating — keep polling
    }
    await new Promise((r) => setTimeout(r, pollIntervalMs));
  }
  return false;
}

/**
 * Wait for a DOM load state with periodic step reporting so the UI does not
 * look like the worker is hung while the page is still loading through a slow
 * proxy. Reports every ~5s with elapsed seconds.
 *
 * Resolves true if the load state was reached, false on timeout.
 */
async function waitForLoadStateWithProgress(page, state, timeoutMs, reportStep, stepId, label) {
  const startedAt = Date.now();
  reportStep(stepId, `${label} (0s)`);

  // Playwright's waitForLoadState rejects on timeout; we wrap it so we can
  // keep reporting progress and return a boolean instead of throwing.
  let done = false;
  const waitPromise = page
    .waitForLoadState(state, { timeout: timeoutMs })
    .then(() => {
      done = true;
    })
    .catch(() => {
      done = false;
    });

  // Progress reporter loop — breaks as soon as the wait settles.
  while (!done) {
    const elapsed = Math.floor((Date.now() - startedAt) / 1000);
    const isSettled = await Promise.race([
      waitPromise.then(() => true),
      new Promise((resolve) => setTimeout(() => resolve(false), 5000)),
    ]);
    if (isSettled) break;
    reportStep(stepId, `${label} (${elapsed}s)`);
  }

  await waitPromise;
  const elapsed = Math.floor((Date.now() - startedAt) / 1000);
  if (done) {
    reportStep(stepId, `${label} done (${elapsed}s)`);
  } else {
    reportStep(stepId, `${label} timed out after ${elapsed}s — continuing anyway`);
  }
  return done;
}

/**
 * Poll for the first visible matching selector until timeout, reporting
 * progress every ~5s. Returns true if a selector became visible and was
 * clicked, false on timeout.
 *
 * This replaces the old one-shot clickFirstVisible (2s per selector) which
 * failed immediately when the page was still loading through a slow proxy.
 */
async function pollAndClickFirstVisible(page, selectors, {
  timeoutMs,
  reportStep,
  stepId,
  notFoundMessage,
  clickTimeoutMs = 5_000,
  pollIntervalMs = 1_000,
} = {}) {
  const startedAt = Date.now();
  let lastReportedElapsed = -1;

  while (Date.now() - startedAt < timeoutMs) {
    const elapsed = Math.floor((Date.now() - startedAt) / 1000);
    // Report at most once per second to avoid flooding the snapshot log.
    if (elapsed !== lastReportedElapsed) {
      reportStep(stepId, `${notFoundMessage} (${elapsed}s)`);
      lastReportedElapsed = elapsed;
    }

    for (const sel of selectors) {
      try {
        const loc = page.locator(sel).first();
        const visible = await loc.isVisible({ timeout: 1_000 }).catch(() => false);
        if (visible) {
          const clicked = await loc
            .click({ timeout: clickTimeoutMs })
            .then(() => true)
            .catch(() => false);
          if (clicked) {
            reportStep(stepId, `${notFoundMessage} — clicked (${elapsed}s)`);
            return true;
          }
        }
      } catch {
        // keep polling
      }
    }

    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  const elapsed = Math.floor((Date.now() - startedAt) / 1000);
  reportStep(stepId, `${notFoundMessage} — not found after ${elapsed}s`);
  return false;
}

/**
 * Wait for the Z.ai auth popup tab to open, reporting progress while we wait.
 * Returns { popup, isPopup }. If no popup opens within timeout, falls back to
 * the main page (same-tab redirect).
 */
async function waitForZaiPopup(context, mainPage, timeoutMs, reportStep) {
  const startedAt = Date.now();
  reportStep("waiting_zai_popup", "Waiting for Z.ai auth popup to open (0s)");

  let popup = null;
  let lastReportedElapsed = -1;

  // Captcha solve can open the popup before this watcher starts. Reuse an
  // existing non-main tab instead of waiting for a future page event forever.
  const existingPopup = context.pages().find((p) => p !== mainPage);
  if (existingPopup) {
    reportStep("zai_popup_opened", "Z.ai auth popup tab already open — waiting for commit");
    await waitForLoadStateWithProgress(
      existingPopup,
      "commit",
      DOM_READY_TIMEOUT_MS,
      reportStep,
      "zai_popup_dom_loading",
      "Z.ai auth popup loading"
    );
    return { popup: existingPopup, isPopup: true };
  }

  while (Date.now() - startedAt < timeoutMs) {
    const elapsed = Math.floor((Date.now() - startedAt) / 1000);
    if (elapsed !== lastReportedElapsed) {
      reportStep("waiting_zai_popup", `Waiting for Z.ai auth popup to open (${elapsed}s)`);
      lastReportedElapsed = elapsed;
    }

    try {
      popup = await context.waitForEvent("page", { timeout: 2_000 });
      if (popup) {
        reportStep("zai_popup_opened", `Z.ai auth popup tab opened (${elapsed}s) — waiting for commit`);
        // "commit" = HTML received and parsed, but CSS/JS/fonts may still be
        // loading. This is the earliest reliable point to start interacting.
        await waitForLoadStateWithProgress(
          popup,
          "commit",
          DOM_READY_TIMEOUT_MS,
          reportStep,
          "zai_popup_dom_loading",
          "Z.ai auth popup loading"
        );
        return { popup, isPopup: true };
      }
    } catch {
      // No popup within this 2s slice — keep polling until the overall budget
      // runs out, then fall back to same-tab.
    }
  }

  const elapsed = Math.floor((Date.now() - startedAt) / 1000);
  reportStep("zai_same_tab", `No popup detected after ${elapsed}s — Z.ai auth may load in same tab`);
  return { popup: mainPage, isPopup: false };
}

/**
 * Wait for the Z.ai auth form (or Google button) to render on the popup/main
 * page, reporting progress while we wait. Returns true if ready, false on
 * timeout.
 */
async function waitForZaiAuthReady(page, timeoutMs, reportStep) {
  const zaiReadySelectors = [
    'button:has-text("Continue with Google")',
    'button:has-text("Google")',
    'a:has-text("Google")',
    '[role="button"]:has-text("Google")',
    'button.ButtonContinueWithGoogle',
    'button[class*="ContinueWithGoogle"]',
    'input[type="email"]',
    'input[autocomplete="username"]',
    'input[placeholder*="Email" i]',
    'button:has-text("Login")',
    'button:has-text("Sign in")',
  ].join(", ");

  // Ensure DOM is loaded before any interaction
  await page.waitForLoadState("domcontentloaded").catch(() => null);

  const startedAt = Date.now();
  let lastReportedElapsed = -1;

  while (Date.now() - startedAt < timeoutMs) {
    const elapsed = Math.floor((Date.now() - startedAt) / 1000);
    if (elapsed !== lastReportedElapsed) {
      reportStep("waiting_zai_auth_form", `Waiting for Z.ai auth page to render (${elapsed}s)`);
      lastReportedElapsed = elapsed;
    }

    try {
      await page.waitForSelector(zaiReadySelectors, {
        state: "visible",
        timeout: 3_000,
      });
      reportStep("zai_ready", `Z.ai auth page ready (${elapsed}s) — starting automation`);
      return true;
    } catch {
      // keep polling
    }
  }

  const elapsed = Math.floor((Date.now() - startedAt) / 1000);
  reportStep("zai_auth_form_timeout", `Z.ai auth page did not render login form after ${elapsed}s`);
  return false;
}

/**
 * Check whether the token monitor has already resolved (token extracted). Used
 * between steps so we can short-circuit the rest of the flow if the callback
 * landed early (e.g. user already logged in, or a previous tab kept tokens).
 *
 * Returns the resolved value or null if still pending.
 */
async function peekSuccessPromise(successPromise) {
  if (!successPromise) return null;
  return Promise.race([
    successPromise.then((v) => v).catch(() => null),
    new Promise((resolve) => setTimeout(() => resolve(null), 200)),
  ]);
}

/**
 * Run the AutoClaw web login flow with explicit step-by-step reporting and
 * proxy-friendly polling. Each phase waits for the DOM to settle before
 * advancing, and reports progress so the worker UI never looks frozen while
 * a slow proxy is still loading the page.
 *
 * Phases:
 *   1. opening_autoclaw_web      — goto autoclaw.z.ai/web/ + DOM ready
 *   2. clicking_autoclaw_login   — poll for login button, click when visible
 *   3. clicking_continue_with_zai— poll for "Continue with Zai", click when visible
 *   4. waiting_zai_popup         — wait for popup tab (or same-tab fallback)
 *   5. zai_popup_dom_loading     — wait for popup DOM to load
 *   6. waiting_zai_auth_form     — poll for Z.ai login form / Google button
 *   7. starting_google_login     — delegate to runGoogleAccountAutomation
 *   8. autoclaw_token_extracted  — token monitor resolved
 *
 * Tab handling:
 * - "Continue with Zai" opens a popup tab (chat.z.ai/auth)
 * - Google login happens entirely in the popup
 * - After redirect back, popup may close and main tab refreshes
 * - Token monitor polls ALL tabs to catch tokens regardless
 * - If no popup opens (same-tab redirect), fallback to running on main page
 */
export async function runAutoclawGoogleAutomation({
  page,
  email,
  password,
  deviceId: _deviceId, // unused — web app generates its own
  proxyUrl = null,
  callbackPromise,
  shortTimeoutMs = DEFAULT_SHORT_TIMEOUT_MS,
  onStep,
}) {
  const reportStep = (step, message) => onStep?.(step, message);

  // 0. Short-circuit if the token monitor already has tokens (rare, but
  //    handles the case where a prior tab survived into this worker).
  const earlySuccess = await peekSuccessPromise(callbackPromise);
  if (earlySuccess) {
    reportStep("autoclaw_token_extracted", "AutoClaw token already present — skipping automation");
    return { status: "success", ...earlySuccess };
  }

  // 1. Navigate to AutoClaw web app. Use "domcontentloaded" (not "load") because
  //    the SPA's "load" event waits for ALL resources (fonts, analytics, CDN
  //    images) which can take very long through a proxy. DOM-ready is enough to
  //    start polling for the login button.
  //
  //    Residential rotating proxies are intermittent — some IPs in the pool
  //    can't reach autoclaw.z.ai and return ERR_TIMED_OUT or
  //    ERR_SSL_PROTOCOL_ERROR. Retry up to 3 times to roll a different IP.
  const MAX_NAV_RETRIES = 3;
  const navWaitStrategies = ["domcontentloaded", "commit"];
  let navOk = false;
  let lastNavError = null;

  for (let attempt = 1; attempt <= MAX_NAV_RETRIES; attempt++) {
    for (const waitStrategy of navWaitStrategies) {
      reportStep("opening_autoclaw_web", `Opening AutoClaw web app (attempt ${attempt}/${MAX_NAV_RETRIES}, ${waitStrategy})`);
      try {
        await page.goto(AUTOCLAW_WEB_URL, { waitUntil: waitStrategy, timeout: NAV_TIMEOUT_MS });
        navOk = true;
        reportStep("opening_autoclaw_web", `AutoClaw web app loaded (attempt ${attempt}, ${waitStrategy})`);
        break;
      } catch (e) {
        lastNavError = e;
        const errMsg = (e.message || String(e)).slice(0, 120);
        // Common proxy errors: ERR_TIMED_OUT, ERR_SSL_PROTOCOL_ERROR,
        // ERR_CONNECTION_CLOSED, ERR_PROXY_CONNECTION_FAILED
        reportStep("opening_autoclaw_web", `${waitStrategy} failed (attempt ${attempt}): ${errMsg}`);
        // Brief pause before retry — gives the proxy pool time to rotate IP.
        await page.waitForTimeout(2000 + Math.floor(Math.random() * 2000));
      }
    }
    if (navOk) break;
  }

  if (!navOk) {
    // All retries exhausted. Still try to continue — the page may have
    // partially loaded and the polling loop can still find the button. If the
    // page is truly blank, polling will timeout and report a clear error.
    reportStep("opening_autoclaw_web", `All ${MAX_NAV_RETRIES} navigation attempts failed — continuing to poll anyway`);
  }

  if (navOk) {
    // Wait for SPA to render login button — poll instead of fixed delay.
    // The login button selectors are checked every 200ms; as soon as one is
    // visible, we advance. Max 10s fallback.
    reportStep("autoclaw_web_dom_loading", "AutoClaw web app DOM ready — waiting for SPA render");
    await waitForSelectorVisible(page, AUTOCLAW_LOGIN_BUTTON_SELECTORS, { timeoutMs: 10_000 });
  }

  // 2. Click login/register button to open login modal — poll until visible
  //    (proxy may take a while to render the SPA).
  reportStep("clicking_autoclaw_login", "Looking for AutoClaw login button");
  const loginClicked = await pollAndClickFirstVisible(page, AUTOCLAW_LOGIN_BUTTON_SELECTORS, {
    timeoutMs: LOGIN_BUTTON_TIMEOUT_MS,
    reportStep,
    stepId: "clicking_autoclaw_login",
    notFoundMessage: "Looking for AutoClaw login button",
  });
  if (!loginClicked) {
    return {
      status: "failed",
      error: "Could not find AutoClaw login button. The web UI may have changed.",
    };
  }
  // Wait for login modal to render "Continue with Zai" button — poll instead
  // of fixed 1.5s delay.
  await waitForSelectorVisible(page, AUTOCLAW_ZAI_BUTTON_SELECTORS, { timeoutMs: 8_000 });

  // 3. Click "Continue with Zai" — opens a new tab (popup). Poll until visible.
  reportStep("clicking_continue_with_zai", "Looking for Continue with Zai button");
  const zaiClicked = await pollAndClickFirstVisible(page, AUTOCLAW_ZAI_BUTTON_SELECTORS, {
    timeoutMs: ZAI_BUTTON_TIMEOUT_MS,
    reportStep,
    stepId: "clicking_continue_with_zai",
    notFoundMessage: "Looking for Continue with Zai button",
  });
  if (!zaiClicked) {
    return {
      status: "failed",
      error: "Could not find 'Continue with Zai' button on AutoClaw login modal.",
    };
  }

  // 3b. Check for captcha on the main page before waiting for popup.
  //     After clicking "Continue with Zai", Shumei captcha may appear as an
  //     overlay/modal on the same page, blocking the popup from opening.
  await page.waitForLoadState("networkidle").catch(() => null);
  const mainCaptcha = await page.waitForSelector(".shumei_captcha_wrapper", { state: "visible", timeout: 1_000 }).then(() => true).catch(() => false);
  if (mainCaptcha) {
    reportStep("detected_captcha_main", "Shumei captcha detected on main page after Zai click — solving");
    let solved = false;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      reportStep("solving_captcha_main", `Solving Shumei captcha attempt ${attempt}/3`);
      solved = await solveShumeiCaptcha(page, { timeout: 20_000 });
      if (solved) break;

      const stillVisible = await page.locator(".shumei_captcha_wrapper").first().isVisible({ timeout: 1_000 }).catch(() => false);
      if (!stillVisible) {
        solved = true;
        break;
      }
      reportStep("retrying_captcha_main", `Shumei captcha still visible after attempt ${attempt}/3 — waiting before retry`);
      await page.waitForTimeout(3_000);
    }

    if (solved) {
      reportStep("solved_captcha_main", "Shumei captcha solved on main page — continuing");
    } else {
      reportStep("failed_captcha_main", "Shumei captcha auto-solve failed after 3 attempts — manual assist required");
      return {
        status: "needs_manual",
        error: "Shumei captcha auto-solve failed after 3 attempts. Manual assist required in the browser session.",
      };
    }
  } else {
    reportStep("no_captcha_main", "No Shumei captcha on main page — proceeding to popup");
  }

  // 4. Wait for the Z.ai auth popup tab to open. Falls back to same-tab if
  //    no popup appears within the timeout (some proxy setups force same-tab
  //    redirects by blocking window.open).
  const context = page.context();
  const { popup, isPopup } = await waitForZaiPopup(context, page, POPUP_WAIT_TIMEOUT_MS, reportStep);

  // 5. Wait for the Z.ai auth form / Google button to render. This is the
  //    last AutoClaw-specific gate before delegating to the shared Google
  //    automation loop.
  const zaiReady = await waitForZaiAuthReady(popup, ZAI_FORM_TIMEOUT_MS, reportStep);
  if (!zaiReady) {
    // Close the popup if we opened one and could not use it.
    if (isPopup && popup !== page) {
      await popup.close().catch(() => null);
    }
    return {
      status: "failed",
      error: "Z.ai auth page did not render login form or Google button.",
    };
  }

  // 6. Run Google account automation on the popup (or main page).
  //    skipNavigation=true because we're already on the Z.ai auth page.
  //    handleProviderLoginGate clicks "Continue with Google" on Z.ai,
  //    then the loop handles Google email/password/consent/workspace-terms,
  //    and finally the Z.ai authorize page (checkbox + Continue).
  //    callbackPromise (token monitor) resolves when localStorage has tokens.
  const result = await runGoogleAccountAutomation({
    page: popup,
    skipNavigation: true,
    email,
    password,
    proxyUrl,
    successPromise: callbackPromise,
    shortTimeoutMs,
    serviceLabel: "AutoClaw",
    openingStep: "starting_google_login",
    openingMessage: "Starting Google login via Z.ai",
    successStep: "autoclaw_token_extracted",
    successMessage: "AutoClaw token extracted from localStorage",
    onStep,
  });

  // 7. Cleanup: close the popup tab if it was a separate tab.
  //    Main page (tab 0) stays open — context close handled by bulk import manager.
  if (isPopup && popup !== page) {
    await popup.close().catch(() => null);
  }

  return result;
}
