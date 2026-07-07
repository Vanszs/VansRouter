import { solveShumeiCaptcha } from "@/lib/oauth/utils/captchaSolver.js";

const DEFAULT_SHORT_TIMEOUT_MS = 90_000;
const DEFAULT_MANUAL_TIMEOUT_MS = 15 * 60_000;

/**
 * Smart wait after an action (click, submit). Instead of a fixed delay, poll
 * for either URL change (navigation) or target selector visible (next screen
 * rendered). Returns immediately when either condition is met. This replaces
 * the old `page.waitForTimeout(1500)` / `waitForTimeout(2000)` pattern that
 * added 1-2s of dead time even when the page had already rendered.
 *
 * Returns "url_changed" | "selector_visible" | "timeout".
 */
async function waitForNextStep(page, { baselineUrl = null, targetSelectors = [], timeoutMs = 8_000, pollIntervalMs = 200 } = {}) {
  const url = baselineUrl || (() => { try { return page.url(); } catch { return ""; } })();
  const deadline = Date.now() + timeoutMs;
  const sel = Array.isArray(targetSelectors) && targetSelectors.length > 0
    ? targetSelectors.join(", ")
    : null;

  while (Date.now() < deadline) {
    try {
      if (page.url() !== url) return "url_changed";
    } catch {}
    if (sel) {
      try {
        const visible = await page.locator(sel).first().isVisible({ timeout: pollIntervalMs }).catch(() => false);
        if (visible) return "selector_visible";
      } catch {}
    }
    await new Promise((r) => setTimeout(r, pollIntervalMs));
  }
  return "timeout";
}

// Comma-separated CSS selector. Includes Google's stable ID, mobile/legacy form
// names, and aria-label fallbacks for English + Indonesian. Multi-language
// aria-label support matters because Google renders the form in the user's
// browser locale (so "Email or phone" becomes "Email atau nomor telepon" for
// id-ID accounts and similar for other locales).
export const EMAIL_INPUT_SELECTOR = [
  'input[type="email"]',
  'input[autocomplete="username"]',
  'input#identifierId',
  'input[name="identifier"]',
  'input[name="Email"]',
  'input[type="text"][autofocus]',
  'input[aria-label*="Email" i]',
  'input[aria-label*="email" i]',
  'input[aria-label*="phone" i]',
  'input[aria-label*="telepon" i]',
].join(", ");

export const PASSWORD_INPUT_SELECTOR = [
  'input[type="password"]',
  'input[name="Passwd"]',
  'input[name="password"]',
  'input[aria-label*="Password" i]',
  'input[aria-label*="password" i]',
  'input[aria-label*="Sandi" i]',
  'input[aria-label*="kata sandi" i]',
].join(", ");

const NEXT_BUTTON_SELECTORS = [
  'button:has-text("Next")',
  'button:has-text("Berikutnya")',
  'button:has-text("Continue")',
  'div[role="button"]:has-text("Next")',
  'div[role="button"]:has-text("Berikutnya")',
  '#identifierNext button',
  '#passwordNext button',
  'button:has-text("下一步")',
  'button:has-text("继续")',
  'div[role="button"]:has-text("下一步")',
  'div[role="button"]:has-text("继续")',
];

const APPROVE_BUTTON_SELECTORS = [
  '#submit_approve_access',
  '#submit_approve_access button',
  '#confirm',
  'form#tos_form input[type="submit"]',
  'button[jsname]:has-text("Allow")',
  'button:has-text("Allow")',
  '[role="button"]:has-text("Allow")',
  'input[type="submit"][value="Allow"]',
  'input[type="button"][value="Allow"]',
  'button[jsname]:has-text("Izinkan")',
  'button:has-text("Izinkan")',
  '[role="button"]:has-text("Izinkan")',
  'button:has-text("Continue")',
  'button:has-text("Next")',
  'button:has-text("Yes")',
  'button:has-text("Accept")',
  'button:has-text("Lanjutkan")',
  'button:has-text("Berikutnya")',
  'button:has-text("Setuju")',
  'button:has-text("Saya mengerti")',
  'button:has-text("Oke")',
  'button:has-text("OK")',
  'button:has-text("Got it")',
  'button:has-text("I understand")',
  'div[role="button"]:has-text("Continue")',
  'div[role="button"]:has-text("Next")',
  'div[role="button"]:has-text("Allow")',
  'div[role="button"]:has-text("Lanjutkan")',
  'div[role="button"]:has-text("Berikutnya")',
  'div[role="button"]:has-text("Izinkan")',
  'div[role="button"]:has-text("Setuju")',
  'div[role="button"]:has-text("Saya mengerti")',
  'div[role="button"]:has-text("Oke")',
  'div[role="button"]:has-text("OK")',
  'div[role="button"]:has-text("Got it")',
  'div[role="button"]:has-text("I understand")',
  'input[type="button"][value="Saya mengerti"]',
  'input[type="submit"][value="Saya mengerti"]',
  'button:has-text("允许")',
  'button:has-text("继续")',
  'button:has-text("下一步")',
  'button:has-text("是")',
  'button:has-text("接受")',
  'button:has-text("同意")',
  'button:has-text("我了解")',
  'button:has-text("我明白")',
  'button:has-text("好的")',
  'button:has-text("明白了")',
  '[role="button"]:has-text("允许")',
  '[role="button"]:has-text("继续")',
  '[role="button"]:has-text("下一步")',
  '[role="button"]:has-text("同意")',
  '[role="button"]:has-text("我了解")',
  '[role="button"]:has-text("好的")',
  'input[type="submit"][value="同意"]',
  'input[type="submit"][value="我了解"]',
];

const SKIP_BUTTON_SELECTORS = [
  'button:has-text("Skip")',
  'button:has-text("Lewati")',
  'button:has-text("Not now")',
  'button:has-text("Bukan sekarang")',
  'button:has-text("No thanks")',
  'button:has-text("Tidak sekarang")',
  'div[role="button"]:has-text("Skip")',
  'div[role="button"]:has-text("Not now")',
  'button:has-text("跳过")',
  'button:has-text("暂不")',
  'button:has-text("以后再说")',
  'button:has-text("不，谢谢")',
  'button:has-text("现在不用")',
  'div[role="button"]:has-text("跳过")',
  'div[role="button"]:has-text("暂不")',
];

const GOOGLE_LOGIN_BUTTON_SELECTORS = [
  '#social-google',
  'a#social-google',
  'button.ButtonContinueWithGoogle',
  'button[class*="ContinueWithGoogle"]',
  'a:has-text("Sign up with Google")',
  'a:has-text("Log in with Google")',
  'button:has-text("Sign up with Google")',
  'button:has-text("Log in with Google")',
  'button:has-text("Continue with Google")',
  'a:has-text("Continue with Google")',
  '[role="button"]:has-text("Continue with Google")',
  'button:has-text("Sign in with Google")',
  'a:has-text("Sign in with Google")',
  '[role="button"]:has-text("Sign in with Google")',
  'button:has-text("Google")',
  'a:has-text("Google")',
  'div[role="button"]:has-text("Google")',
  'div:has-text("Continue with Google")',
  'div:has-text("Sign in with Google")',
  'span:has-text("Google")',
  '[aria-label*="Google"]',
  '[data-provider*="google" i]',
];

const TERMS_CHECKBOX_SELECTORS = [
  '#agree-policy-account',
  '#agree-policy',
  '#agree-policy-sso',
  'input[type="checkbox"][id*="agree" i]',
  'input[type="checkbox"][name*="agree" i]',
  'input[type="checkbox"][id*="policy" i]',
  'input[type="checkbox"][name*="policy" i]',
  'input[type="checkbox"][id*="terms" i]',
  'input[type="checkbox"][name*="terms" i]',
  '.login-checkbox input[type="checkbox"]',
  '[class*="checkbox"] input[type="checkbox"]',
  '[class*="agree"] input[type="checkbox"]',
  'input[type="checkbox"]',
];

const PRIVACY_CONFIRM_BUTTON_SELECTORS = [
  '.ui-dialog button:has-text("Confirm")',
  'dialog button:has-text("Confirm")',
  'button:has-text("Confirm")',
  'button:has-text("I agree")',
  'button:has-text("Agree")',
  'button:has-text("同意")',
  'button:has-text("确认")',
];

const PROVIDER_ONBOARDING_ACTION_SELECTORS = [
  'button:has-text("Continue")',
  '[role="button"]:has-text("Continue")',
  'button:has-text("Get started")',
  'button:has-text("GET STARTED")',
  'input[type="submit"][value="GET STARTED"]',
  'button:has-text("Start")',
  'button:has-text("Confirm")',
  'button:has-text("Done")',
  'button:has-text("Next")',
  'button:has-text("Skip")',
  'button:has-text("Not now")',
  'button:has-text("Save")',
  'button:has-text("Create")',
  'button:has-text("Enter")',
  'button:has-text("Launch")',
  'button:has-text("Use CodeBuddy")',
  'button:has-text("Go to CodeBuddy")',
  'button:has-text("继续")',
  'button:has-text("下一步")',
  'button:has-text("确认")',
  'button:has-text("同意")',
  'button:has-text("开始")',
  'button:has-text("完成")',
  'button:has-text("跳过")',
  'button:has-text("暂不")',
  'button:has-text("保存")',
  'button:has-text("创建")',
  '[role="button"]:has-text("继续")',
  '[role="button"]:has-text("确认")',
  '[role="button"]:has-text("同意")',
];

