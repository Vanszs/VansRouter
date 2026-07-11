#!/usr/bin/env python3
"""
Cloudflare signup + email verification + API token creation via nodriver.
Single browser session — no Playwright needed.

Usage:
    python3 cf_signup.py --email foo@bar.com --password Pass123 \\
        --mail-api https://mail.tandatangan.io --proxy http://... --headless

Outputs JSON to stdout:
    {"success": true, "account_id": "abc...", "api_token": "...", "error": ""}
"""

import argparse
import asyncio
import json
import re
import sys
import os
import time

import urllib.request
import socket

# prevent DNS/connect hang blocking the event loop
socket.setdefaulttimeout(10)

import nodriver as uc


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


async def click_css(page, sel: str, timeout: int = 5) -> bool:
    """Click first element matching CSS selector. Returns True if clicked."""
    try:
        el = await page.select(sel, timeout=timeout)
        if el:
            await el.click()
            return True
    except Exception:
        pass
    return False


async def fill_css(page, sel: str, text: str, timeout: int = 5) -> bool:
    """Fill first element matching CSS selector. Returns True if filled."""
    try:
        el = await page.select(sel, timeout=timeout)
        if el:
            await el.click()
            await asyncio.sleep(0.3)
            await el.send_keys(text)
            return True
    except Exception:
        pass
    return False


async def click_text(page, texts: list, timeout: int = 5) -> bool:
    """Find and click element by visible text. Returns True if clicked."""
    for txt in texts:
        try:
            el = await page.find(txt, timeout=timeout)
            if el:
                await el.click()
                return True
        except Exception:
            pass
    return False


async def try_any(page, css_selectors: list, text_labels: list, timeout: int = 5) -> bool:
    """Try CSS selectors first, then text labels. Returns True if any clicked."""
    for sel in css_selectors:
        if await click_css(page, sel, timeout):
            return True
    if await click_text(page, text_labels, timeout):
        return True
    return False


async def signup_complete(email: str, password: str, proxy: str,
                          headless: bool, mail_api: str, token_name: str) -> dict:
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
            headless=headless, lang="en-US", proxy=proxy,
            sandbox=False, browser_executable_path=chrome_path,
        )
        page = await browser.get("https://dash.cloudflare.com/sign-up")
        await asyncio.sleep(8)

        # ---- SIGNUP ----
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

        for attempt in range(3):
            try:
                await page.verify_cf()
                await asyncio.sleep(5)
                break
            except Exception as e:
                if attempt == 2:
                    print(f"Turnstile attempt {attempt+1} failed: {e}", file=sys.stderr)
                await asyncio.sleep(3)

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

        # ---- EMAIL VERIFICATION ----
        if mail_api:
            print("Polling for verification email (max 120s)...", file=sys.stderr)
            verify_link = await poll_verification_email(mail_api, email, signup_started_at, timeout_sec=120)
            if verify_link:
                print("Clicking verify link...", file=sys.stderr)
                await page.get(verify_link)
                await asyncio.sleep(5)
            else:
                return {"success": False, "error": "Verification email not found after 120s — cannot proceed", "account_id": account_id}

        # ---- CHECK IF ALREADY ON DASHBOARD ----
        await asyncio.sleep(2)
        url = await page.evaluate("location.href")
        match = re.search(r"dash\.cloudflare\.com/([a-f0-9]{20,})", url)
        if match:
            account_id = match.group(1)

        # ---- LOGIN IF NEEDED ----
        if "/login" in url.lower() or "/sign-in" in url.lower():
            print("Login needed, entering credentials...", file=sys.stderr)
            await page.get("https://dash.cloudflare.com/login")
            await asyncio.sleep(3)
            for sel in ['input[type="email"]', 'input[name="email"]', 'input#email']:
                if await fill_css(page, sel, email):
                    break
            await asyncio.sleep(0.5)
            await click_text(page, ["Continue", "Next", "Sign in"])
            await asyncio.sleep(2)
            for sel in ['input[type="password"]', 'input[name="password"]', 'input#password']:
                if await fill_css(page, sel, password):
                    break
            await asyncio.sleep(0.5)
            await click_text(page, ["Sign in", "Log in", "Continue"])
            await asyncio.sleep(5)

        # ---- CREATE API TOKEN ----
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
        for attempt in range(15):
            if await click_text(page, create_labels, timeout=3):
                clicked = True
                print(f"Clicked create button on attempt {attempt+1}", file=sys.stderr)
                break
            # also try clicking any link/button containing these texts
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
            if await fill_css(page, sel, token_name):
                break
        await asyncio.sleep(0.5)

        print("Clicking 'Create API Token' to finalize...", file=sys.stderr)
        clicked_create = False
        for _ in range(5):
            if await click_text(page, ["Create API Token", "Create Token", "Create"], timeout=3):
                clicked_create = True
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
                clicked_create = True
                break
            except Exception:
                pass
            await asyncio.sleep(1)
        await asyncio.sleep(3)

        # ---- CAPTURE TOKEN ----
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


def main():
    parser = argparse.ArgumentParser(description="Cloudflare signup + verify + token creation")
    parser.add_argument("--email", required=True)
    parser.add_argument("--password", required=True)
    parser.add_argument("--mail-api", default="", help="CF Email Worker URL for verification")
    parser.add_argument("--token-name", default="9router-workers-ai", help="API token name")
    parser.add_argument("--proxy", default=None)
    parser.add_argument("--headless", action="store_true")
    args = parser.parse_args()

    result = asyncio.run(signup_complete(
        args.email, args.password, args.proxy,
        args.headless, args.mail_api, args.token_name,
    ))
    print(json.dumps(result))


if __name__ == "__main__":
    main()
