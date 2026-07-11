#!/usr/bin/env python3
"""
Cloudflare signup + email verification + API token creation.
Uses CloakBrowser (primary) or Playwright Chromium (fallback).
OpenCV visual template matching for Turnstile checkbox (same approach as nodriver).

Usage:
    python3 cf_signup.py --email foo@bar.com --password Pass123 \\
        --mail-api https://mail.tandatangan.io --engine cloakbrowser --proxy http://... --headless

Outputs JSON to stdout:
    {"success": true, "account_id": "abc...", "api_token": "...", "error": ""}
"""

import argparse
import asyncio
import base64
import json
import os
import re
import sys
import time
import urllib.request
import socket

socket.setdefaulttimeout(10)

# ── Cloudflare Turnstile checkbox template (111×71, built-in from nodriver) ───
CF_TEMPLATE_B64 = (
    "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"
    "YII="
)

# ── email polling (unchanged, uses urllib, no browser dependency) ──────────────

async def poll_verification_email(mail_api: str, email: str, signup_started_at: float, timeout_sec: int = 120) -> str:
    """Poll CF Email Worker for verification email. Only considers messages after signup_started_at."""
    base = mail_api.rstrip("/")
    poll_url = f"{base}/api/messages?addr={email}"
    print(f"[verify] polling {poll_url}", file=sys.stderr)

    deadline = time.time() + timeout_sec
    while time.time() < deadline:
        await asyncio.sleep(3)
        try:
            req = urllib.request.Request(poll_url)
            req.add_header("Accept", "application/json")
            req.add_header("User-Agent", "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36")
            with urllib.request.urlopen(req, timeout=10) as resp:
                raw = resp.read().decode()
                messages = json.loads(raw)
            if not isinstance(messages, list):
                print(f"[verify] unexpected response type: {type(messages)}", file=sys.stderr)
                continue
            recent = [m for m in messages if m.get("receivedAt", "") and m["receivedAt"] >= time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(signup_started_at))]
            recent.sort(key=lambda m: m.get("receivedAt", ""), reverse=True)
            print(f"[verify] {len(messages)} total, {len(recent)} after signup for {email}", file=sys.stderr)
            if not recent:
                continue
            for idx, msg in enumerate(recent):
                body_text = msg.get("text") or ""
                body_html = msg.get("html") or ""
                body_lower = (body_text or body_html).lower()
                subj_lower = (msg.get("subject") or "").lower()
                if "verify" not in subj_lower and "verify" not in body_lower:
                    continue
                m = re.search(r"https?://dash\.cloudflare\.com/email-verification[^\s\"'>]+", body_text)
                if m:
                    print(f"[verify] found link in message {idx} (text)", file=sys.stderr)
                    return m.group(0)
                m = re.search(r"https?://dash\.cloudflare\.com/email-verification[^\s\"'>]+", body_html)
                if m:
                    print(f"[verify] found link in message {idx} (html)", file=sys.stderr)
                    return m.group(0)
        except urllib.error.HTTPError as e:
            print(f"[verify] HTTP {e.code} from mail API", file=sys.stderr)
        except urllib.error.URLError as e:
            print(f"[verify] URL error: {e.reason}", file=sys.stderr)
        except json.JSONDecodeError:
            print(f"[verify] invalid JSON from mail API", file=sys.stderr)
        except Exception as e:
            print(f"[verify] error: {e}", file=sys.stderr)
    print(f"[verify] timeout after {timeout_sec}s", file=sys.stderr)
    return ""


# ── Page helpers (Playwright API) ─────────────────────────────────────────────

async def _send_preview(page, step: str) -> None:
    """Take screenshot and pipe base64 to stderr for dashboard live preview."""
    try:
        scr = await page.screenshot(type="jpeg", quality=30)
        b64 = base64.b64encode(scr).decode()
        print(f"[preview] {step} {b64}", file=sys.stderr, flush=True)
    except Exception as e:
        print(f"[preview] error: {e}", file=sys.stderr)


async def _click_css(page, sel: str, timeout: int = 5) -> bool:
    try:
        await page.locator(sel).first.click(timeout=timeout * 1000)
        return True
    except Exception:
        return False