const PROVIDER_REGION_TRIGGER_SELECTORS = [
  'select',
  '[role="combobox"]',
  '.page-region [role="combobox"]',
  '.page-region .t-select',
  '.page-region [class*="t-select"]',
  '.page-region [class*="select"]',
  '.page-region input[placeholder]',
  'button:has-text("Region")',
  '[role="button"]:has-text("Region")',
  'button:has-text("Select region")',
  '[role="button"]:has-text("Select region")',
  'button:has-text("Data region")',
  '[aria-label*="region" i]',
  '[placeholder*="region" i]',
];

const PROVIDER_REGION_OPTION_SELECTORS = [
  'text=/^Indonesia$/i',
  'text=/^ID$/i',
  'text=/^Singapore$/i',
  'text=/^SG$/i',
  'text=/^Japan$/i',
  'text=/^JP$/i',
  'text=/^Thailand$/i',
  'text=/^TH$/i',
  'text=/^Global$/i',
  'text=/^International$/i',
  'text=/^United States$/i',
  'text=/^US$/i',
  'text=/^Asia Pacific$/i',
  'text=/^Hong Kong$/i',
  'text=/^Default$/i',
];

const PROVIDER_ONBOARDING_INPUT_DEFAULTS = [
  { selector: 'input[name*="workspace" i]', value: "Default" },
  { selector: 'input[placeholder*="workspace" i]', value: "Default" },
  { selector: 'input[name*="team" i]', value: "Default" },
  { selector: 'input[placeholder*="team" i]', value: "Default" },
  { selector: 'input[name*="name" i]', value: "Default" },
  { selector: 'input[placeholder*="name" i]', value: "Default" },
];

const INVALID_CREDENTIAL_MARKERS = [
  "wrong password",
  "incorrect password",
  "couldn't find your google account",
  "couldn’t find your google account",
  "enter a valid email",
  "couldn’t sign you in",
  "couldn't sign you in",
  "invalid email or password",
  "password is incorrect",
  "密码错误",
  "密码不正确",
  "找不到该 google 帐号",
  "找不到该 google 账号",
  "无法登录",
  "无法为您登录",
  "请输入有效的电子邮件",
  "电子邮件或密码无效",
];

const MANUAL_ASSIST_MARKERS = [
  "2-step verification",
  "2-step verification required",
  "verify it’s you",
  "verify it's you",
  "check your phone",
  "confirm it’s you",
  "confirm it's you",
  "recovery email",
  "recovery phone",
  "suspicious sign-in prevented",
  "unusual activity detected",
  "captcha",
  "try again later",
  "两步验证",
  "双重验证",
  "验证您的身份",
  "确认是您本人",
  "检查您的手机",
  "恢复邮箱",
  "恢复电话",
  "已阻止可疑的登录",
  "检测到异常活动",
  "验证码",
  "请稍后重试",
];

const RESTRICTED_ACCOUNT_MARKERS = [
  "restricted",
  "account has been restricted",
  "account is restricted",
  "account has been suspended",
  "account is suspended",
  "account has been disabled",
  "account is disabled",
  "account has been banned",
  "account is banned",
  "access denied",
  "account blocked",
  "your account has been",
  "violation of terms",
  "terms of service violation",
  "temporarily locked",
  "permanently locked",
  "account locked",
  "akun dibatasi",
  "akun diblokir",
  "akun ditangguhkan",
  "帐号已受限",
  "账号已受限",
  "帐号已被暂停",
  "账号已被暂停",
  "帐号已被停用",
  "账号已被停用",
  "帐号已被禁用",
  "账号已被禁用",
  "帐号已被封禁",
  "账号已被封禁",
  "访问被拒绝",
  "帐号已被锁定",
  "账号已被锁定",
];

// AutoClaw / Z.ai sign-in failure markers. When the OAuth redirect lands back
// on autoclaw.z.ai but the page shows a sign-in error (usually IP rate limit
// or Google rejected the session), we should retry with a fresh proxy IP.
const SIGNIN_FAILED_MARKERS = [
  "sign-in failed",
  "signin failed",
  "sign in failed",
  "login failed",
  "登录失败",
  "登陆失败",
  "认证失败",
  "授权失败",
  "oauth failed",
  "authentication failed",
  "too many requests",
  "rate limit",
  "rate limited",
  "请求过于频繁",
  "频率过高",
  "请稍后重试",
  "try again later",
  "retry",
];

const GOOGLE_ONBOARDING_MARKERS = [
  "welcome to your new google account",
  "selamat datang di akun google baru anda",
  "welcome to your new account",
  "selamat datang di akun baru",
  "privacy and terms",
  "privasi dan persyaratan",
  "personalize your google services",
  "personalisasikan layanan google anda",
  "add recovery phone",
  "tambahkan nomor telepon pemulihan",
  "choose your settings",
  "pilih setelan anda",
  "欢迎使用您的新 google 帐号",
  "欢迎使用您的新 google 账号",
  "欢迎使用您的新帐号",
  "欢迎使用您的新账号",
  "隐私权和条款",
  "个性化您的 google 服务",
  "添加恢复电话",
  "选择您的设置",
];

const GOOGLE_WORKSPACE_WELCOME_MARKERS = [
  "welcome to your new account",
  "selamat datang di akun baru",
  "your administrator decides which",
  "administrator anda memutuskan layanan",
  "your organisation administrator manages",
  "your organization administrator manages",
  "欢迎使用您的新帐号",
  "欢迎使用您的新账号",
  "您的管理员决定",
  "您的组织管理员管理",
];

const GOOGLE_REVERIFY_MARKERS = [
  "verify it's you",
  "verify it’s you",
  "confirm it's you",
  "confirm it’s you",
  "continue to sign in",
  "sign in to continue",
  "choose an account to continue",
  "re-enter your password",
  "use another account",
  "验证您的身份",
  "确认是您本人",
  "继续登录",
  "选择一个帐号以继续",
  "使用其他帐号",
];

const KIRO_CALLBACK_PREFIX = "kiro://kiro.kiroAgent/authenticate-success";

function parseCallbackUrl(rawUrl) {
  if (!rawUrl || !rawUrl.startsWith(KIRO_CALLBACK_PREFIX)) return null;

  const queryIndex = rawUrl.indexOf("?");
  const params = new URLSearchParams(queryIndex >= 0 ? rawUrl.slice(queryIndex + 1) : "");
  const code = params.get("code");
  const state = params.get("state");

  if (!code) return null;

  return {
    callbackUrl: rawUrl,
    code,
    state,
  };
}

function getInteractionScopes(page) {
  const frames = typeof page.frames === "function" ? page.frames() : [];
  return [page, ...frames.filter((frame) => frame !== page.mainFrame?.())];
}

async function clickFirstVisible(page, selectors) {
  for (const scope of getInteractionScopes(page)) {
    for (const selector of selectors) {
      const locator = scope.locator(selector).first();
      const count = await locator.count().catch(() => 0);
      if (!count) continue;

      const visible = await locator.isVisible().catch(() => false);
      if (!visible) continue;

      const clicked = await locator.click({ timeout: 5_000 }).then(() => true).catch(() => false);
      if (clicked) return true;
    }
  }

  return false;
}

async function clickFirstActionable(page, selectors) {
  for (const scope of getInteractionScopes(page)) {
    for (const selector of selectors) {
      const locator = scope.locator(selector).first();
      const count = await locator.count().catch(() => 0);
      if (!count) continue;

      await locator.scrollIntoViewIfNeeded().catch(() => null);

      const visible = await locator.isVisible().catch(() => false);
      if (!visible) continue;

      const enabled = await locator.isEnabled().catch(() => true);
      if (!enabled) continue;

      const clicked = await locator.click({ timeout: 5_000 }).then(() => true).catch(() => false);
      if (clicked) return true;
    }
  }

  return false;
}

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

