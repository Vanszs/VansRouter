import { NextResponse } from "next/server";
import { getSettings } from "@/lib/localDb";
import { auditLog } from "@/lib/db/index.js";
import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { setDashboardAuthCookie } from "@/lib/auth/dashboardSession";
import { isOidcConfigured } from "@/lib/auth/oidc";
import { checkLock, recordFail, recordSuccess, getClientIp } from "@/lib/auth/loginLimiter";
import { isLocalRequest } from "@/dashboardGuard";

const RESET_HINT = "Forgot password? Reset to default via 9Router CLI → Settings → Reset Password to Default.";
const NO_STORE_HEADERS = { "Cache-Control": "no-store" };
const DEFAULT_PASSWORD = "123456";

function isTunnelRequest(request, settings) {
  const host = (request.headers.get("host") || "").split(":")[0].toLowerCase();
  const tunnelHost = settings.tunnelUrl ? new URL(settings.tunnelUrl).hostname.toLowerCase() : "";
  const tailscaleHost = settings.tailscaleUrl ? new URL(settings.tailscaleUrl).hostname.toLowerCase() : "";
  return (tunnelHost && host === tunnelHost) || (tailscaleHost && host === tailscaleHost);
}

export async function POST(request) {
  try {
    const ip = getClientIp(request);
    const lock = checkLock(ip);
    if (lock.locked) {
      return NextResponse.json(
        { error: `Too many failed attempts. Try again in ${lock.retryAfter}s. ${RESET_HINT}`, retryAfter: lock.retryAfter, resetHint: RESET_HINT },
        { status: 429, headers: { "Retry-After": String(lock.retryAfter) } }
      );
    }

    const body = await request.json();
    const { password, totpCode } = body;
    const settings = await getSettings();

    // Block login via tunnel/tailscale if dashboard access is disabled
    if (isTunnelRequest(request, settings) && settings.tunnelDashboardAccess !== true) {
      return NextResponse.json({ error: "Dashboard access via tunnel is disabled" }, { status: 403 });
    }

    // Default password is '123456' if not set
    const storedHash = settings.password;

    if (settings.authMode === "oidc" && isOidcConfigured(settings)) {
      return NextResponse.json({ error: "Password login is disabled. Use OIDC sign in." }, { status: 403 });
    }

    let isValid = false;
    const initialPassword = process.env.INITIAL_PASSWORD || DEFAULT_PASSWORD;
    let isUsingDefaultPassword = false;

    if (storedHash) {
      isValid = await bcrypt.compare(password, storedHash);
    } else {
      // No stored hash — using default/initial password
      isValid = password === initialPassword;
      if (isValid) isUsingDefaultPassword = true;
    }

    if (isValid) {
      // Default password still in use on a remote client → force a password
      // change before the dashboard is exposed remotely (keeps local UX intact).
      const mustChangePassword =
        !storedHash && !process.env.INITIAL_PASSWORD && !isLocalRequest(request);

      if (mustChangePassword) {
        return NextResponse.json(
          {
            success: false,
            error: "Default password must be changed before remote access. Change it from the local machine (or set INITIAL_PASSWORD).",
            mustChangePassword,
          },
          { status: 403, headers: NO_STORE_HEADERS },
        );
      }

      // 2FA check: if TOTP is enabled, require TOTP code
      if (settings.totpSecret) {
        if (!totpCode) {
          // First step: password OK, need TOTP
          return NextResponse.json({ success: true, requires2FA: true }, { status: 200, headers: NO_STORE_HEADERS });
        }
        // Verify TOTP code
        const { verifyTOTP } = await import("@/lib/auth/totp.js");
        if (!verifyTOTP(settings.totpSecret, totpCode)) {
          return NextResponse.json({ error: "Invalid 2FA code" }, { status: 401, headers: NO_STORE_HEADERS });
        }
      }

      // Force password change if still using default password and not yet changed
      if (isUsingDefaultPassword && !settings.passwordChanged) {
        recordSuccess(ip);
      auditLog({ action: "login.success", actor: "dashboard", ip }).catch(() => {});
        return NextResponse.json(
          { success: true, requirePasswordChange: true },
          { status: 200, headers: NO_STORE_HEADERS }
        );
      }

      recordSuccess(ip);
      auditLog({ action: "login.success", actor: "dashboard", ip }).catch(() => {});
      const cookieStore = await cookies();
      await setDashboardAuthCookie(cookieStore, request);

      return NextResponse.json({ success: true, mustChangePassword: false }, { headers: NO_STORE_HEADERS });
    }

    const { remainingBeforeLock } = recordFail(ip);
    auditLog({ action: "login.failed", actor: "dashboard", ip }).catch(() => {});
    const postLock = checkLock(ip);
    if (postLock.locked) {
      return NextResponse.json(
        { error: `Too many failed attempts. Try again in ${postLock.retryAfter}s. ${RESET_HINT}`, retryAfter: postLock.retryAfter, resetHint: RESET_HINT },
        { status: 429, headers: { "Retry-After": String(postLock.retryAfter) } }
      );
    }
    return NextResponse.json(
      { error: `Invalid password. ${remainingBeforeLock} attempt(s) left before lockout.`, remainingBeforeLock },
      { status: 401 }
    );
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