async def _fill_css(page, sel: str, text: str, timeout: int = 5) -> bool:
    try:
        el = page.locator(sel).first
        await el.click(timeout=timeout * 1000)
        await asyncio.sleep(0.3)
        await el.fill(text)
        return True
    except Exception:
        return False


async def _click_text(page, texts: list, timeout: int = 5) -> bool:
    for txt in texts:
        try:
            await page.get_by_text(txt, exact=False).first.click(timeout=timeout * 1000)
            return True
        except Exception:
            pass
    return False


async def _try_any(page, css_selectors: list, text_labels: list, timeout: int = 5) -> bool:
    for sel in css_selectors:
        if await _click_css(page, sel, timeout):
            return True
    return await _click_text(page, text_labels, timeout)


# ── Turnstile solver (OpenCV template matching, same approach as nodriver) ────

async def _verify_cf(page, timeout: int = 30) -> None:
    """Solve Cloudflare Turnstile checkbox using visual template matching."""
    import cv2
    import numpy as np

    template_bytes = base64.b64decode(CF_TEMPLATE_B64)
    template = cv2.imdecode(np.frombuffer(template_bytes, np.uint8), cv2.IMREAD_GRAYSCALE)
    if template is None:
        print("[turnstile] failed to decode CF template", file=sys.stderr)
        raise Exception("Failed to decode CF Turnstile template")

    th, tw = template.shape[:2]
    deadline = time.time() + timeout
    last_clicked = 0.0

    while time.time() < deadline:
        await asyncio.sleep(2)

        # Already solved?
        try:
            solved = await page.evaluate("""(() => {
                const inp = document.querySelector('[name="cf-turnstile-response"]');
                if (inp && inp.value && inp.value.length > 0) return true;
                try {
                    const widgets = window.turnstile?.getResponse?.();
                    if (widgets) return true;
                } catch {}
                const frame = document.querySelector('iframe[src*="challenges.cloudflare.com"]');
                if (frame) {
                    try {
                        const doc = frame.contentDocument || frame.contentWindow?.document;
                        if (doc && doc.querySelector('[aria-checked="true"]')) return true;
                    } catch {}
                }
                return false;
            })()""")
            if solved:
                print("[turnstile] already solved", file=sys.stderr)
                return
        except Exception:
            pass

        # Scroll turnstile into viewport
        try:
            await page.locator('.cf-turnstile, iframe[src*="challenges.cloudflare.com"]').first.scroll_into_view_if_needed(timeout=2000)
            await asyncio.sleep(1)
        except Exception:
            pass

        # Take screenshot and match template
        scr_bytes = await page.screenshot(type="png")
        scr = cv2.imdecode(np.frombuffer(scr_bytes, np.uint8), cv2.IMREAD_GRAYSCALE)
        if scr is None:
            continue

        h, w = scr.shape[:2]
        if h < th or w < tw:
            print(f"[turnstile] screenshot too small ({w}x{h} < {tw}x{th})", file=sys.stderr)
            continue

        scales = [1.0]
        if h > 1000:
            scales = [0.5, 0.75, 1.0]

        best_val, best_x, best_y, best_scale = 0, 0, 0, 1.0

        for scale in scales:
            if scale == 1.0:
                scr_s = scr
            else:
                scr_s = cv2.resize(scr, (int(w * scale), int(h * scale)))
            result = cv2.matchTemplate(scr_s, template, cv2.TM_CCOEFF_NORMED)
            _, max_v, _, max_l = cv2.minMaxLoc(result)
            if max_v > best_val:
                best_val = max_v
                best_x = int(max_l[0] / scale)
                best_y = int(max_l[1] / scale)
                best_scale = scale

        if best_val > 0.55:
            cx = best_x + tw // 2
            cy = best_y + th // 2
            print(f"[turnstile] match at ({cx},{cy}) conf={best_val:.2f} scale={best_scale}", file=sys.stderr)

            if time.time() - last_clicked > 4:
                await page.mouse.click(cx, cy)
                last_clicked = time.time()
                print("[turnstile] clicked checkbox, waiting...", file=sys.stderr)
                await asyncio.sleep(5)

            # ponytail: after click, return immediately. caller's retry loop handles edge case.
            return

        # DOM fallback: try clicking the iframe directly
        if best_val <= 0.55:
            print(f"[turnstile] no template match (best={best_val:.2f}), trying DOM", file=sys.stderr)
            try:
                await page.locator('iframe[src*="challenges.cloudflare.com"]').first.click(timeout=3000)
                await asyncio.sleep(3)
                return
            except Exception:
                pass

    # Final check
    try:
        solved = await page.evaluate("""(() => {
            const inp = document.querySelector('[name="cf-turnstile-response"]');
            if (inp && inp.value && inp.value.length > 0) return true;
            try { return !!window.turnstile?.getResponse?.(); } catch { return false; }
        })()""")
        if solved:
            return
    except Exception:
        pass

    raise Exception("Turnstile not solved within timeout")