async function clickCodeBuddyGoogleSocialLogin(page) {
  if (!isProviderPage(page) || isGoogleAuthPage(page)) return false;

  const startedAt = Date.now();
  while (Date.now() - startedAt < 15_000) {
    for (const scope of getInteractionScopes(page)) {
      const href = await scope.evaluate(() => {
        const direct = document.querySelector("a#social-google, #social-google, a[href*='broker/google'], a[href*='google/login']");
        const directHref = direct?.closest?.("a")?.href || direct?.href;
        if (directHref) return directHref;

        const candidates = [...document.querySelectorAll("a, button, [role='button'], div, span")];
        for (const candidate of candidates) {
          const text = candidate.textContent || candidate.getAttribute("aria-label") || "";
          const href = candidate.closest?.("a")?.href || candidate.href || "";
          if (/google/i.test(text) || /broker\/google|google\/login/i.test(href)) {
            return href || null;
          }
        }
        return null;
      }).catch(() => null);

      if (href) {
        await page.goto(href, { waitUntil: "domcontentloaded", timeout: 60_000 });
        await page.waitForTimeout(1000);
        return true;
      }

      const clicked = await clickFirstActionable(scope, GOOGLE_LOGIN_BUTTON_SELECTORS).catch(() => false);
      if (clicked) {
        await page.waitForLoadState("domcontentloaded", { timeout: 10_000 }).catch(() => null);
        await page.waitForTimeout(1000);
        return true;
      }
    }

    await page.waitForTimeout(500);
  }

  return false;
}

async function waitForProviderLoginReady(page, timeoutMs = 30_000) {
  if (!isProviderPage(page) || isGoogleAuthPage(page)) return false;

  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    for (const scope of getInteractionScopes(page)) {
      const ready = await scope.evaluate(() => {
        if (!["interactive", "complete"].includes(document.readyState)) return false;

        const candidates = [
          ...document.querySelectorAll("a#social-google, #social-google, a[href*='broker/google'], a[href*='google/login']"),
          ...document.querySelectorAll("input[type='checkbox'][id*='agree' i], input[type='checkbox'][id*='policy' i], input[type='checkbox'][name*='agree' i], input[type='checkbox'][name*='terms' i]"),
        ];

        return candidates.some((element) => {
          const box = element.getBoundingClientRect();
          const style = window.getComputedStyle(element);
          return box.width > 0
            && box.height > 0
            && style.visibility !== "hidden"
            && style.display !== "none";
        });
      }).catch(() => false);
      if (ready) return true;
    }

    await page.waitForTimeout(500);
  }

  return false;
}

async function waitForGoogleAuthPage(page, timeoutMs = 20_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (isGoogleAuthPage(page)) return true;
    const emailInput = await getFirstVisibleLocator(page, EMAIL_INPUT_SELECTOR).catch(() => null);
    if (emailInput) return true;
    await page.waitForTimeout(500);
  }
  return false;
}

async function waitForCodeBuddyGoogleButton(page, timeoutMs = 15_000) {
  if (!isProviderPage(page) || isGoogleAuthPage(page)) return false;

  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    for (const scope of getInteractionScopes(page)) {
      const ready = await scope.evaluate(() => {
        const element = document.querySelector("a#social-google, #social-google, a[href*='broker/google'], a[href*='google/login']");
        if (!element) return false;
        const box = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return box.width > 0
          && box.height > 0
          && style.visibility !== "hidden"
          && style.display !== "none";
      }).catch(() => false);
      if (ready) return true;
    }

    await page.waitForTimeout(500);
  }

  return false;
}

async function waitForGoogleButtonOrZaiAuthorize(page, timeoutMs = 15_000) {
  if (!isProviderPage(page) || isGoogleAuthPage(page)) return false;

  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    for (const scope of getInteractionScopes(page)) {
      const ready = await scope.evaluate(() => {
        const visible = (element) => {
          if (!(element instanceof HTMLElement)) return false;
          const box = element.getBoundingClientRect();
          const style = window.getComputedStyle(element);
          return box.width > 0
            && box.height > 0
            && style.visibility !== "hidden"
            && style.display !== "none"
            && Number(style.opacity) !== 0;
        };

        const googleButton = document.querySelector("a#social-google, #social-google, a[href*='broker/google'], a[href*='google/login']");
        if (visible(googleButton)) return true;

        const text = document.body?.innerText || "";
        if (!/would like to access your.*account|wants to access your.*account|AutoGLM|autoglm/i.test(text)) return false;

        const checkbox = document.querySelector("input[type='checkbox'][id*='agree' i], input[type='checkbox'][id*='policy' i], input[type='checkbox'][name*='agree' i], input[type='checkbox'][name*='terms' i], input[type='checkbox']");
        const continueButton = [...document.querySelectorAll("button, [role='button'], input[type='button'], input[type='submit']")]
          .find((element) => /continue/i.test(element.innerText || element.value || "") && visible(element));
        return visible(checkbox) || Boolean(continueButton);
      }).catch(() => false);
      if (ready) return true;
    }

    await page.waitForTimeout(200);
  }

  return false;
}

async function checkFirstVisible(page, selectors) {
  for (const scope of getInteractionScopes(page)) {
    for (const selector of selectors) {
      const locator = scope.locator(selector).first();
      const count = await locator.count().catch(() => 0);
      if (!count) continue;

      const checked = await locator.isChecked().catch(() => false);
      if (checked) return true;

      const didCheck = await locator.check({ force: true, timeout: 5_000 }).then(() => true).catch(() => false);
      if (didCheck) {
        const verified = await locator.isChecked().catch(() => false);
        if (verified) return true;
      }

      const clicked = await locator.click({ force: true, timeout: 5_000 }).then(() => true).catch(() => false);
      if (clicked) {
        await scope.waitForTimeout(200).catch(() => null);
        const verified = await locator.isChecked().catch(() => false);
        if (verified) return true;
      }

      const labelClicked = await scope.evaluate((sel) => {
        const el = document.querySelector(sel);
        if (!el) return false;
        const label = el.closest("label") || el.querySelector("label");
        if (label instanceof HTMLElement) { label.click(); return true; }
        return false;
      }, selector).catch(() => false);
      if (labelClicked) {
        await scope.waitForTimeout(200).catch(() => null);
        const verified = await locator.isChecked().catch(() => false);
        if (verified) return true;
      }

      const domChecked = await scope.evaluate((candidateSelector) => {
        const input = document.querySelector(candidateSelector);
        if (!(input instanceof HTMLInputElement)) return false;
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "checked")?.set;
        if (setter) setter.call(input, true);
        else input.checked = true;
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
        input.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        return input.checked;
      }, selector).catch(() => false);
      if (domChecked) return true;
    }
  }

  return false;
}

async function checkFirstUnchecked(page, selectors) {
  for (const scope of getInteractionScopes(page)) {
    for (const selector of selectors) {
      const locator = scope.locator(selector).first();
      const count = await locator.count().catch(() => 0);
      if (!count) continue;

      const checked = await locator.isChecked().catch(() => false);
      if (checked) continue;

      const didCheck = await locator.check({ force: true, timeout: 5_000 }).then(() => true).catch(() => false);
      if (didCheck) return true;

      const domChecked = await scope.evaluate((candidateSelector) => {
        const input = document.querySelector(candidateSelector);
        if (!(input instanceof HTMLInputElement)) return false;
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "checked")?.set;
        if (setter) setter.call(input, true);
        else input.checked = true;
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
        return input.checked;
      }, selector).catch(() => false);
      if (domChecked) return true;
    }
  }

  return false;
}

async function getFirstVisibleLocator(page, selector) {
  for (const scope of getInteractionScopes(page)) {
    const locator = scope.locator(selector).first();
    const count = await locator.count().catch(() => 0);
    if (!count) continue;

    const visible = await locator.isVisible().catch(() => false);
    if (!visible) continue;

    return locator;
  }

  return null;
}

async function waitForFirstVisibleLocator(page, selector, { timeout = 15_000, pollInterval = 500 } = {}) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const found = await getFirstVisibleLocator(page, selector);
    if (found) return found;
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    await new Promise((r) => setTimeout(r, Math.min(pollInterval, remaining)));
  }
  return null;
}

async function humanType(locator, value, { timeout = 15_000 } = {}) {
  if (!locator || value == null) return false;
  const text = String(value);

  try {
    await locator.click({ timeout: 5_000 });
    await new Promise((resolve) => setTimeout(resolve, 200 + Math.floor(Math.random() * 400)));
  } catch {
    /* noop */
  }

  try {
    await locator.press("Control+a");
    await new Promise((resolve) => setTimeout(resolve, 50 + Math.floor(Math.random() * 100)));
    await locator.press("Delete");
    await new Promise((resolve) => setTimeout(resolve, 150 + Math.floor(Math.random() * 300)));
  } catch {
    try { await locator.fill(""); } catch {}
  }

  for (let i = 0; i < text.length; i++) {
    await locator.press(text[i], { timeout });
    const baseDelay = 50 + Math.floor(Math.random() * 130);
    const longPause = Math.random() < 0.06 ? 300 + Math.floor(Math.random() * 500) : 0;
    await new Promise((resolve) => setTimeout(resolve, baseDelay + longPause));
  }

  let observed = "";
  try {
    observed = await locator.inputValue();
  } catch {
    observed = "";
  }
  return observed === text;
}

