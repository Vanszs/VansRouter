"""
AutoClaw OAuth automation — Playwright Python port.
Node.js backend calls this as subprocess. Tokens output to stdout as JSON.

Usage:
    python -m autoclaw.runner EMAIL PASSWORD [--proxy PROXY_URL] [--device-id DEVICE_ID] [--db DB_PATH]

Output (stdout JSON):
    {"status": "success", "access_token": "...", "refresh_token": "...", "user_id": "...", "user_name": "...", "device_id": "..."}
    {"status": "failed", "error": "..."}
    {"status": "needs_manual", "error": "..."}
    {"status": "needs_retry", "error": "..."}
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import random
import sqlite3
import sys
import time
import uuid
from typing import Any

from playwright.async_api import async_playwright, Browser, BrowserContext, Page

from .captcha import solve_shumei_captcha

# ── Constants ──────────────────────────────────────────────────────────────────

AUTOCLAW_WEB_URL = "https://autoclaw.z.ai/web/"
DEFAULT_SHORT_TIMEOUT_MS = 5 * 60_000
DEFAULT_MANUAL_TIMEOUT_MS = 15 * 60_000
NAV_TIMEOUT_MS = 90_000
DOM_READY_TIMEOUT_MS = 60_000
LOGIN_BUTTON_TIMEOUT_MS = 60_000
ZAI_BUTTON_TIMEOUT_MS = 60_000
POPUP_WAIT_TIMEOUT_MS = 30_000
ZAI_FORM_TIMEOUT_MS = 60_000

MAX_NAV_RETRIES = 3
MAX_SIGNIN_RETRIES = 3

# ── Selectors ──────────────────────────────────────────────────────────────────

AUTOCLAW_LOGIN_BUTTON_SELECTORS = [
    'button:has-text("去注册")',
    'button:has-text("登录")',
    'button:has-text("Sign in")',
    'button:has-text("Login")',
    '[class*="login-gate"] button',
    '[class*="login"] button',
]

AUTOCLAW_ZAI_BUTTON_SELECTORS = [
    'button:has-text("Continue with Zai")',
    'button:has-text("Zai")',
    '[aria-label*="Zai"]',
    '[class*="zai"] button',
]

GOOGLE_LOGIN_BUTTON_SELECTORS = [
    'button:has-text("Continue with Google")',
    'a:has-text("Continue with Google")',
    '[role="button"]:has-text("Continue with Google")',
    'button:has-text("Sign in with Google")',
    'a:has-text("Sign in with Google")',
    'button:has-text("Google")',
    'a:has-text("Google")',
    '[aria-label*="Google"]',
]

EMAIL_INPUT_SELECTOR = ",".join([
    'input[type="email"]',
    'input[autocomplete="username"]',
    'input#identifierId',
    'input[name="identifier"]',
    'input[name="Email"]',
    'input[type="text"][autofocus]',
    'input[aria-label*="Email" i]',
    'input[aria-label*="email" i]',
    'input[aria-label*="phone" i]',
])

PASSWORD_INPUT_SELECTOR = ",".join([
    'input[type="password"]',
    'input[name="Passwd"]',
    'input[name="password"]',
    'input[aria-label*="Password" i]',
    'input[aria-label*="password" i]',
])

NEXT_BUTTON_SELECTORS = [
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
]

APPROVE_BUTTON_SELECTORS = [
    '#submit_approve_access',
    '#submit_approve_access button',
    '#confirm',
    'form#tos_form input[type="submit"]',
    'button[jsname]:has-text("Allow")',
    'button:has-text("Allow")',
    '[role="button"]:has-text("Allow")',
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
    'button:has-text("允许")',
    'button:has-text("继续")',
]

SKIP_BUTTON_SELECTORS = [
    'button:has-text("Skip")',
    'button:has-text("Lewati")',
    'button:has-text("Not now")',
    'button:has-text("Bukan sekarang")',
    'button:has-text("No thanks")',
    'button:has-text("Tidak sekarang")',
    'button:has-text("跳过")',
    'button:has-text("暂不")',
]

TERMS_CHECKBOX_SELECTORS = [
    '#agree-policy-account',
    '#agree-policy',
    '#agree-policy-sso',
    'input[type="checkbox"][id*="agree" i]',
    'input[type="checkbox"][name*="agree" i]',
    'input[type="checkbox"][id*="policy" i]',
    'input[type="checkbox"][id*="terms" i]',
    '.login-checkbox input[type="checkbox"]',
    '[class*="checkbox"] input[type="checkbox"]',
    '[class*="agree"] input[type="checkbox"]',
    'input[type="checkbox"]',
]

INVALID_CREDENTIAL_MARKERS = [
    "wrong password", "incorrect password", "couldn't find your google account",
    "couldn’t find your google account", "enter a valid email", "couldn’t sign you in",
    "couldn't sign you in", "invalid email or password", "password is incorrect",
    "密码错误", "密码不正确", "找不到该 google 帐号", "无法登录", "无法为您登录",
    "sandi salah", "kata sandi salah", "email atau sandi tidak valid",
]

MANUAL_ASSIST_MARKERS = [
    "2-step verification", "verify it’s you", "verify it's you",
    "check your phone", "confirm it’s you", "recovery email", "recovery phone",
    "suspicious sign-in prevented", "unusual activity detected", "captcha",
    "try again later", "两步验证", "双重验证", "验证您的身份", "确认是您本人",
    "检查您的手机", "恢复邮箱", "恢复电话", "验证码", "请稍后重试",
]

RESTRICTED_ACCOUNT_MARKERS = [
    "restricted", "account has been restricted", "account is restricted",
    "account has been suspended", "account is disabled", "account has been banned",
    "access denied", "account blocked", "account locked",
    "akun dibatasi", "akun diblokir", "akun ditangguhkan",
    "帐号已受限", "账号已受限", "帐号已被停用",
]

SIGNIN_FAILED_MARKERS = [
    "sign-in failed", "signin failed", "sign in failed", "login failed",
    "登录失败", "认证失败", "授权失败", "oauth failed", "authentication failed",
    "too many requests", "rate limit", "rate limited", "请求过于频繁",
    "try again later",
]

GOOGLE_ONBOARDING_MARKERS = [
    "welcome to your new google account", "selamat datang di akun google baru anda",
    "privacy and terms", "privasi dan persyaratan",
    "personalize your google services", "personalisasikan layanan google anda",
    "add recovery phone", "tambahkan nomor telepon pemulihan",
    "choose your settings", "pilih setelan anda",
    "欢迎使用您的新 google 帐号", "隐私权和条款",
    "个性化您的 google 服务", "添加恢复电话", "选择您的设置",
]

GOOGLE_REVERIFY_MARKERS = [
    "verify it's you", "verify it’s you", "confirm it's you", "confirm it’s you",
    "continue to sign in", "sign in to continue", "choose an account to continue",
    "re-enter your password", "use another account",
    "验证您的身份", "确认是您本人", "继续登录", "选择一个帐号以继续", "使用其他帐号",
]

GOOGLE_WORKSPACE_MARKERS = [
    "welcome to your new account", "selamat datang di akun baru",
    "your administrator decides which", "administrator anda memutuskan layanan",
    "欢迎使用您的新帐号", "您的管理员决定",
]

PRIVACY_CONFIRM_SELECTORS = [
    '.ui-dialog button:has-text("Confirm")',
    'dialog button:has-text("Confirm")',
    'button:has-text("Confirm")',
    'button:has-text("I agree")',
    'button:has-text("Agree")',
    'button:has-text("同意")',
    'button:has-text("确认")',
]


# ── Helpers ────────────────────────────────────────────────────────────────────

def _log(*args: Any) -> None:
    print(f"[AutoClaw]", *args, file=sys.stderr, flush=True)


def _output(obj: dict) -> None:
    """Print result JSON to stdout for the Node.js caller."""
    print(json.dumps(obj, ensure_ascii=False), flush=True)


def _jitter(base: int, spread: int) -> int:
    return base + random.randint(0, spread)


def _includes_any(text: str, markers: list[str]) -> bool:
    lower = text.lower()
    return any(m.lower() in lower for m in markers)


def _is_google_auth_page(page: Page) -> bool:
    try:
        host = page.url.split("/")[2] if "://" in page.url else ""
        return host == "accounts.google.com" or host.endswith(".accounts.google.com")
    except Exception:
        return False


async def _read_page_text(page: Page) -> str:
    try:
        return await page.evaluate("() => document.body?.innerText || ''")
    except Exception:
        return ""


async def _click_first_visible(page: Page, selectors: list[str]) -> bool:
    for sel in selectors:
        try:
            loc = page.locator(sel).first
            if await loc.count() == 0:
                continue
            visible = await loc.is_visible()
            if not visible:
                continue
            await loc.click(timeout=5_000)
            return True
        except Exception:
            continue
    return False


async def _click_first_actionable(page: Page, selectors: list[str]) -> bool:
    for sel in selectors:
        try:
            loc = page.locator(sel).first
            if await loc.count() == 0:
                continue
            await loc.scroll_into_view_if_needed()
            if not await loc.is_visible():
                continue
            if not await loc.is_enabled():
                continue
            await loc.click(timeout=5_000)
            return True
        except Exception:
            continue
    return False


async def _poll_and_click(page: Page, selectors: list[str], timeout_ms: int,
                          step_label: str, step_cb, poll_ms: int = 1000) -> bool:
    """Poll until one of the selectors becomes visible and clickable."""
    started = time.monotonic()
    last_reported = -1
    while (time.monotonic() - started) * 1000 < timeout_ms:
        elapsed = int((time.monotonic() - started))
        if elapsed != last_reported:
            step_cb(step_label, f"Looking for {step_label} ({elapsed}s)")
            last_reported = elapsed
        for sel in selectors:
            try:
                loc = page.locator(sel).first
                visible = await loc.is_visible()
                if visible:
                    await loc.click(timeout=5_000)
                    step_cb(step_label, f"Clicked ({elapsed}s)")
                    return True
            except Exception:
                continue
        await asyncio.sleep(poll_ms / 1000)
    elapsed = int((time.monotonic() - started))
    step_cb(step_label, f"Not found after {elapsed}s")
    return False


async def _wait_selector_visible(page: Page, selectors: list[str], timeout_ms: int = 10_000) -> bool:
    sel = ", ".join(selectors)
    deadline = time.monotonic() + timeout_ms / 1000
    while time.monotonic() < deadline:
        try:
            loc = page.locator(sel).first
            if await loc.is_visible():
                return True
        except Exception:
            pass
        await asyncio.sleep(0.2)
    return False


async def _wait_for_first_visible(page: Page, selector: str, timeout_ms: int = 15_000) -> Any:
    deadline = time.monotonic() + timeout_ms / 1000
    while time.monotonic() < deadline:
        try:
            loc = page.locator(selector).first
            if await loc.is_visible():
                return loc
        except Exception:
            pass
        await asyncio.sleep(0.5)
    return None


async def _human_type(locator, value: str) -> bool:
    """Type character by character with human-like delays."""
    if not locator or not value:
        return False
    try:
        await locator.click(timeout=5_000)
        await asyncio.sleep(random.uniform(0.2, 0.6))
    except Exception:
        pass
    try:
        await locator.press("Control+a")
        await asyncio.sleep(random.uniform(0.05, 0.15))
        await locator.press("Delete")
        await asyncio.sleep(random.uniform(0.15, 0.45))
    except Exception:
        try:
            await locator.fill("")
        except Exception:
            pass
    for ch in value:
        await locator.press(ch)
        base_delay = random.uniform(0.05, 0.18)
        long_pause = random.uniform(0.3, 0.8) if random.random() < 0.06 else 0
        await asyncio.sleep(base_delay + long_pause)
    try:
        observed = await locator.input_value()
        return observed == value
    except Exception:
        return False


async def _fill_input_resilient(locator, value: str) -> bool:
    """Fill input with fallback strategies. Try fast fill first, human type as fallback."""
    try:
        await locator.click(timeout=3_000)
        await locator.fill("")
        await locator.fill(value)
        observed = await locator.input_value()
        if observed == value:
            return True
    except Exception:
        pass
    filled = await _human_type(locator, value)
    if filled:
        return True
    try:
        observed = await locator.input_value()
        if observed == value:
            return True
    except Exception:
        pass
    try:
        await locator.click(timeout=5_000)
        await locator.fill("")
        await locator.type(value, delay=50)
        observed = await locator.input_value()
        return observed == value
    except Exception:
        return False


async def _wait_for_next_step(page: Page, baseline_url: str = "",
                              target_selectors: list[str] | None = None,
                              timeout_ms: int = 8_000) -> str:
    """Wait for URL change or target selector visible. Returns 'url_changed' | 'selector_visible' | 'timeout'."""
    url = baseline_url or page.url
    deadline = time.monotonic() + timeout_ms / 1000
    sel = ", ".join(target_selectors) if target_selectors else None
    while time.monotonic() < deadline:
        try:
            if page.url != url:
                return "url_changed"
        except Exception:
            pass
        if sel:
            try:
                loc = page.locator(sel).first
                if await loc.is_visible():
                    return "selector_visible"
            except Exception:
                pass
        await asyncio.sleep(0.2)
    return "timeout"


async def _check_unchecked(page: Page, selectors: list[str], force: bool = False) -> bool:
    """Check first visible checkbox. If force=True, verify even already-checked boxes."""
    for sel in selectors:
        try:
            loc = page.locator(sel).first
            if await loc.count() == 0:
                continue
            if not await loc.is_visible():
                continue
            if not force:
                try:
                    if await loc.is_checked():
                        continue
                except Exception:
                    pass
        except Exception:
            continue

        # Strategy 1: Playwright .check() with force
        try:
            await loc.check(force=True, timeout=3_000)
            if await _verify_checked(loc):
                return True
        except Exception:
            pass

        # Strategy 2: direct click on checkbox
        try:
            await loc.click(force=True, timeout=3_000)
            if await _verify_checked(loc):
                return True
        except Exception:
            pass

        # Strategy 3: click parent label
        try:
            label_clicked = await page.evaluate("""selector => {
                const el = document.querySelector(selector);
                if (!el) return false;
                const label = el.closest('label') || el.parentElement?.closest('label');
                if (label instanceof HTMLElement) { label.click(); return true; }
                return false;
            }""", sel)
            if label_clicked and await _verify_checked(loc):
                return True
        except Exception:
            pass

        # Strategy 4: DOM prototype setter
        try:
            dom_ok = await page.evaluate("""selector => {
                const input = document.querySelector(selector);
                if (!(input instanceof HTMLInputElement)) return false;
                const proto = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'checked');
                if (proto?.set) proto.set.call(input, true);
                else input.checked = true;
                input.dispatchEvent(new Event('input', { bubbles: true }));
                input.dispatchEvent(new Event('change', { bubbles: true }));
                return input.checked;
            }""", sel)
            if dom_ok:
                return True
        except Exception:
            pass

    return False


async def _verify_checked(locator) -> bool:
    try:
        return await locator.is_checked()
    except Exception:
        return False


# ── Page handlers ──────────────────────────────────────────────────────────────

async def _handle_zai_authorize(page: Page, step_cb) -> bool:
    """Handle Z.ai/AutoGLM authorize page: check agree checkbox + click Continue."""
    # URL-based detection (matches JS: chat.z.ai/auth)
    try:
        url = page.url
        is_zai_auth_url = "chat.z.ai/auth" in url or "z.ai" in url
    except Exception:
        url = ""
        is_zai_auth_url = False

    if not is_zai_auth_url:
        return False

    # Token-in-fragment page: body empty, just wait for token_monitor — no UI to interact with
    if "#token=" in url:
        step_cb("zai_token_skip", "Z.ai token redirect page — skipping UI, waiting for token")
        return False

    # Poll for page text to render (SPA hydration delay)
    text = ""
    for _ in range(10):
        text = await _read_page_text(page)
        if text.strip():
            break
        await asyncio.sleep(0.5)
    is_zai_text = "would like to access your" in text.lower() or "wants to access your" in text.lower()
    is_autoglm = "autoglm" in text.lower()

    _log(f"[zai_detect] url={url[:100]} is_zai_text={is_zai_text} is_autoglm={is_autoglm} text_head={text[:200]}")

    if not is_zai_text and not is_autoglm:
        return False

    # Check/set terms checkbox (force — even if appears already checked)
    cb_checked = await _check_unchecked(page, TERMS_CHECKBOX_SELECTORS, force=True)
    if cb_checked:
        step_cb("zai_authorize_terms", "Checked Z.ai terms checkbox")
        await asyncio.sleep(0.3)

    # Poll for enabled Continue button (like JS pollAndClickFirstVisible)
    deadline = time.monotonic() + 8.0
    while time.monotonic() < deadline:
        clicked = await _click_first_actionable(page, [
            'button:has-text("Continue"):not([disabled])',
            'button:not([disabled]):has-text("Continue")',
            'button:has-text("Lanjutkan")',
            'button:has-text("继续")',
            'button:has-text("同意")',
            'button:has-text("授权")',
            'button:has-text("允许")',
            'button:has-text("Authorize")',
            'button:has-text("Allow")',
            '[role="button"]:has-text("Continue")',
            '[role="button"]:has-text("Lanjutkan")',
        ])
        if clicked:
            step_cb("zai_authorize_continue", "Clicked Continue on Z.ai authorize page")
            await _wait_for_next_step(page, page.url, target_selectors=[
                'button:has-text("去注册")',
                'button:has-text("登录")',
                '[class*="login-gate"]',
                '[class*="autoclaw"]',
            ], timeout_ms=10_000)
            return True
        await asyncio.sleep(0.5)

    step_cb("zai_authorize_timeout", "Continue button not found on Z.ai authorize page")
    if cb_checked:
        return True
    return False


async def _handle_google_consent(page: Page, step_cb) -> bool:
    """Handle Google OAuth consent screen."""
    if not _is_google_auth_page(page):
        return False
    text = await _read_page_text(page)
    if not _includes_any(text, ["wants to access", "ingin mengakses", "akses ke akun google",
                                "allow", "想要访问", "授权访问", "允许"]):
        return False
    await page.evaluate("window.scrollTo(0, document.body?.scrollHeight || 9999)")
    await asyncio.sleep(0.15)
    clicked = await _click_first_actionable(page, APPROVE_BUTTON_SELECTORS)
    if clicked:
        step_cb("google_consent_approved", "Approved Google OAuth consent")
        await _wait_for_next_step(page, page.url, timeout_ms=5_000)
        return True
    return False


async def _handle_google_reverify(page: Page, step_cb) -> bool:
    """Handle Google re-verify page."""
    if not _is_google_auth_page(page):
        return False
    pw_visible = await _wait_for_first_visible(page, PASSWORD_INPUT_SELECTOR, 500)
    if pw_visible:
        return False  # normal password page
    text = await _read_page_text(page)
    if not _includes_any(text, GOOGLE_REVERIFY_MARKERS):
        return False
    await asyncio.sleep(0.5)
    clicked = await _click_first_visible(page, [
        'button:has-text("Continue")', 'button:has-text("Next")',
        'div[role="button"]:has-text("Continue")', 'div[role="button"]:has-text("Next")',
        'button:has-text("Confirm")', 'button:has-text("Yes")',
        'button:has-text("I understand")', 'button:has-text("Got it")',
    ])
    if clicked:
        step_cb("google_reverify", "Clicked continue on Google re-verify page")
        await _wait_for_next_step(page, page.url, timeout_ms=10_000)
        return True
    return False


async def _handle_google_onboarding(page: Page, page_text: str) -> bool:
    """Handle Google onboarding/welcome screens."""
    text = page_text or await _read_page_text(page)
    if not _includes_any(text, GOOGLE_ONBOARDING_MARKERS):
        return False
    if _includes_any(text, GOOGLE_WORKSPACE_MARKERS):
        await _click_first_visible(page, SKIP_BUTTON_SELECTORS)
        await asyncio.sleep(1)
        return True
    await _click_first_visible(page, [
        'button:has-text("I agree")', 'button:has-text("Agree")', 'button:has-text("OK")',
        'button:has-text("Continue")', 'button:has-text("Next")',
        'button:has-text("I understand")', 'button:has-text("Got it")',
        'button:has-text("同意")', 'button:has-text("继续")', 'button:has-text("下一步")',
        'button:has-text("我了解")', 'button:has-text("我明白")',
        'button:has-text("Saya mengerti")', 'button:has-text("Setuju")',
        'button:has-text("Lanjutkan")', 'button:has-text("Berikutnya")',
    ])
    if _includes_any(text, ["more about your privacy", "more personal", "privacy and terms",
                             "privasi dan persyaratan", "隐私权和条款"]):
        await _click_first_visible(page, [
            'button:has-text("Next")', 'button:has-text("Continue")',
            'button:has-text("I agree")', 'button:has-text("Accept")',
            'button:has-text("Berikutnya")', 'button:has-text("Lanjutkan")',
            'button:has-text("Setuju")',
        ])
    await asyncio.sleep(1)
    return True


async def _handle_provider_login_gate(page: Page, step_cb) -> bool:
    """Handle Z.ai/CodeBuddy provider login gate — terms, continue-with-Google click."""
    if _is_google_auth_page(page):
        return False

    handled = await _handle_zai_authorize(page, step_cb)
    if handled:
        return True

    confirmed = await _click_first_actionable(page, PRIVACY_CONFIRM_SELECTORS)
    if confirmed:
        step_cb("provider_privacy", "Confirmed provider privacy dialog")
        await asyncio.sleep(1)
        return True

    checked = await _check_unchecked(page, TERMS_CHECKBOX_SELECTORS, force=True)
    if checked:
        step_cb("provider_terms", "Accepted provider terms")
        await asyncio.sleep(0.8)
        if await _handle_zai_authorize(page, step_cb):
            return True
        # JS: waitForGoogleButtonOrZaiAuthorize — settle then retry
        await asyncio.sleep(2)
        if await _handle_zai_authorize(page, step_cb):
            return True

    step_cb("provider_google_login", "Clicking Continue with Google")
    clicked = await _click_first_actionable(page, GOOGLE_LOGIN_BUTTON_SELECTORS)
    if clicked:
        await asyncio.sleep(1)
        return True

    return bool(checked)


# ── Token monitor ──────────────────────────────────────────────────────────────

async def _create_token_monitor(context: BrowserContext, timeout_ms: int) -> dict | None:
    """Poll all context pages for AutoClaw tokens in localStorage every 500ms."""
    deadline = time.monotonic() + timeout_ms / 1000

    while time.monotonic() < deadline:
        try:
            for page in context.pages:
                try:
                    url = page.url
                    if "autoclaw.z.ai" not in url:
                        continue
                    data = await page.evaluate("""() => {
                        try {
                            const authToken = localStorage.getItem('autoclaw.web.authToken') || '';
                            const refreshToken = localStorage.getItem('autoclaw.web.refreshToken') || '';
                            const deviceId = localStorage.getItem('autoclaw.web.deviceId') || '';
                            const loginInfo = JSON.parse(localStorage.getItem('autoclaw.web.loginInfo') || '{}');
                            return { authToken, refreshToken, deviceId, loginInfo };
                        } catch { return null; }
                    }""")
                    if not data:
                        continue
                    if not data["authToken"] or not data["refreshToken"]:
                        continue
                    return {
                        "access_token": data["authToken"].replace("Bearer ", ""),
                        "refresh_token": data["refreshToken"].replace("Bearer ", ""),
                        "user_id": data["loginInfo"].get("user_id", ""),
                        "user_name": data["loginInfo"].get("user_name", ""),
                        "device_id": data["deviceId"] or "",
                    }
                except Exception:
                    continue
        except Exception:
            _log("Token monitor — context closed")
            return None
        await asyncio.sleep(0.5)

    _log("Token monitor — timed out")
    return None


async def _peek_success(token_monitor: asyncio.Task | None) -> dict | None:
    """Check if token monitor already resolved (short 200ms race)."""
    if not token_monitor or token_monitor.done():
        return None
    try:
        return await asyncio.wait_for(asyncio.shield(token_monitor), 0.2)
    except asyncio.TimeoutError:
        return None
    except Exception:
        return None


# ── Z.ai popup handlers ────────────────────────────────────────────────────────

async def _wait_for_zai_popup(context: BrowserContext, main_page: Page, timeout_ms: int, step_cb) -> tuple[Page, bool]:
    """Wait for Z.ai auth popup tab to open. Returns (popup_page, is_popup)."""
    started = time.monotonic()
    step_cb("waiting_zai_popup", "Waiting for Z.ai auth popup (0s)")

    existing = next((p for p in context.pages if p != main_page), None)
    if existing:
        step_cb("zai_popup_opened", "Z.ai popup already open — waiting for commit")
        try:
            await existing.wait_for_load_state("domcontentloaded", timeout=DOM_READY_TIMEOUT_MS)
        except Exception:
            pass
        return existing, True

    last_reported = -1
    while (time.monotonic() - started) * 1000 < timeout_ms:
        elapsed = int((time.monotonic() - started))
        if elapsed != last_reported:
            step_cb("waiting_zai_popup", f"Waiting for Z.ai auth popup ({elapsed}s)")
            last_reported = elapsed
        try:
            # Wait for new page event with short timeout
            popup = await asyncio.wait_for(
                context.wait_for_event("page"), timeout=2.0
            )
            if popup:
                step_cb("zai_popup_opened", f"Z.ai popup opened ({elapsed}s)")
                try:
                    await popup.wait_for_load_state("domcontentloaded", timeout=DOM_READY_TIMEOUT_MS)
                except Exception:
                    pass
                return popup, True
        except asyncio.TimeoutError:
            pass

    elapsed = int((time.monotonic() - started))
    step_cb("zai_same_tab", f"No popup after {elapsed}s — fallback to same tab")
    return main_page, False


async def _wait_for_zai_auth_ready(page: Page, timeout_ms: int, step_cb) -> bool:
    """Wait for Z.ai auth form or Google button to render."""
    ready_sel = ", ".join([
        'button:has-text("Continue with Google")', 'button:has-text("Google")',
        'a:has-text("Google")', '[role="button"]:has-text("Google")',
        'input[type="email"]', 'input[autocomplete="username"]',
        'input[placeholder*="Email" i]', 'button:has-text("Login")',
        'button:has-text("Sign in")',
    ])

    started = time.monotonic()
    last_reported = -1
    while (time.monotonic() - started) * 1000 < timeout_ms:
        elapsed = int((time.monotonic() - started))
        if elapsed != last_reported:
            step_cb("waiting_zai_auth_form", f"Waiting for Z.ai auth form ({elapsed}s)")
            last_reported = elapsed
        try:
            await page.wait_for_selector(ready_sel, state="visible", timeout=3_000)
            step_cb("zai_ready", f"Z.ai auth form ready ({elapsed}s)")
            return True
        except Exception:
            pass
    step_cb("zai_auth_form_timeout", f"Z.ai auth form did not render after {timeout_ms}ms")
    return False


# ── Main automation ────────────────────────────────────────────────────────────

async def _run_autoclaw_flow(
    page: Page,
    email: str,
    password: str,
    proxy_url: str | None = None,
    step_cb=None,
) -> dict:
    """Core AutoClaw login flow using Playwright."""

    def _step(step_id: str, message: str) -> None:
        _log(f"[{step_id}] {message}")
        if step_cb:
            step_cb(step_id, message)

    context = page.context

    # 0. Navigation to autoclaw.z.ai with retry
    nav_ok = False
    for attempt in range(1, MAX_NAV_RETRIES + 1):
        for strategy in ["domcontentloaded", "commit"]:
            _step("opening_autoclaw_web", f"Attempt {attempt}/{MAX_NAV_RETRIES} ({strategy})")
            try:
                await page.goto(AUTOCLAW_WEB_URL, wait_until=strategy, timeout=NAV_TIMEOUT_MS)
                nav_ok = True
                _step("opening_autoclaw_web", f"Loaded (attempt {attempt}, {strategy})")
                break
            except Exception as e:
                msg = str(e)[:120]
                _step("opening_autoclaw_web", f"Failed (attempt {attempt}): {msg}")
                await asyncio.sleep(2 + random.uniform(0, 2))
        if nav_ok:
            break

    if not nav_ok:
        _step("opening_autoclaw_web", "All navigation attempts failed — continuing to poll")

    if nav_ok:
        _step("autoclaw_web_dom_loading", "DOM ready — waiting for SPA render")
        await _wait_selector_visible(page, AUTOCLAW_LOGIN_BUTTON_SELECTORS, 10_000)

    # 1. Click login button
    login_clicked = await _poll_and_click(
        page, AUTOCLAW_LOGIN_BUTTON_SELECTORS, LOGIN_BUTTON_TIMEOUT_MS,
        "clicking_autoclaw_login", _step,
    )
    if not login_clicked:
        return {"status": "failed", "error": "Could not find AutoClaw login button. UI may have changed."}

    await _wait_selector_visible(page, AUTOCLAW_ZAI_BUTTON_SELECTORS, 8_000)

    # 2. Click "Continue with Zai"
    zai_clicked = await _poll_and_click(
        page, AUTOCLAW_ZAI_BUTTON_SELECTORS, ZAI_BUTTON_TIMEOUT_MS,
        "clicking_continue_with_zai", _step,
    )
    if not zai_clicked:
        return {"status": "failed", "error": "Could not find 'Continue with Zai' button."}

    # 3. Handle captcha on main page
    try:
        await page.wait_for_load_state("networkidle", timeout=5_000)
    except Exception:
        pass

    captcha_visible = False
    try:
        await page.wait_for_selector(".shumei_captcha_wrapper", state="visible", timeout=6_000)
        captcha_visible = True
    except Exception:
        captcha_visible = False

    if captcha_visible:
        _step("detected_captcha_main", "Shumei captcha detected — solving")
        solved = False
        for attempt in range(1, 4):
            _step("solving_captcha_main", f"Solving Shumei captcha attempt {attempt}/3")
            solved = await solve_shumei_captcha(page, timeout=20_000)
            if solved:
                break
            try:
                still = await page.locator(".shumei_captcha_wrapper").first.is_visible()
            except Exception:
                still = False
            if not still:
                solved = True
                break
            await asyncio.sleep(3)
        if solved:
            _step("solved_captcha_main", "Shumei captcha solved")
        else:
            _step("failed_captcha_main", "Shumei captcha auto-solve failed after 3 attempts")
            return {"status": "needs_manual", "error": "Shumei captcha auto-solve failed after 3 attempts."}
    else:
        _step("no_captcha_main", "No Shumei captcha — proceeding to popup")

    # 4. Wait for Z.ai popup
    popup, is_popup = await _wait_for_zai_popup(context, page, POPUP_WAIT_TIMEOUT_MS, _step)

    # 5. Wait for Z.ai auth form
    zai_ready = await _wait_for_zai_auth_ready(popup, ZAI_FORM_TIMEOUT_MS, _step)
    if not zai_ready:
        if is_popup and popup != page:
            try:
                await popup.close()
            except Exception:
                pass
        return {"status": "failed", "error": "Z.ai auth page did not render login form or Google button."}

    # 6. Deploy Google login loop on popup
    result = await _google_login_loop(popup, email, password, proxy_url, context, _step)

    # 7. Cleanup popup
    if is_popup and popup != page:
        try:
            await popup.close()
        except Exception:
            pass

    return result


async def _google_login_loop(
    page: Page,
    email: str,
    password: str,
    proxy_url: str | None,
    context: BrowserContext,
    step_cb,
) -> dict:
    """Main Google OAuth login loop — handles email, password, consent, onboarding, captcha."""

    start_time = time.monotonic()
    token_monitor = asyncio.create_task(_create_token_monitor(context, DEFAULT_MANUAL_TIMEOUT_MS))

    # Check for early token
    early = await _peek_success(token_monitor)
    if early:
        step_cb("autoclaw_token_extracted", "Token already present — skipping automation")
        token_monitor.cancel()
        return {"status": "success", **early}

    # Click "Continue with Google" on Z.ai
    await _handle_provider_login_gate(page, step_cb)

    # Fill email
    email_loc = await _wait_for_first_visible(page, EMAIL_INPUT_SELECTOR, 15_000)
    if email_loc:
        step_cb("entering_email", "Entering Google email")
        await page.mouse.move(_jitter(100, 400), _jitter(200, 300))
        await asyncio.sleep(random.uniform(0.15, 0.35))
        filled = await _fill_input_resilient(email_loc, email)
        if filled:
            step_cb("submitting_email", "Submitting email")
            await asyncio.sleep(random.uniform(0.2, 0.4))
            await _click_first_visible(page, NEXT_BUTTON_SELECTORS)
        else:
            step_cb("email_fill_failed", "Could not fill email field — retrying in loop")

    # Wait for navigation away from email page
    try:
        await page.wait_for_url(lambda url: "/identifier?" not in url, timeout=10_000)
    except Exception:
        pass
    await asyncio.sleep(1)

    # Main polling loop
    while (time.monotonic() - start_time) * 1000 < DEFAULT_SHORT_TIMEOUT_MS:
        # Check token monitor
        if token_monitor.done():
            try:
                tokens = await token_monitor
                if tokens:
                    step_cb("autoclaw_token_extracted", "AutoClaw token extracted from localStorage")
                    return {"status": "success", **tokens}
            except Exception:
                pass
            step_cb("oauth_timeout", "Timed out waiting for AutoClaw token")
            return {"status": "failed_timeout", "error": "Timed out waiting for AutoClaw authorization"}

        # Race: check token monitor every 800ms
        done, _ = await asyncio.wait([asyncio.shield(token_monitor)], timeout=0.8)
        if done:
            try:
                tokens = await token_monitor
                if tokens:
                    step_cb("autoclaw_token_extracted", "AutoClaw token extracted from localStorage")
                    return {"status": "success", **tokens}
            except Exception:
                pass
            step_cb("oauth_timeout", "Timed out waiting for AutoClaw token")
            return {"status": "failed_timeout", "error": "Timed out waiting for AutoClaw authorization"}

        try:
            current_url = page.url

            # Check if redirected back to autoclaw (waiting for token extraction)
            if "autoclaw.z.ai" in current_url:
                page_text = await _read_page_text(page)
                if _includes_any(page_text, SIGNIN_FAILED_MARKERS):
                    if not proxy_url:
                        step_cb("signin_failed_manual", "Sign-in failed, no proxy — manual assist needed")
                        token_monitor.cancel()
                        return {"status": "needs_manual",
                                "error": "AutoClaw sign-in failed. No proxy active — manual retry needed."}
                    step_cb("signin_failed_retry", "Sign-in failed — needs retry with fresh IP")
                    token_monitor.cancel()
                    return {"status": "needs_retry",
                            "error": "AutoClaw sign-in failed. Retry with fresh proxy IP."}
                await asyncio.sleep(1)
                continue

            # Google intermediate pages (SetSID, CheckCookie) — auto-redirect, just wait
            if "accounts.google." in current_url:
                text = await _read_page_text(page)
                if not text.strip():
                    step_cb("google_intermediate", "Google intermediate redirect — waiting")
                    await asyncio.sleep(1)
                    continue

            # Z.ai token URL page — wait for JS to process token, then redirect to autoclaw.z.ai
            if "chat.z.ai/auth" in current_url and "#token=" in current_url:
                step_cb("zai_token_page", "Z.ai token redirect — waiting for JS to process")
                # First, wait for page content to load (SPA/JS processing)
                for _ in range(10):
                    try:
                        text = await _read_page_text(page)
                        if text.strip():
                            step_cb("zai_token_loaded", "Z.ai token page content loaded")
                            break
                    except Exception:
                        pass
                    await asyncio.sleep(1)
                # Then wait for redirect to autoclaw.z.ai
                for _ in range(20):
                    try:
                        if "autoclaw.z.ai" in page.url:
                            step_cb("zai_token_redirected", "Redirected to autoclaw.z.ai — token monitor should extract")
                            break
                    except Exception:
                        pass
                    await asyncio.sleep(1)
                else:
                    step_cb("zai_token_timeout", "Z.ai token page did not redirect — token_monitor may still extract")
                continue

            # Provider login gate
            handled = await _handle_provider_login_gate(page, step_cb)
            if handled:
                continue

            # Google consent
            handled = await _handle_google_consent(page, step_cb)
            if handled:
                continue

            # Google re-verify
            handled = await _handle_google_reverify(page, step_cb)
            if handled:
                continue

            # Read page text for marker checks
            page_text = await _read_page_text(page)

            # Invalid credentials
            if _includes_any(page_text, INVALID_CREDENTIAL_MARKERS):
                step_cb("invalid_credentials", "Google rejected email or password")
                token_monitor.cancel()
                return {"status": "failed_invalid_credentials",
                        "error": "Google rejected the supplied email or password."}

            # Restricted account
            if _includes_any(page_text, RESTRICTED_ACCOUNT_MARKERS):
                step_cb("account_restricted", "Account restricted/suspended/banned")
                token_monitor.cancel()
                return {"status": "failed_restricted",
                        "error": "Account is restricted, suspended, or banned."}

            # Manual assist markers (captcha, 2FA)
            if _includes_any(page_text, MANUAL_ASSIST_MARKERS):
                # Try Shumei captcha auto-solve first
                try:
                        is_captcha = await page.locator(".shumei_captcha_wrapper").first.is_visible()
                except Exception:
                    is_captcha = False
                if is_captcha:
                    step_cb("detected_shumei_captcha", "Shumei captcha on Google login — auto-solving")
                    solved = await solve_shumei_captcha(page, timeout=10_000)
                    if solved:
                        step_cb("solved_shumei_captcha", "Shumei captcha solved — continuing")
                        continue
                    step_cb("failed_shumei_captcha", "Shumei solve failed — manual assist")
                step_cb("manual_assist_required", "CAPTCHA/2FA/recovery required")
                token_monitor.cancel()
                return {"status": "needs_manual",
                        "error": "Manual assist required (CAPTCHA, 2FA, recovery, or suspicious login)."}

            # Google onboarding
            handled = await _handle_google_onboarding(page, page_text)
            if handled:
                step_cb("google_onboarding", "Handled Google onboarding/privacy prompt")
                continue

            # Email input (retry)
            email_loc = await _wait_for_first_visible(page, EMAIL_INPUT_SELECTOR, 1_000)
            if email_loc:
                step_cb("entering_email", "Entering Google email (retry)")
                filled = await _fill_input_resilient(email_loc, email)
                if filled:
                    step_cb("submitting_email", "Submitting email")
                    await asyncio.sleep(random.uniform(0.2, 0.4))
                    await _click_first_visible(page, NEXT_BUTTON_SELECTORS)
                    await _wait_for_next_step(page, page.url, target_selectors=[PASSWORD_INPUT_SELECTOR], timeout_ms=10_000)
                continue

            # Password input
            pw_loc = await _wait_for_first_visible(page, PASSWORD_INPUT_SELECTOR, 1_000)
            if pw_loc:
                step_cb("entering_password", "Entering Google password")
                await asyncio.sleep(random.uniform(0.2, 0.5))
                await page.mouse.move(_jitter(100, 400), _jitter(200, 300))
                await asyncio.sleep(random.uniform(0.1, 0.3))
                filled = await _fill_input_resilient(pw_loc, password)
                if filled:
                    step_cb("submitting_password", "Submitting password")
                    await asyncio.sleep(random.uniform(0.2, 0.5))
                    await _click_first_visible(page, NEXT_BUTTON_SELECTORS)
                    await _wait_for_next_step(page, page.url, timeout_ms=10_000)

                    # After Google password submit, wait for redirect to Z.ai consent page
                    step_cb("waiting_zai_redirect", "Waiting for Z.ai redirect after password")
                    # Wait until we're on Z.ai consent page (not the intermediate #token= page)
                    for _ in range(30):  # max 30s
                        try:
                            current = page.url
                            if "z.ai" in current:
                                text = await _read_page_text(page)
                                if "would like to access your" in text.lower() or "autoglm" in text.lower():
                                    break
                        except Exception:
                            pass
                        await asyncio.sleep(1)
                    # Handle Z.ai consent
                    if await _handle_zai_authorize(page, step_cb):
                        step_cb("zai_consent_post_password", "Handled Z.ai consent after password")
                continue

            # Generic approve/continue click
            clicked = await _click_first_visible(page, APPROVE_BUTTON_SELECTORS)
            if clicked:
                step_cb("approving_consent", "Approving consent screen")
                await _wait_for_next_step(page, page.url, timeout_ms=5_000)
                continue

            # Nothing actionable — wait
            step_cb("waiting_next_screen", "Waiting for next screen")
            await asyncio.sleep(0.7)

        except Exception as e:
            msg = str(e).lower()
            if "closed" in msg or "destroyed" in msg or "target page" in msg:
                step_cb("manual_assist_required", f"Browser interrupted: {str(e)[:100]}")
                token_monitor.cancel()
                return {"status": "needs_manual",
                        "error": f"Browser session interrupted: {str(e)[:120]}"}
            raise

    token_monitor.cancel()
    step_cb("manual_assist_required", "Flow did not complete within timeout")
    return {"status": "needs_manual",
            "error": "Login flow did not complete automatically within the timeout period."}


# ── Public API ─────────────────────────────────────────────────────────────────

async def run_autoclaw_automation(
    email: str,
    password: str,
    *,
    proxy_url: str | None = None,
    device_id: str | None = None,
    engine: str = "chromium",
    step_cb=None,
) -> dict:
    """Run full AutoClaw automation flow. Returns status dict with tokens on success."""

    if engine == "cloakbrowser":
        return await _run_with_cloakbrowser(email, password, proxy_url, device_id, step_cb)

    proxy_config = None
    if proxy_url:
        proxy_config = {"server": proxy_url}

    browser_args = [
        "--disable-blink-features=AutomationControlled",
        "--no-sandbox",
        "--disable-setuid-sandbox",
    ]

    async with async_playwright() as p:
        browser: Browser = await p.chromium.launch(
            headless=True,
            args=browser_args,
        )
        context = await browser.new_context(
            proxy=proxy_config,
            viewport={"width": 1280, "height": 800},
            user_agent=(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/149.0.0.0 Safari/537.36"
            ),
            locale="en-US",
            timezone_id="Asia/Jakarta",
            geolocation={"latitude": -6.2, "longitude": 106.8},
            permissions=["geolocation"],
        )
        page = await context.new_page()

        try:
            result = await _run_autoclaw_flow(page, email, password, proxy_url, step_cb)
            return result
        finally:
            await context.close()
            await browser.close()


async def _run_with_cloakbrowser(
    email: str,
    password: str,
    proxy_url: str | None,
    device_id: str | None,
    step_cb,
) -> dict:
    """Run with CloakBrowser anti-detect engine via cloakbrowser pip package."""
    from cloakbrowser import launch_async

    launch_opts: dict[str, Any] = {
        "headless": True,
        "humanize": True,
    }
    if proxy_url:
        launch_opts["proxy"] = proxy_url
        launch_opts["geoip"] = True

    browser = await launch_async(**launch_opts)
    context = await browser.new_context(
        viewport={"width": 1280, "height": 800},
        locale="en-US",
    )
    page = await context.new_page()

    try:
        return await _run_autoclaw_flow(page, email, password, proxy_url, step_cb)
    finally:
        await context.close()
        await browser.close()


# ── SQLite persistence ────────────────────────────────────────────────────────

DB_SCHEMA = """
CREATE TABLE IF NOT EXISTS providerConnections (
    id TEXT PRIMARY KEY,
    provider TEXT NOT NULL,
    authType TEXT NOT NULL DEFAULT 'access_token',
    name TEXT,
    email TEXT,
    priority INTEGER,
    isActive INTEGER DEFAULT 1,
    data TEXT DEFAULT '{}',
    createdAt TEXT,
    updatedAt TEXT
);
CREATE INDEX IF NOT EXISTS idx_provider ON providerConnections(provider);
CREATE INDEX IF NOT EXISTS idx_active ON providerConnections(isActive);
"""


def save_tokens_to_db(db_path: str, result: dict, device_id: str | None = None) -> str:
    """Save extracted tokens to SQLite database. Returns connection ID."""
    conn_id = str(uuid.uuid4())
    now = time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime())
    device = device_id or result.get("device_id") or str(uuid.uuid4())

    conn = sqlite3.connect(db_path)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.executescript(DB_SCHEMA)

    data = {
        "accessToken": result["access_token"],
        "refreshToken": result["refresh_token"],
        "expiresAt": time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime(time.time() + 86400)),
        "testStatus": "active",
        "lastRefreshAt": now,
        "providerSpecificData": {
            "deviceId": device,
            "userName": result.get("user_name", ""),
            "refreshExpiresAt": time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime(time.time() + 2592000)),
            "importedAt": now,
        },
    }

    conn.execute(
        """INSERT INTO providerConnections(id, provider, authType, name, email, priority, isActive, data, createdAt, updatedAt)
           VALUES(?, 'autoclaw', 'access_token', ?, ?, 1, 1, ?, ?, ?)""",
        [
            conn_id,
            result.get("user_name") or f"autoclaw-{result.get('user_id', 'import')}",
            result.get("user_id") or "unknown",
            json.dumps(data),
            now,
            now,
        ],
    )
    conn.commit()
    conn.close()

    _log(f"Saved connection {conn_id} to {db_path}")
    return conn_id


# ── CLI entry ──────────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(description="AutoClaw OAuth automation")
    parser.add_argument("email", help="Google email")
    parser.add_argument("password", help="Google password")
    parser.add_argument("--proxy", default=os.environ.get("PROXY_URL"), help="Proxy URL (http://user:pass@host:port)")
    parser.add_argument("--device-id", help="Device ID (auto-generated if blank)")
    parser.add_argument("--db", help="SQLite DB path (e.g. ~/.9router/data.db) — saves tokens on success")
    parser.add_argument("--engine", choices=["chromium", "cloakbrowser"], default="chromium",
                        help="Browser engine (default: chromium)")
    args = parser.parse_args()

    async def _run() -> None:
        result = await run_autoclaw_automation(
            email=args.email,
            password=args.password,
            proxy_url=args.proxy,
            device_id=args.device_id,
            engine=args.engine,
        )

        # Save to DB on success
        if result.get("status") == "success" and args.db:
            try:
                conn_id = save_tokens_to_db(args.db, result, args.device_id)
                result["connection_id"] = conn_id
            except Exception as e:
                _log(f"Failed to save to DB: {e}")
                result["db_error"] = str(e)

        _output(result)

    asyncio.run(_run())


if __name__ == "__main__":
    main()