# ── Main flow ─────────────────────────────────────────────────────────────────

async def signup_complete(email: str, password: str, proxy: str,
                          headless: bool, mail_api: str, token_name: str,
                          engine: str = "cloakbrowser") -> dict:
    if engine == "nodriver":
        return await _signup_nodriver(email, password, proxy, headless, mail_api, token_name)
    return await _signup_playwright(email, password, proxy, headless, mail_api, token_name, engine)


async def _signup_nodriver(email: str, password: str, proxy: str,
                            headless: bool, mail_api: str, token_name: str) -> dict:
    """Original nodriver flow with native verify_cf(). No OpenCV needed."""
    import nodriver as uc

    browser = None
    signup_started_at = time.time()
    try:
        chrome_path = None
        cb_dir = os.path.expanduser("~/.cloakbrowser")
        if os.path.isdir(cb_dir):
            for d in sorted(os.listdir(cb_dir), reverse=True):
                candidate = os.path.join(cb_dir, d, "chrome")
                if os.path.isfile(candidate) and os.access(candidate, os.X_OK):
                    chrome_path = candidate
                    break
        if not chrome_path:
            for name in ("google-chrome", "google-chrome-stable", "chromium", "chromium-browser"):
                p = os.popen(f"which {name} 2>/dev/null").read().strip()
                if p:
                    chrome_path = p
                    break

        browser = await uc.start(
            headless="new" if headless else False,
            lang="en-US", proxy=proxy,
            sandbox=False, browser_executable_path=chrome_path,
        )
        page = await browser.get("https://dash.cloudflare.com/sign-up")
        await asyncio.sleep(8)

        # fill form
        email_input = await page.select('input[name="email"]', timeout=15)
        if not email_input:
            return {"success": False, "error": "Email input not found"}
        await email_input.click()
        await asyncio.sleep(0.5)
        await email_input.send_keys(email)
        await asyncio.sleep(1)

        pw_input = await page.select('input[name="password"]', timeout=5)
        if not pw_input:
            return {"success": False, "error": "Password input not found"}
        await pw_input.click()
        await asyncio.sleep(0.5)
        await pw_input.send_keys(password)
        await asyncio.sleep(2)

        await page.evaluate("window.scrollBy(0, 400)")
        await asyncio.sleep(3)

        # Turnstile — native nodriver solver
        for attempt in range(3):
            try:
                await page.verify_cf()
                await asyncio.sleep(5)
                break
            except Exception as e:
                if attempt == 2:
                    print(f"Turnstile attempt {attempt+1} failed: {e}", file=sys.stderr)
                await asyncio.sleep(3)

        # send preview
        await _send_preview_nodriver(page, "turnstile_solved")

        submit_btn = await page.select('button[type="submit"]', timeout=5)
        if not submit_btn:
            return {"success": False, "error": "Submit button not found"}
        await submit_btn.scroll_into_view()
        await asyncio.sleep(1)
        await submit_btn.click()

        account_id = None
        for _ in range(30):
            await asyncio.sleep(1)
            url = await page.evaluate("location.href")
            if "/sign-up" not in url:
                match = re.search(r"/([a-f0-9]{32})", url)
                if match:
                    account_id = match.group(1)
                break
        await asyncio.sleep(5)
        if not account_id:
            url = await page.evaluate("location.href")
            match = re.search(r"/([a-f0-9]{32})", url)
            if match:
                account_id = match.group(1)
        if not account_id:
            url = await page.evaluate("location.href")
            error_msgs = await page.evaluate("""
                Array.from(document.querySelectorAll('p, [role="alert"]'))
                    .map(e => e.textContent.trim())
                    .filter(t => t.includes('unable') || t.includes('limit') || t.includes('Incorrect'))
            """)
            error = error_msgs[0] if error_msgs else f"Redirect failed: {url[:80]}"
            return {"success": False, "error": error}

        if mail_api:
            print("Polling for verification email (max 120s)...", file=sys.stderr)
            verify_link = await poll_verification_email(mail_api, email, signup_started_at, timeout_sec=120)
            if verify_link:
                print("Clicking verify link...", file=sys.stderr)
                await page.get(verify_link)
                await asyncio.sleep(5)
                await _send_preview_nodriver(page, "email_verified")
            else:
                return {"success": False, "error": "Verification email not found after 120s — cannot proceed", "account_id": account_id}

        await asyncio.sleep(2)
        url = await page.evaluate("location.href")
        match = re.search(r"dash\.cloudflare\.com/([a-f0-9]{20,})", url)
        if match:
            account_id = match.group(1)

        if "/login" in url.lower() or "/sign-in" in url.lower():
            print("Login needed, entering credentials...", file=sys.stderr)
            await page.get("https://dash.cloudflare.com/login")
            await asyncio.sleep(3)
            for sel in ['input[type="email"]', 'input[name="email"]', 'input#email']:
                try:
                    el = await page.select(sel, timeout=3)
                    if el:
                        await el.click()
                        await asyncio.sleep(0.3)
                        await el.send_keys(email)
                        break
                except Exception:
                    pass
            await asyncio.sleep(0.5)
            for txt in ["Continue", "Next", "Sign in"]:
                try:
                    el = await page.find(txt, timeout=3)
                    if el:
                        await el.click()
                        break
                except Exception:
                    pass
            await asyncio.sleep(2)
            for sel in ['input[type="password"]', 'input[name="password"]', 'input#password']:
                try:
                    el = await page.select(sel, timeout=3)
                    if el:
                        await el.click()
                        await asyncio.sleep(0.3)
                        await el.send_keys(password)
                        break
                except Exception:
                    pass
            await asyncio.sleep(0.5)
            for txt in ["Sign in", "Log in", "Continue"]:
                try:
                    el = await page.find(txt, timeout=3)
                    if el:
                        await el.click()
                        break
                except Exception:
                    pass
            await asyncio.sleep(5)

        await page.get(f"https://dash.cloudflare.com/{account_id}/ai/workers-ai/api-quick-start")
        await asyncio.sleep(5)

        print("Creating API token...", file=sys.stderr)
        clicked = False
        create_labels = [
            "Create a Workers AI API Token",
            "Create API Token",
            "Create Token",
            "Get started",
        ]
        for attempt_num in range(15):
            try:
                for txt in create_labels:
                    el = await page.find(txt, timeout=3)
                    if el:
                        await el.click()
                        clicked = True
                        break
            except Exception:
                pass
            if clicked:
                break
            try:
                found = await page.evaluate("""
                    (() => {
                        const labels = ['Create a Workers AI API Token','Create API Token','Create Token','Get started'];
                        for (const txt of labels) {
                            for (const el of document.querySelectorAll('a, button, span, div[role="button"]')) {
                                if (el.textContent.trim().toLowerCase().includes(txt.toLowerCase())) {
                                    el.click();
                                    return 'clicked: ' + txt;
                                }
                            }
                        }
                        return 'not found';
                    })()
                """)
                if found.startswith("clicked"):
                    clicked = True
                    print(f"JS click: {found}", file=sys.stderr)
                    break
            except Exception:
                pass
            await asyncio.sleep(2)

        if not clicked:
            return {"success": False, "error": "Could not find 'Create a Workers AI API Token' button", "account_id": account_id}

        await asyncio.sleep(2)

        for sel in ['input[name="tokenName"]', 'input[type="text"]']:
            try:
                el = await page.select(sel, timeout=3)
                if el:
                    await el.click()
                    await asyncio.sleep(0.3)
                    await el.send_keys(token_name)
                    break
            except Exception:
                pass
        await asyncio.sleep(0.5)

        print("Clicking 'Create API Token' to finalize...", file=sys.stderr)
        for _ in range(5):
            try:
                for txt in ["Create API Token", "Create Token", "Create"]:
                    el = await page.find(txt, timeout=3)
                    if el:
                        await el.click()
                        clicked = True
                        break
            except Exception:
                pass
            if clicked:
                break
            await asyncio.sleep(1)
        await asyncio.sleep(3)

        api_token = None
        try:
            copy_btn = await page.find("Copy API Token", timeout=15)
            if copy_btn:
                await copy_btn.click()
                await asyncio.sleep(0.8)
        except Exception:
            pass

        try:
            html = await page.evaluate("document.body.innerText")
            m = re.search(r'([A-Za-z0-9_-]{40,})', html)
            if m:
                candidate = m.group(1)
                if "cloudflare" not in candidate.lower() and len(candidate) >= 40:
                    api_token = candidate
        except Exception:
            pass

        if not api_token:
            try:
                token_el = await page.select('code, pre, [data-testid*="token"], input[readonly]', timeout=3)
                if token_el:
                    api_token = await token_el.evaluate("el => el.textContent || el.value")
            except Exception:
                pass

        if not api_token:
            return {"success": False, "error": "Could not capture API token", "account_id": account_id}

        print(f"Captured token: {api_token[:12]}...", file=sys.stderr)
        await _send_preview_nodriver(page, "token_created")

        return {
            "success": True,
            "account_id": account_id,
            "api_token": api_token.strip(),
            "error": "",
        }

    except Exception as e:
        return {"success": False, "error": str(e)}
    finally:
        if browser:
            try:
                browser.stop()
            except Exception:
                pass
            await asyncio.sleep(2)