async function fillInputResilient(locator, value, { timeout = 15_000 } = {}) {
  if (!locator || value == null) return false;

  const filled = await humanType(locator, value, { timeout });
  if (filled) return true;

  let observed = "";
  try {
    observed = await locator.inputValue();
  } catch {
    observed = "";
  }
  if (observed === value) return true;

  try {
    await locator.click({ timeout: 5_000 });
  } catch {
    /* noop */
  }
  try {
    await locator.fill("");
  } catch {
    /* noop */
  }
  try {
    await locator.type(value, { delay: 50, timeout });
  } catch {
    return false;
  }

  try {
    observed = await locator.inputValue();
  } catch {
    observed = "";
  }
  return observed === value;
}

function parseSelectorList(selector) {
  return String(selector || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

async function readPageText(page) {
  const chunks = [];
  for (const scope of getInteractionScopes(page)) {
    try {
      chunks.push(await scope.evaluate(() => document.body?.innerText || ""));
    } catch {
      // Cross-origin frames can be unreadable; ignore them.
    }
  }
  return chunks.join("\n");
}

function includesAny(text, markers) {
  const normalized = String(text || "").toLowerCase();
  return markers.some((marker) => normalized.includes(marker));
}

function isGoogleAuthPage(page) {
  try {
    const url = new URL(page.url());
    return url.hostname === "accounts.google.com" || url.hostname.endsWith(".accounts.google.com");
  } catch {
    return false;
  }
}

function isProviderPage(page) {
  try {
    const url = new URL(page.url());
    return /codebuddy\.(ai|cn)$/.test(url.hostname)
      || url.hostname.endsWith(".codebuddy.ai")
      || url.hostname.endsWith(".codebuddy.cn")
      || url.hostname === "chat.z.ai";
  } catch {
    return false;
  }
}

async function handleGoogleConsent(page, reportStep) {
  if (!isGoogleAuthPage(page)) return false;

  const text = await readPageText(page);
  const looksLikeConsent = /wants to access|ingin mengakses|akses ke akun google|allow|想要访问|授权访问|允许/i.test(text);
  if (!looksLikeConsent) return false;

  await page.evaluate(() => {
    const root = document.scrollingElement || document.documentElement || document.body;
    if (root) root.scrollTop = root.scrollHeight;
    window.scrollTo(0, document.body?.scrollHeight || document.documentElement?.scrollHeight || 0);
  }).catch(() => null);
  await page.waitForTimeout(150);

  const clickedApprove = await clickFirstActionable(page, APPROVE_BUTTON_SELECTORS);
  if (clickedApprove) {
    reportStep("approving_google_consent", "Approving Google OAuth consent");
    // Wait for URL change after consent — poll instead of 1s fixed.
    await waitForNextStep(page, {
      baselineUrl: (() => { try { return page.url(); } catch { return ""; } })(),
      timeoutMs: 5_000,
    });
    return true;
  }

  return false;
}

async function handleGoogleReVerify(page, reportStep) {
  if (!isGoogleAuthPage(page)) return false;

  // If password input is already visible this is the normal post-email
  // password page, not a re-verify challenge — let the password handler run.
  const passwordVisible = await getFirstVisibleLocator(page, PASSWORD_INPUT_SELECTOR).catch(() => null);
  if (passwordVisible) return false;

  const text = await readPageText(page);
  if (!includesAny(text, GOOGLE_REVERIFY_MARKERS)) return false;

  // Wait for DOM settle — button may still be loading
  await page.waitForTimeout(500);

  const clicked = await clickFirstActionable(page, [
    'button:has-text("Continue")',
    'button:has-text("Next")',
    'div[role="button"]:has-text("Continue")',
    'div[role="button"]:has-text("Next")',
    'button:has-text("Confirm")',
    'button:has-text("Yes")',
    'button:has-text("I understand")',
    'button:has-text("Got it")',
  ]);
  if (clicked) {
    reportStep("google_reverify", "Clicked continue on Google re-verify page");
    await waitForNextStep(page, {
      baselineUrl: (() => { try { return page.url(); } catch { return ""; } })(),
      timeoutMs: 10_000,
    });
    return true;
  }

  return false;
}

async function handleGoogleOnboarding(page, pageText) {
  const text = String(pageText || "");
  if (!includesAny(text, GOOGLE_ONBOARDING_MARKERS)) {
    return false;
  }

  await page.evaluate(() => {
    const root = document.scrollingElement || document.documentElement || document.body;
    if (root) root.scrollTop = root.scrollHeight;
    window.scrollTo(0, document.body?.scrollHeight || document.documentElement?.scrollHeight || 0);
  }).catch(() => null);
  await page.waitForTimeout(500);

  // Workspace welcome ("Welcome to your new account" for @domain.com) has
  // only one valid action: the primary "I understand" button. There is no
  // skip option — clicking nothing leaves the worker stuck polling forever
  // while the headless tab sits on the consent screen. Prioritise the
  // primary action selector before the generic skip pass so we don't fall
  // through to a non-existent "Not now" link.
  if (includesAny(text, GOOGLE_WORKSPACE_WELCOME_MARKERS)) {
    const acknowledged = await clickFirstActionable(page, APPROVE_BUTTON_SELECTORS);
    if (acknowledged) {
      await page.waitForTimeout(700);
      return true;
    }
    const submittedFromDom = await page.evaluate(() => {
      const candidates = [
        document.getElementById("confirm"),
        document.querySelector('form#tos_form input[type="submit"]'),
        document.querySelector('input[type="submit"][value="Saya mengerti"]'),
        document.querySelector('input[type="submit"][value="I understand"]'),
      ].filter(Boolean);
      const btn = candidates[0];
      if (!btn) return false;
      btn.scrollIntoView({ block: "center" });
      btn.click();
      return true;
    }).catch(() => false);
    if (submittedFromDom) {
      await page.waitForTimeout(800);
      return true;
    }
    const formSubmitted = await page.evaluate(() => {
      const form = document.getElementById("tos_form");
      if (!form) return false;
      form.submit();
      return true;
    }).catch(() => false);
    if (formSubmitted) {
      await page.waitForTimeout(800);
      return true;
    }
  }

  const clickedSkip = await clickFirstActionable(page, SKIP_BUTTON_SELECTORS);
  if (clickedSkip) {
    await page.waitForTimeout(700);
    return true;
  }

  const clickedContinue = await clickFirstActionable(page, APPROVE_BUTTON_SELECTORS);
  if (clickedContinue) {
    await page.waitForTimeout(700);
    return true;
  }

  return false;
}

async function selectNativeRegionOption(page) {
  const preferred = /global|international|singapore|united states|^us$|asia|hong kong|default/i;

  for (const scope of getInteractionScopes(page)) {
    const selects = scope.locator("select");
    const count = await selects.count().catch(() => 0);
    for (let index = 0; index < count; index += 1) {
      const select = selects.nth(index);
      const visible = await select.isVisible().catch(() => false);
      const enabled = await select.isEnabled().catch(() => true);
      if (!visible || !enabled) continue;

      const value = await select.evaluate((element, patternSource) => {
        const matcher = new RegExp(patternSource, "i");
        const options = [...element.options].filter((option) => !option.disabled && option.value !== "");
        const preferredOption = options.find((option) => matcher.test(`${option.label} ${option.textContent} ${option.value}`));
        return (preferredOption || options[0])?.value || "";
      }, preferred.source).catch(() => "");

      if (!value) continue;
      const selected = await select.selectOption(value).then(() => true).catch(() => false);
      if (selected) return true;
    }
  }

  return false;
}

async function fillProviderOnboardingDefaults(page) {
  let filled = false;

  for (const scope of getInteractionScopes(page)) {
    for (const { selector, value } of PROVIDER_ONBOARDING_INPUT_DEFAULTS) {
      const locator = scope.locator(selector).first();
      const count = await locator.count().catch(() => 0);
      if (!count) continue;

      const visible = await locator.isVisible().catch(() => false);
      const enabled = await locator.isEnabled().catch(() => true);
      if (!visible || !enabled) continue;

      const currentValue = await locator.inputValue().catch(() => "");
      if (currentValue) continue;

      const didFill = await humanType(locator, value, { timeout: 5_000 }).catch(() => false);
      if (didFill) filled = true;
    }
  }

  return filled;
}

async function clickLocatorCenter(page, locator) {
  await locator.scrollIntoViewIfNeeded().catch(() => null);
  const visible = await locator.isVisible().catch(() => false);
  const enabled = await locator.isEnabled().catch(() => true);
  if (!visible || !enabled) return false;

  const box = await locator.boundingBox().catch(() => null);
  if (!box || box.width <= 0 || box.height <= 0) return false;

  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.up();
  return true;
}

async function clickVisibleLocatorByText(page, selector, patterns) {
  for (const scope of getInteractionScopes(page)) {
    const locators = scope.locator(selector);
    const count = Math.min(await locators.count().catch(() => 0), 80);
    const candidates = [];

    for (let index = 0; index < count; index += 1) {
      const locator = locators.nth(index);
      const visible = await locator.isVisible().catch(() => false);
      if (!visible) continue;

      const text = (await locator.innerText({ timeout: 1_000 }).catch(() => "")
        || await locator.textContent({ timeout: 1_000 }).catch(() => "")
        || "").trim();
      if (!text) continue;
      candidates.push({ locator, text });
    }

    for (const pattern of patterns) {
      const candidate = candidates.find((item) => pattern.test(item.text));
      if (!candidate) continue;
      const clicked = await clickLocatorCenter(page, candidate.locator).catch(() => false);
      if (clicked) return candidate.text;
    }

    if (candidates[0]) {
      const clicked = await clickLocatorCenter(page, candidates[0].locator).catch(() => false);
      if (clicked) return candidates[0].text;
    }
  }

  return "";
}

async function clickFirstVisibleLocatorCenter(page, selectors) {
  for (const scope of getInteractionScopes(page)) {
    for (const selector of selectors) {
      const locators = scope.locator(selector);
      const count = Math.min(await locators.count().catch(() => 0), 20);
      for (let index = 0; index < count; index += 1) {
        const locator = locators.nth(index);
        const clicked = await clickLocatorCenter(page, locator).catch(() => false);
        if (clicked) return true;
      }
    }
  }

  return false;
}

async function handleCodeBuddyRegionPageViaApi(page, reportStep) {
  if (!isProviderPage(page) || isGoogleAuthPage(page)) return false;

  const result = await page.evaluate(async () => {
    const bodyText = document.body?.innerText || "";
    const looksLikeRegionPage = document.querySelector(".page-region")
      || /select\s+region|region|country|area|get started|complete/i.test(bodyText);
    if (!looksLikeRegionPage) return null;

    try {
      const response = await fetch("https://www.codebuddy.ai/console/login/account", {
        method: "POST",
        credentials: "include",
        headers: {
          accept: "application/json, text/plain, */*",
          "content-type": "application/json",
          "x-requested-with": "XMLHttpRequest",
          "x-domain": window.location.hostname || "www.codebuddy.ai",
        },
        referrer: "https://www.codebuddy.ai/register/user/complete",
        body: JSON.stringify({
          attributes: {
            countryCode: ["62"],
            countryFullName: ["Indonesia"],
            countryName: ["ID"],
          },
        }),
      });

      const text = await response.text().catch(() => "");
      let data = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        data = { raw: text };
      }

      if (response.ok && (!data || data.code === 0 || data.code === 200 || typeof data.code === "undefined")) {
        return { action: "submitted_via_api" };
      }

      return {
        action: "api_failed",
        status: response.status,
        code: data?.code,
        message: data?.msg || data?.message || text || `HTTP ${response.status}`,
      };
    } catch (error) {
      return {
        action: "api_failed",
        message: error?.message || "region submit request failed",
      };
    }
  }).catch(() => null);

  if (!result?.action) return false;

  if (result.action === "submitted_via_api") {
    reportStep("submitting_codebuddy_region", "Submitted CodeBuddy region via account API");
    await page.waitForTimeout(1500);
    return true;
  }

  reportStep(
    "codebuddy_region_api_failed",
    result.message
      ? `CodeBuddy region API submit failed: ${result.message}`
      : "CodeBuddy region API submit failed"
  );
  return false;
}

async function handleCodeBuddyRegionPageWithMouse(page, reportStep) {
  if (!isProviderPage(page) || isGoogleAuthPage(page)) return false;

  const isRegionPage = await page.locator(".page-region").first().count().then(Boolean).catch(() => false);
  if (!isRegionPage) return false;

  const optionPatterns = [
    /indonesia|^id$|\u5370\u5ea6\u5c3c\u897f\u4e9a/i,
    /singapore|^sg$|\u65b0\u52a0\u5761/i,
    /japan|^jp$|\u65e5\u672c/i,
    /thailand|^th$|\u6cf0\u56fd/i,
    /global|international|default/i,
  ];

  const submitClicked = await clickFirstVisibleLocatorCenter(page, [
    ".page-region [class*='28B894']",
    ".page-region button:has-text('Get started')",
    ".page-region button:has-text('Start')",
    ".page-region button:has-text('Submit')",
    ".page-region button:has-text('Continue')",
    ".page-region [role='button']:has-text('Get started')",
    ".page-region [role='button']:has-text('Start')",
    ".page-region [role='button']:has-text('Submit')",
    ".page-region [role='button']:has-text('Continue')",
  ]);
  if (submitClicked) {
    reportStep("submitting_codebuddy_region", "Submitted CodeBuddy region selection");
    await page.waitForTimeout(1200);
    return true;
  }

  const visibleOption = await clickVisibleLocatorByText(
    page,
    "ul.dropdown-section li, .dropdown-section li, [role='option'], .t-select-option, [class*='option']",
    optionPatterns
  );
  if (visibleOption) {
    reportStep("selecting_codebuddy_region", `Selected CodeBuddy region: ${visibleOption}`);
    await page.waitForTimeout(900);
    return true;
  }

  const opened = await clickFirstVisibleLocatorCenter(page, [
    ".page-region .t-select",
    ".page-region [class*='t-select']",
    ".page-region [role='combobox']",
    ".page-region input[placeholder]",
    ".page-region [class*='select']",
    ".page-region [class*='cursor-pointer']",
  ]);
  if (!opened) return false;

  reportStep("opening_codebuddy_region_selector", "Opening CodeBuddy region selector");
  await page.waitForTimeout(600);

  const openedOption = await clickVisibleLocatorByText(
    page,
    "ul.dropdown-section li, .dropdown-section li, [role='option'], .t-select-option, [class*='option']",
    optionPatterns
  );
  if (openedOption) {
    reportStep("selecting_codebuddy_region", `Selected CodeBuddy region: ${openedOption}`);
    await page.waitForTimeout(900);
  }

  return true;
}

async function handleCodeBuddyRegionPage(page, reportStep) {
  if (!isProviderPage(page) || isGoogleAuthPage(page)) return false;

  const handledViaApi = await handleCodeBuddyRegionPageViaApi(page, reportStep);
  if (handledViaApi) return true;

  const handledWithMouse = await handleCodeBuddyRegionPageWithMouse(page, reportStep);
  if (handledWithMouse) return true;

  for (const scope of getInteractionScopes(page)) {
    const result = await scope.evaluate(() => {
      const visible = (element) => {
        if (!(element instanceof HTMLElement)) return false;
        const style = window.getComputedStyle(element);
        if (style.visibility === "hidden" || style.display === "none" || Number(style.opacity) === 0) return false;
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };

      const root = document.querySelector(".page-region");
      const bodyText = document.body?.innerText || "";
      const looksLikeRegionPage = root
        || /select\s+region|region|country|area|get started|complete/i.test(bodyText);
      if (!looksLikeRegionPage) return null;

      const clickElement = (element) => {
        element.scrollIntoView({ block: "center", inline: "center" });
        for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
          element.dispatchEvent(new MouseEvent(type, {
            bubbles: true,
            cancelable: true,
            view: window,
            buttons: type.endsWith("down") ? 1 : 0,
          }));
        }
      };

      const optionPatterns = [
        /indonesia|^id$|\u5370\u5ea6\u5c3c\u897f\u4e9a/i,
        /singapore|^sg$|\u65b0\u52a0\u5761/i,
        /japan|^jp$|\u65e5\u672c/i,
        /thailand|^th$|\u6cf0\u56fd/i,
        /global|international|default/i,
      ];

      const searchRoot = root || document.body;
      const submitSelectors = [
        "button",
        "[role='button']",
        "input[type='submit']",
        ".t-button",
        "[class*='button']",
        "[class*='28B894']",
      ];
      const submitButtons = [...searchRoot.querySelectorAll(submitSelectors.join(","))]
        .filter(visible)
        .filter((element) => {
          const text = `${element.innerText || ""} ${element.getAttribute("aria-label") || ""} ${element.getAttribute("value") || ""}`;
          const className = element.getAttribute("class") || "";
          return /submit|start|continue|confirm|done|get started|complete|\u5b8c\u6210|\u5f00\u59cb|\u786e\u5b9a|\u4e0b\u4e00\u6b65/i.test(text)
            || className.includes("28B894");
        });

      if (submitButtons.length) {
        clickElement(submitButtons[0]);
        return { action: "submitted" };
      }

      const optionSelectors = [
        "ul.dropdown-section li",
        ".dropdown-section li",
        "[role='option']",
        ".t-select-option",
        "[class*='option']",
        "[class*='dropdown'] li",
      ];
      const options = [...document.querySelectorAll(optionSelectors.join(","))]
        .filter(visible)
        .filter((element) => (element.innerText || element.textContent || "").trim());

      if (options.length) {
        const option = optionPatterns
          .map((pattern) => options.find((element) => pattern.test((element.innerText || element.textContent || "").trim())))
          .find(Boolean) || options[0];
        const label = (option.innerText || option.textContent || "").trim();
        clickElement(option);
        return { action: "selected", label };
      }

      const controlSelectors = [
        "[role='combobox']",
        ".t-select",
        "[class*='t-select']",
        "[class*='select']",
        "input[placeholder]",
        ".text-sm",
        "[class*='cursor-pointer']",
      ];
      const controls = [...searchRoot.querySelectorAll(controlSelectors.join(","))]
        .filter(visible)
        .filter((element) => {
          const text = `${element.innerText || ""} ${element.getAttribute("placeholder") || ""} ${element.getAttribute("aria-label") || ""}`;
          return /region|country|area|select|placeholder|\u5730\u533a|\u56fd\u5bb6|\u9009\u62e9/i.test(text)
            || element.matches?.(".t-select,[class*='t-select'],input[placeholder],[class*='select']");
        });

      if (controls.length) {
        clickElement(controls[0]);
        return { action: "opened" };
      }

      return null;
    }).catch(() => null);

    if (!result?.action) continue;

    if (result.action === "selected") {
      reportStep("selecting_codebuddy_region", `Selected CodeBuddy region${result.label ? `: ${result.label}` : ""}`);
      await page.waitForTimeout(700);
      return true;
    }

    if (result.action === "submitted") {
      reportStep("submitting_codebuddy_region", "Submitted CodeBuddy region selection");
      await page.waitForTimeout(1200);
      return true;
    }

    reportStep("opening_codebuddy_region_selector", "Opening CodeBuddy region selector");
    await page.waitForTimeout(700);
    return true;
  }

  return false;
}

async function handleCodeBuddyStartedAuthorization(page, reportStep) {
  if (!isProviderPage(page) || isGoogleAuthPage(page)) return false;

  const result = await page.evaluate(async () => {
    const url = new URL(window.location.href);
    if (!/\/started\/?$/.test(url.pathname)) return null;

    const platform = url.searchParams.get("platform") || "CLI";
    const state = url.searchParams.get("state");
    if (!state) return null;

    const domains = [window.location.hostname || "www.codebuddy.ai"].filter(Boolean);
    for (const domain of [...new Set(domains)]) {
      const authUrl = new URL("/console/auth/login", window.location.origin);
      authUrl.searchParams.set("platform", platform);
      authUrl.searchParams.set("state", state);
      authUrl.searchParams.set("domain", domain);

      try {
        const response = await fetch(authUrl.toString(), {
          method: "GET",
          credentials: "include",
          redirect: "manual",
          headers: {
            "x-requested-with": "XMLHttpRequest",
            "X-Domain": domain,
          },
        });
        if (response.type === "opaqueredirect" || (response.status >= 300 && response.status < 400)) {
          return { action: "attempted", domain, message: "redirected" };
        }
        const text = await response.text();
        let data = null;
        try {
          data = text ? JSON.parse(text) : null;
        } catch {
          data = { raw: text };
        }
        if (response.ok && (!data || data.code === 0 || data.code === 200 || typeof data.code === "undefined")) {
          return { action: "authorized", domain };
        }
        if (response.ok) {
          return { action: "attempted", domain, code: data?.code, message: data?.msg || data?.message || "" };
        }
      } catch (error) {
        // Try the next domain variant.
      }
    }

    return { action: "failed" };
  }).catch(() => null);

  if (!result?.action || result.action === "failed") return false;

  if (result.action === "authorized") {
    reportStep("authorizing_codebuddy_cli_state", "Authorized CodeBuddy CLI login state");
    await page.waitForTimeout(1200);
    return true;
  }

  reportStep(
    "authorizing_codebuddy_cli_state",
    result.message
      ? `Attempted CodeBuddy CLI login state authorization: ${result.message}`
      : "Attempted CodeBuddy CLI login state authorization"
  );
  await page.waitForTimeout(1200);
  return true;
}