async def _send_preview_nodriver(page, step: str) -> None:
    """Capture screenshot via nodriver and pipe to stderr."""
    try:
        await page.save_screenshot("/tmp/cf_preview.jpg")
        if os.path.isfile("/tmp/cf_preview.jpg"):
            with open("/tmp/cf_preview.jpg", "rb") as f:
                b64 = base64.b64encode(f.read()).decode()
            print(f"[preview] {step} {b64}", file=sys.stderr, flush=True)
            os.unlink("/tmp/cf_preview.jpg")
    except Exception as e:
        print(f"[preview] error: {e}", file=sys.stderr, flush=True)


async def _signup_playwright(email: str, password: str, proxy: str,
                              headless: bool, mail_api: str, token_name: str,
                              engine: str = "cloakbrowser") -> dict:
    browser_obj = None
    play_obj = None
    context = None
    signup_started_at = time.time()

    try:
        # ── browser launch ──
        if engine == "cloakbrowser":
            try:
                from cloakbrowser import launch_async
            except ImportError:
                print("[browser] cloakbrowser not installed, falling back to playwright chromium", file=sys.stderr)
                engine = "chromium"

        if engine == "cloakbrowser":
            launch_opts = {"headless": headless, "humanize": True}
            if proxy:
                launch_opts["proxy"] = proxy
                launch_opts["geoip"] = True
            browser_obj = await launch_async(**launch_opts)
            context = await browser_obj.new_context(
                viewport={"width": 1280, "height": 800},
                locale="en-US",
            )
            page = await context.new_page()
            print("[browser] CloakBrowser launched", file=sys.stderr)
        else:
            from playwright.async_api import async_playwright
            play_obj = await async_playwright().start()
            browser_obj = await play_obj.chromium.launch(
                headless=headless,
                args=[
                    "--disable-blink-features=AutomationControlled",
                    "--no-sandbox",
                    "--disable-setuid-sandbox",
                ],
            )
            ctx_opts = {
                "viewport": {"width": 1280, "height": 800},
                "locale": "en-US",
                "user_agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36",
            }
            if proxy:
                ctx_opts["proxy"] = {"server": proxy}
            context = await browser_obj.new_context(**ctx_opts)
            page = await context.new_page()
            print("[browser] Playwright Chromium launched", file=sys.stderr)

        # ── navigate to signup ──
        await page.goto("https://dash.cloudflare.com/sign-up", wait_until="domcontentloaded", timeout=60_000)
        await asyncio.sleep(8)

        # ── SIGNUP FORM ──
        email_input = page.locator('input[name="email"]')
        try:
            await email_input.wait_for(timeout=15_000)
        except Exception:
            return {"success": False, "error": "Email input not found"}
        await email_input.click()
        await asyncio.sleep(0.5)
        await email_input.fill(email)
        await asyncio.sleep(1)

        pw_input = page.locator('input[name="password"]')
        try:
            await pw_input.wait_for(timeout=5_000)
        except Exception:
            return {"success": False, "error": "Password input not found"}
        await pw_input.click()
        await asyncio.sleep(0.5)
        await pw_input.fill(password)
        await asyncio.sleep(2)

        await page.evaluate("window.scrollBy(0, 400)")
        await asyncio.sleep(3)

        # ── TURNSTILE ──
        for attempt in range(3):
            try:
                await _verify_cf(page, timeout=30)
                await asyncio.sleep(5)
                break
            except Exception as e:
                if attempt == 2:
                    print(f"Turnstile attempt {attempt+1} failed: {e}", file=sys.stderr)
                await asyncio.sleep(3)

        await _send_preview(page, "turnstile_solved")

        # ── SUBMIT ──
        submit_btn = page.locator('button[type="submit"]')
        try:
            await submit_btn.wait_for(timeout=5_000)
        except Exception:
            return {"success": False, "error": "Submit button not found"}
        await submit_btn.scroll_into_view_if_needed()
        await asyncio.sleep(1)
        await submit_btn.click()

        # ── POLL FOR ACCOUNT ID ──
        account_id = None
        for _ in range(30):
            await asyncio.sleep(1)
            url = await page.evaluate("location.href")
            if "/sign-up" not in url:
                match = re.search(r"/([a-f0-9]{32})", url)
                if match:
                    account_id = match.group(1)
                break
        await asyncio.sleep(5)
        if not account_id:
            url = await page.evaluate("location.href")
            match = re.search(r"/([a-f0-9]{32})", url)
            if match:
                account_id = match.group(1)
        if not account_id:
            url = await page.evaluate("location.href")
            error_msgs = await page.evaluate("""
                Array.from(document.querySelectorAll('p, [role="alert"]'))
                    .map(e => e.textContent.trim())
                    .filter(t => t.includes('unable') || t.includes('limit') || t.includes('Incorrect'))
            """)
            error = error_msgs[0] if error_msgs else f"Redirect failed: {url[:80]}"
            return {"success": False, "error": error}

        # ── EMAIL VERIFICATION ──
        if mail_api:
            print("Polling for verification email (max 120s)...", file=sys.stderr)
            verify_link = await poll_verification_email(mail_api, email, signup_started_at, timeout_sec=120)
            if verify_link:
                print("Clicking verify link...", file=sys.stderr)
                await page.goto(verify_link, wait_until="domcontentloaded", timeout=30_000)
                await asyncio.sleep(5)
                await _send_preview(page, "email_verified")
            else:
                return {"success": False, "error": "Verification email not found after 120s — cannot proceed",
                        "account_id": account_id}

        # ── CHECK IF ALREADY ON DASHBOARD ──
        await asyncio.sleep(2)
        url = await page.evaluate("location.href")
        match = re.search(r"dash\.cloudflare\.com/([a-f0-9]{20,})", url)
        if match:
            account_id = match.group(1)

        # ── LOGIN IF NEEDED ──
        if "/login" in url.lower() or "/sign-in" in url.lower():
            print("Login needed, entering credentials...", file=sys.stderr)
            await page.goto("https://dash.cloudflare.com/login", wait_until="domcontentloaded", timeout=30_000)
            await asyncio.sleep(3)
            for sel in ['input[type="email"]', 'input[name="email"]', 'input#email']:
                if await _fill_css(page, sel, email):
                    break
            await asyncio.sleep(0.5)
            await _click_text(page, ["Continue", "Next", "Sign in"])
            await asyncio.sleep(2)
            for sel in ['input[type="password"]', 'input[name="password"]', 'input#password']:
                if await _fill_css(page, sel, password):
                    break
            await asyncio.sleep(0.5)
            await _click_text(page, ["Sign in", "Log in", "Continue"])
            await asyncio.sleep(5)

        # ── CREATE API TOKEN ──
        await page.goto(f"https://dash.cloudflare.com/{account_id}/ai/workers-ai/api-quick-start",
                        wait_until="domcontentloaded", timeout=30_000)
        await asyncio.sleep(5)

        print("Creating API token...", file=sys.stderr)
        clicked = False
        create_labels = [
            "Create a Workers AI API Token",
            "Create API Token",
            "Create Token",
            "Get started",
        ]
        for attempt_num in range(15):
            if await _click_text(page, create_labels, timeout=3):
                clicked = True
                print(f"Clicked create button on attempt {attempt_num+1}", file=sys.stderr)
                break
            try:
                found = await page.evaluate("""
                    (() => {
                        const labels = ['Create a Workers AI API Token','Create API Token','Create Token','Get started'];
                        for (const txt of labels) {
                            for (const el of document.querySelectorAll('a, button, span, div[role="button"]')) {
                                if (el.textContent.trim().toLowerCase().includes(txt.toLowerCase())) {
                                    el.click();
                                    return 'clicked: ' + txt;
                                }
                            }
                        }
                        return 'not found';
                    })()
                """)
                if found.startswith("clicked"):
                    clicked = True
                    print(f"JS click: {found}", file=sys.stderr)
                    break
            except Exception:
                pass
            await asyncio.sleep(2)

        if not clicked:
            return {"success": False, "error": "Could not find 'Create a Workers AI API Token' button",
                    "account_id": account_id}

        await asyncio.sleep(2)

        for sel in ['input[name="tokenName"]', 'input[type="text"]']:
            if await _fill_css(page, sel, token_name):
                break
        await asyncio.sleep(0.5)

        print("Clicking 'Create API Token' to finalize...", file=sys.stderr)
        for _ in range(5):
            if await _click_text(page, ["Create API Token", "Create Token", "Create"], timeout=3):
                break
            try:
                await page.evaluate("""
                    (() => {
                        for (const el of document.querySelectorAll('button, a, span[role="button"]')) {
                            if (el.textContent.trim().toLowerCase().includes('create api token')) {
                                el.click(); return true;
                            }
                        }
                        for (const el of document.querySelectorAll('button, a, span[role="button"]')) {
                            if (el.textContent.trim().toLowerCase().includes('create token')) {
                                el.click(); return true;
                            }
                        }
                        return false;
                    })()
                """)
                break
            except Exception:
                pass
            await asyncio.sleep(1)
        await asyncio.sleep(3)

        # ── CAPTURE TOKEN ──
        api_token = None
        try:
            await page.get_by_text("Copy API Token", exact=False).first.click(timeout=15_000)
            await asyncio.sleep(0.8)
        except Exception:
            pass

        try:
            html = await page.evaluate("document.body.innerText")
            m = re.search(r'([A-Za-z0-9_-]{40,})', html)
            if m:
                candidate = m.group(1)
                if "cloudflare" not in candidate.lower() and len(candidate) >= 40:
                    api_token = candidate
        except Exception:
            pass

        if not api_token:
            try:
                loc = page.locator('code, pre, [data-testid*="token"], input[readonly]').first
                api_token = await loc.evaluate("el => el.textContent || el.value")
            except Exception:
                pass

        if not api_token:
            return {"success": False, "error": "Could not capture API token", "account_id": account_id}

        print(f"Captured token: {api_token[:12]}...", file=sys.stderr)

        await _send_preview(page, "token_created")

        return {
            "success": True,
            "account_id": account_id,
            "api_token": api_token.strip(),
            "error": "",
        }

    except Exception as e:
        return {"success": False, "error": str(e)}
    finally:
        if context:
            try:
                await context.close()
            except Exception:
                pass
        if browser_obj:
            try:
                await browser_obj.close()
            except Exception:
                pass
        if play_obj:
            try:
                await play_obj.stop()
            except Exception:
                pass
        await asyncio.sleep(2)


def main():
    parser = argparse.ArgumentParser(description="Cloudflare signup + verify + token creation")
    parser.add_argument("--email", required=True)
    parser.add_argument("--password", required=True)
    parser.add_argument("--mail-api", default="", help="CF Email Worker URL for verification")
    parser.add_argument("--token-name", default="9router-workers-ai", help="API token name")
    parser.add_argument("--proxy", default=None)
    parser.add_argument("--headless", action="store_true")
    parser.add_argument("--engine", choices=["chromium", "cloakbrowser", "nodriver"], default="cloakbrowser",
                        help="Browser engine (default: cloakbrowser)")
    args = parser.parse_args()

    result = asyncio.run(signup_complete(
        args.email, args.password, args.proxy,
        args.headless, args.mail_api, args.token_name,
        args.engine,
    ))
    print(json.dumps(result))


if __name__ == "__main__":
    main()