async function handleProviderOnboarding(page, reportStep, serviceLabel) {
  if (!isProviderPage(page) || isGoogleAuthPage(page)) return false;

  const confirmedPrivacy = await clickFirstActionable(page, PRIVACY_CONFIRM_BUTTON_SELECTORS);
  if (confirmedPrivacy) {
    reportStep("accepting_provider_privacy_dialog", `Confirmed ${serviceLabel} privacy or terms dialog`);
    await page.waitForTimeout(800);
    return true;
  }

  const handledCodeBuddyStarted = await handleCodeBuddyStartedAuthorization(page, reportStep);
  if (handledCodeBuddyStarted) {
    return true;
  }

  const handledCodeBuddyRegion = await handleCodeBuddyRegionPage(page, reportStep);
  if (handledCodeBuddyRegion) {
    return true;
  }

  const selectedNativeRegion = await selectNativeRegionOption(page);
  if (selectedNativeRegion) {
    reportStep("selecting_provider_region", `Selected ${serviceLabel} region`);
    await page.waitForTimeout(700);
    return true;
  }

  const openedRegionMenu = await clickFirstActionable(page, PROVIDER_REGION_TRIGGER_SELECTORS);
  if (openedRegionMenu) {
    reportStep("opening_provider_region_selector", `Opening ${serviceLabel} region selector`);
    await page.waitForTimeout(500);
    const selectedRegion = await clickFirstActionable(page, PROVIDER_REGION_OPTION_SELECTORS);
    if (selectedRegion) {
      reportStep("selecting_provider_region", `Selected ${serviceLabel} region`);
      await page.waitForTimeout(700);
    }
    return true;
  }

  const selectedRegion = await clickFirstActionable(page, PROVIDER_REGION_OPTION_SELECTORS);
  if (selectedRegion) {
    reportStep("selecting_provider_region", `Selected ${serviceLabel} region`);
    await page.waitForTimeout(700);
    return true;
  }

  const filledDefaults = await fillProviderOnboardingDefaults(page);
  if (filledDefaults) {
    reportStep("filling_provider_onboarding", `Filled ${serviceLabel} onboarding defaults`);
    await page.waitForTimeout(500);
    return true;
  }

  const clickedAction = await clickFirstActionable(page, PROVIDER_ONBOARDING_ACTION_SELECTORS);
  if (clickedAction) {
    reportStep("continuing_provider_onboarding", `Continuing ${serviceLabel} onboarding`);
    await page.waitForTimeout(1000);
    return true;
  }

  return false;
}

async function handleZaiAuthorizePage(page, reportStep) {
  if (!isProviderPage(page) || isGoogleAuthPage(page)) return false;

  const pageUrl = (() => { try { return page.url(); } catch { return ""; } })();
  const isZaiAuthUrl = pageUrl.includes("chat.z.ai/auth");
  const text = await readPageText(page);
  const isZaiAuthorize = /would like to access your.*account|wants to access your.*account/i.test(text)
    || /AutoGLM|autoglm/i.test(text)
    || isZaiAuthUrl;
  if (!isZaiAuthorize) return false;

  const checkboxChecked = await checkFirstVisible(page, TERMS_CHECKBOX_SELECTORS);
  if (checkboxChecked) {
    reportStep("accepting_zai_authorize_tos", "Accepted Z.ai authorize TOS checkbox");
    await page.waitForTimeout(200);
  }

  // Poll for the Continue/authorize button — Z.ai page may take a moment to
  // enable the button after checkbox state settles. One-shot clickFirstActionable
  // fails when the button is still loading (16s gap observed in production).
  const zaiContinueSelectors = [
    'button:has-text("Continue"):not([disabled])',
    'button:not([disabled]):has-text("Continue")',
    'button:has-text("同意")',
    'button:has-text("授权")',
    'button:has-text("允许")',
    'button:has-text("Lanjutkan")',
    'button:has-text("Authorize")',
    'button:has-text("Allow")',
  ];
  const polled = await pollAndClickFirstVisible(page, zaiContinueSelectors, {
    timeoutMs: 8_000,
    reportStep,
    stepId: "approving_zai_authorize",
    notFoundMessage: "Waiting for Z.ai Continue button",
    pollIntervalMs: 500,
  });
  if (polled) {
    // Wait for redirect to autoclaw.z.ai instead of fixed 1.5s delay.
    await waitForNextStep(page, {
      targetSelectors: [
        'button:has-text("去注册")',
        'button:has-text("登录")',
        '[class*="login-gate"]',
        '[class*="autoclaw"]',
      ],
      timeoutMs: 10_000,
    });
    return true;
  }

  return checkboxChecked;
}

async function handleProviderLoginGate(page, reportStep) {
  if (isGoogleAuthPage(page)) return false;

  const handledZaiAuthorize = await handleZaiAuthorizePage(page, reportStep);
  if (handledZaiAuthorize) return true;

  const confirmedExistingDialog = await clickFirstActionable(page, PRIVACY_CONFIRM_BUTTON_SELECTORS);
  if (confirmedExistingDialog) {
    reportStep("accepting_provider_privacy_dialog", "Confirmed provider privacy agreement dialog");
    await page.waitForTimeout(1000);
    return true;
  }

  const checkedTerms = await checkFirstUnchecked(page, TERMS_CHECKBOX_SELECTORS);
  if (checkedTerms) {
    reportStep("accepting_provider_terms", "Accepted provider terms for Google login");
    await page.waitForTimeout(400);
    const handledZaiAfterTerms = await handleZaiAuthorizePage(page, reportStep);
    if (handledZaiAfterTerms) return true;
    reportStep("waiting_google_signup_button", "Waiting for Sign up with Google button after accepting terms");
    await waitForGoogleButtonOrZaiAuthorize(page, 15_000);
    const handledLateZaiAuthorize = await handleZaiAuthorizePage(page, reportStep);
    if (handledLateZaiAuthorize) return true;
  }

  reportStep("clicking_google_signup", "Clicking Sign up with Google");
  const clickedGoogle = await clickCodeBuddyGoogleSocialLogin(page)
    || await clickFirstActionable(page, GOOGLE_LOGIN_BUTTON_SELECTORS);
  if (!clickedGoogle) {
    reportStep("google_login_button_not_found", "Google login button not found after accepting provider terms");
  }

  if (clickedGoogle) {
    reportStep("selecting_google_login", "Selecting Google login");
    const googleOpened = await waitForGoogleAuthPage(page);
    if (!googleOpened) {
      reportStep("google_login_not_opened", `Google login did not open yet; current URL: ${page.url()}`);
      return true;
    }

    const confirmedDialog = await clickFirstActionable(page, PRIVACY_CONFIRM_BUTTON_SELECTORS);
    if (confirmedDialog) {
      reportStep("accepting_provider_privacy_dialog", "Confirmed provider privacy agreement dialog");
      await page.waitForTimeout(1000);
    }

    return true;
  }

  if (checkedTerms) return true;

  return false;
}

export function createKiroCallbackMonitor(context, page, timeoutMs = DEFAULT_MANUAL_TIMEOUT_MS) {
  let resolveOuter;
  let rejectOuter;
  const promise = new Promise((resolve, reject) => {
    resolveOuter = resolve;
    rejectOuter = reject;
  });

  let settled = false;
  const trackedPages = new Set();
  const contextCleanups = new Map();
  const timeoutHandle = setTimeout(() => {
    settle(null, new Error("Timed out waiting for Kiro callback"));
  }, timeoutMs);

  function settle(result, error = null) {
    if (settled) return;
    settled = true;
    clearTimeout(timeoutHandle);
    for (const fns of contextCleanups.values()) {
      for (const fn of fns) {
        try { fn(); } catch {}
      }
    }
    contextCleanups.clear();
    if (error) rejectOuter(error);
    else resolveOuter(result);
  }

  function registerPage(trackedPage, ownerCleanups) {
    if (!trackedPage || trackedPages.has(trackedPage)) return;
    trackedPages.add(trackedPage);

    const onFrame = (frame) => {
      const parsed = parseCallbackUrl(frame?.url?.() || "");
      if (parsed) settle(parsed);
    };
    const onRequest = (request) => {
      const parsed = parseCallbackUrl(request?.url?.() || "");
      if (parsed) settle(parsed);
    };
    const onRequestFailed = (request) => {
      const parsed = parseCallbackUrl(request?.url?.() || "");
      if (parsed) settle(parsed);
    };
    const onLoadState = () => {
      const parsed = parseCallbackUrl(trackedPage.url?.() || "");
      if (parsed) settle(parsed);
    };

    trackedPage.on("framenavigated", onFrame);
    trackedPage.on("request", onRequest);
    trackedPage.on("requestfailed", onRequestFailed);
    trackedPage.on("domcontentloaded", onLoadState);
    trackedPage.on("load", onLoadState);

    ownerCleanups.push(() => {
      trackedPage.off("framenavigated", onFrame);
      trackedPage.off("request", onRequest);
      trackedPage.off("requestfailed", onRequestFailed);
      trackedPage.off("domcontentloaded", onLoadState);
      trackedPage.off("load", onLoadState);
    });

    const current = parseCallbackUrl(trackedPage.url?.() || "");
    if (current) settle(current);
  }

  function bind(ctx, pg) {
    if (settled) return;
    if (contextCleanups.has(ctx)) return;
    const cleanups = [];
    contextCleanups.set(ctx, cleanups);

    const onPage = (newPage) => registerPage(newPage, cleanups);
    ctx.on("page", onPage);
    cleanups.push(() => ctx.off("page", onPage));

    if (pg) registerPage(pg, cleanups);
  }

  bind(context, page);

  // Reject immediately when context is closed (cancelJob / crash) so the
  // 15-min timeout doesn't block job cancellation.
  context.on("close", () => {
    settle(null, new Error("Browser context closed — callback monitoring stopped"));
  });

  promise.rebind = ({ context: newContext, page: newPage } = {}) => {
    if (newContext) bind(newContext, newPage);
  };

  return promise;
}

export async function runGoogleAccountAutomation({
  page,
  authUrl,
  skipNavigation = false,
  email,
  password,
  proxyUrl = null,
  successPromise,
  shortTimeoutMs = DEFAULT_SHORT_TIMEOUT_MS,
  serviceLabel = "provider",
  openingStep = "opening_google_oauth",
  openingMessage = "Opening Google OAuth page",
  successStep = "oauth_success_received",
  successMessage = "OAuth success received",
  onStep,
}) {
  const startTime = Date.now();
  const reportStep = (step, message) => {
    onStep?.(step, message);
  };

  reportStep(openingStep, openingMessage);
  if (!skipNavigation && authUrl) {
    await page.goto(authUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForLoadState("load", { timeout: 30_000 }).catch(() => null);
    if (isProviderPage(page)) {
      reportStep("waiting_provider_login_ready", `Waiting for ${serviceLabel} login page to finish loading`);
      const providerReady = await waitForProviderLoginReady(page);
      reportStep(
        providerReady ? "provider_login_ready" : "provider_login_ready_timeout",
        providerReady
          ? `${serviceLabel} login page rendered`
          : `${serviceLabel} login page did not expose expected controls before timeout`
      );
    }
    // Wait for email input or Google button to appear — poll instead of fixed delay.
    await waitForNextStep(page, {
      targetSelectors: [EMAIL_INPUT_SELECTOR, ...GOOGLE_LOGIN_BUTTON_SELECTORS.slice(0, 3)],
      timeoutMs: 8_000,
    });
  } else {
    // Already on the page — brief jitter for human-like behavior, then proceed.
    await page.waitForTimeout(300 + Math.floor(Math.random() * 400));
  }

  await handleProviderLoginGate(page, reportStep);

  const emailInput = await waitForFirstVisibleLocator(page, EMAIL_INPUT_SELECTOR, { timeout: 15_000 });
  if (emailInput) {
    reportStep("entering_email", "Entering Google email");
    await page.mouse.move(100 + Math.floor(Math.random() * 400), 200 + Math.floor(Math.random() * 300));
    await page.waitForTimeout(150 + Math.floor(Math.random() * 200));
    const filled = await fillInputResilient(emailInput, email);
    if (!filled) {
      reportStep("email_fill_failed", "Could not fill the Google email field; will retry in the polling loop");
    } else {
      reportStep("submitting_email", "Submitting email");
      await page.waitForTimeout(200 + Math.floor(Math.random() * 200));
      await clickFirstVisible(page, NEXT_BUTTON_SELECTORS);
    }
  }

  // Wait for navigation away from email page before entering the polling loop.
  // Without this, the loop may re-detect the stale email input and resubmit,
  // causing Google to show "Wrong password" (password never entered).
  try {
    await page.waitForURL((url) => !url.toString().includes("/identifier?"), { timeout: 10_000 });
  } catch {
    // Page didn't navigate; the loop will handle retry.
  }
  await page.waitForTimeout(1000);

  while (Date.now() - startTime < shortTimeoutMs) {
    const successResult = await Promise.race([
      successPromise.then((result) => ({ kind: "success", result })).catch((error) => ({ kind: "success_error", error })),
      new Promise((resolve) => setTimeout(() => resolve(null), 800)),
    ]);

    if (successResult?.kind === "success") {
      reportStep(successStep, successMessage);
      return {
        status: "success",
        ...successResult.result,
      };
    }

    if (successResult?.kind === "success_error") {
      reportStep("oauth_timeout", `Timed out waiting for ${serviceLabel} authorization`);
      return {
        status: "failed_timeout",
        error: successResult.error?.message || `Timed out waiting for ${serviceLabel} authorization`,
      };
    }

    // Wrap the entire loop body in a try-catch so that "Target page, context
    // or browser has been closed" errors (which happen when the proxy drops
    // mid-navigation and Chromium kills the page) don't crash the worker.
    // Instead, return needs_manual so the user can finish in the browser.
    try {
      const currentUrl = page.url();
      const urlObj = new URL(currentUrl);
      if (urlObj.hostname.includes("autoclaw.z.ai")) {
        // Check if AutoClaw is showing a sign-in failure error (rate limit,
        // IP block, OAuth rejected). If so, return needs_retry so the bulk
        // manager can re-launch with a fresh proxy IP.
        const pageText = await readPageText(page).catch(() => "");
        if (pageText && includesAny(pageText, SIGNIN_FAILED_MARKERS)) {
          if (!proxyUrl) {
            reportStep("signin_failed_manual", `AutoClaw sign-in failed without proxy — keeping browser open for inspection`);
            return {
              status: "needs_manual",
              error: "AutoClaw sign-in failed and no proxy is active, so automatic fresh-IP retry is disabled. Browser left open for inspection.",
            };
          }
          reportStep("signin_failed_retry", `AutoClaw sign-in failed (proxy active) — retrying with fresh proxy IP`);
          return {
            status: "needs_retry",
            error: "AutoClaw sign-in failed — IP may be rate limited. Retrying with a fresh proxy IP.",
          };
        }
        reportStep("waiting_for_token", `Redirected back — waiting for token extraction`);
        await page.waitForTimeout(1000);
        continue;
      }
    } catch {}

    try {
      const handledProviderGate = await handleProviderLoginGate(page, reportStep);
      if (handledProviderGate) {
        continue;
      }

      const handledGoogleConsent = await handleGoogleConsent(page, reportStep);
      if (handledGoogleConsent) {
        continue;
      }

      const handledReVerify = await handleGoogleReVerify(page, reportStep);
      if (handledReVerify) {
        continue;
      }

      const text = await readPageText(page);
      if (includesAny(text, INVALID_CREDENTIAL_MARKERS)) {
        reportStep("invalid_credentials", "Google rejected the supplied email or password");
        return {
          status: "failed_invalid_credentials",
          error: "Google rejected the supplied email or password.",
        };
      }

      if (includesAny(text, RESTRICTED_ACCOUNT_MARKERS)) {
        reportStep("account_restricted", "Account is restricted, suspended, or banned by the provider");
        return {
          status: "failed_restricted",
          error: "Account is restricted, suspended, or banned. Skipping.",
        };
      }

      if (includesAny(text, MANUAL_ASSIST_MARKERS)) {
        // Check if this is a Shumei slider captcha — auto-solve if possible
        await page.waitForLoadState("domcontentloaded").catch(() => null);
        const isShumeiCaptcha = await page.locator(".shumei_captcha_wrapper").first().isVisible({ timeout: 1_500 }).catch(() => false);
        if (isShumeiCaptcha) {
          reportStep("detected_shumei_captcha", "Shumei slider captcha detected on Google login — attempting auto-solve");
          const solved = await solveShumeiCaptcha(page, { timeout: 10_000 });
          if (solved) {
            reportStep("solved_shumei_captcha", "Shumei slider captcha solved automatically — continuing login");
            continue;
          }
          reportStep("failed_shumei_captcha", "Shumei auto-solve failed — falling back to manual assist");
        } else {
          reportStep("no_shumei_captcha", "No Shumei captcha — falling back to manual assist for other challenge type");
        }
        reportStep("manual_assist_required", "Google requested CAPTCHA, 2FA, or recovery verification");
        return {
          status: "needs_manual",
          error: "Manual assist required in the browser session (CAPTCHA, 2FA, recovery, or suspicious-login challenge).",
        };
      }

      const handledOnboarding = await handleGoogleOnboarding(page, text);
      if (handledOnboarding) {
        reportStep("google_onboarding", "Accepted Google onboarding or privacy prompt");
        continue;
      }

      const handledProviderOnboarding = await handleProviderOnboarding(page, reportStep, serviceLabel);
      if (handledProviderOnboarding) {
        continue;
      }

      const nextEmailInput = await getFirstVisibleLocator(page, EMAIL_INPUT_SELECTOR);
      if (nextEmailInput) {
        reportStep("entering_email", "Entering Google email");
        const filled = await fillInputResilient(nextEmailInput, email);
        if (filled) {
          reportStep("submitting_email", "Submitting email");
          await page.waitForTimeout(200 + Math.floor(Math.random() * 200));
          await clickFirstVisible(page, NEXT_BUTTON_SELECTORS);
          // Wait for password field or URL change — poll instead of fixed 2s.
          await waitForNextStep(page, {
            baselineUrl: (() => { try { return page.url(); } catch { return ""; } })(),
            targetSelectors: [PASSWORD_INPUT_SELECTOR],
            timeoutMs: 10_000,
          });
        } else {
          reportStep("email_fill_failed", "Could not fill the Google email field; retrying loop");
        }
        continue;
      }

      const passwordInput = await getFirstVisibleLocator(page, PASSWORD_INPUT_SELECTOR);
      if (passwordInput) {
        reportStep("entering_password", "Entering Google password");
        await page.waitForTimeout(200 + Math.floor(Math.random() * 300));
        await page.mouse.move(100 + Math.floor(Math.random() * 400), 200 + Math.floor(Math.random() * 300));
        await page.waitForTimeout(100 + Math.floor(Math.random() * 200));
        const filled = await fillInputResilient(passwordInput, password);
        if (filled) {
          reportStep("submitting_password", "Submitting password");
          await page.waitForTimeout(200 + Math.floor(Math.random() * 300));
          await clickFirstVisible(page, NEXT_BUTTON_SELECTORS);
        } else {
          reportStep("password_fill_failed", "Could not fill the Google password field; retrying loop");
        }
        // Wait for URL change (consent page, re-verify, or Z.ai authorize redirect) — poll instead of 2s fixed.
        await waitForNextStep(page, {
          baselineUrl: (() => { try { return page.url(); } catch { return ""; } })(),
          targetSelectors: [
            APPROVE_BUTTON_SELECTORS[0],
            ...APPROVE_BUTTON_SELECTORS.slice(1, 3),
            ...GOOGLE_LOGIN_BUTTON_SELECTORS.slice(0, 6),
            ...TERMS_CHECKBOX_SELECTORS.slice(0, 4),
            '#agree-policy-account',
            'button:has-text("Continue"):not([disabled])',
            'button:has-text("Confirm")',
            ...GOOGLE_LOGIN_BUTTON_SELECTORS.slice(6, 14),
          ],
          timeoutMs: 10_000,
        });
        continue;
      }

      const clickedApprove = await clickFirstVisible(page, APPROVE_BUTTON_SELECTORS);
      if (clickedApprove) {
        reportStep("approving_consent", `Approving Google or ${serviceLabel} consent`);
        // Wait for URL change after consent — poll instead of 700ms fixed.
        await waitForNextStep(page, {
          baselineUrl: (() => { try { return page.url(); } catch { return ""; } })(),
          timeoutMs: 5_000,
        });
        continue;
      }

      reportStep("waiting_for_next_screen", `Waiting for the next Google or ${serviceLabel} screen`);
      await page.waitForTimeout(700);
    } catch (loopError) {
      // Page/context/browser closed (proxy drop, OOM, crash). Don't crash the
      // worker — return needs_manual so the user can retry or finish manually.
      const msg = (loopError.message || String(loopError)).toLowerCase();
      if (msg.includes("closed") || msg.includes("destroyed") || msg.includes("target page") || msg.includes("browser has been closed")) {
        reportStep("manual_assist_required", `Browser session interrupted: ${(loopError.message || "").slice(0, 100)}`);
        return {
          status: "needs_manual",
          error: `Browser session was interrupted (page/context closed). ${(loopError.message || "").slice(0, 120)}`,
        };
      }
      // Other errors — re-throw to let the worker catch handle it.
      throw loopError;
    }
  }

  reportStep("manual_assist_required", `Flow did not complete ${serviceLabel} authorization automatically`);
  return {
    status: "needs_manual",
    error: `Manual assist required in the browser session because the login flow did not complete ${serviceLabel} authorization automatically.`,
  };
}

export async function runKiroGoogleAutomation({
  page,
  authUrl,
  email,
  password,
  callbackPromise,
  shortTimeoutMs = DEFAULT_SHORT_TIMEOUT_MS,
  onStep,
}) {
  return runGoogleAccountAutomation({
    page,
    authUrl,
    email,
    password,
    successPromise: callbackPromise,
    shortTimeoutMs,
    serviceLabel: "Kiro",
    openingStep: "opening_google_oauth",
    openingMessage: "Opening Google OAuth page",
    successStep: "kiro_callback_received",
    successMessage: "Kiro callback received",
    onStep,
  });
}

export {
  handleCodeBuddyRegionPage,
  handleProviderOnboarding,
  handleCodeBuddyStartedAuthorization,
  isProviderPage,
};

export const __test__ = {
  waitForFirstVisibleLocator,
  fillInputResilient,
  parseSelectorList,
  getFirstVisibleLocator,
};
