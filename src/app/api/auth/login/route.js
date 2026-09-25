import { NextResponse } from "next/server";
import { getInitialPassword, isPlaceholderPassword } from "@/lib/auth/password";
import { getSettings } from "@/lib/localDb";
import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { setDashboardAuthCookie, setPasswordChangeCookie } from "@/lib/auth/dashboardSession";
import { isOidcConfigured } from "@/lib/auth/oidc";
import { checkLock, recordFail, recordSuccess, getClientIp } from "@/lib/auth/loginLimiter";
import { isLocalRequest } from "@/dashboardGuard";

const RESET_HINT = "Forgot password? Use the VansRouter CLI on the host to set a new dashboard password.";
const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

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

    const { password } = await request.json();
    const settings = await getSettings();

    // Block login via tunnel/tailscale if dashboard access is disabled
    if (isTunnelRequest(request, settings) && settings.tunnelDashboardAccess !== true) {
      return NextResponse.json({ error: "Dashboard access via tunnel is disabled" }, { status: 403 });
    }

    const storedHash = settings.password;
    const initialPassword = getInitialPassword();

    if (settings.authMode === "oidc" && isOidcConfigured(settings)) {
      return NextResponse.json({ error: "Password login is disabled. Use OIDC sign in." }, { status: 403 });
    }

    let isValid = false;
    if (storedHash) {
      isValid = await bcrypt.compare(password, storedHash);
    } else {
      if (!initialPassword) {
        return Response.json(
          { error: "INITIAL_PASSWORD must be 123456 or a strong value before login" },
          { status: 503, headers: NO_STORE_HEADERS },
        );
      }
      isValid = password === initialPassword;
    }

    if (isValid) {
      // A non-local client must replace the compatibility default before it gets
      // any dashboard access. It still receives a short-lived, password-change-only
      // grant so a web-only operator is never locked out with no local shell.
      // This deliberately needs no "is this the Docker host?" signal: the grant
      // can change the password and nothing else, and the caller still had to
      // present the correct current password — which is strictly tighter than
      // handing out a full session on a known default.
      const mustChangePassword =
        !storedHash && isPlaceholderPassword(initialPassword) && !isLocalRequest(request);

      recordSuccess(ip);
      const cookieStore = await cookies();

      if (mustChangePassword) {
        await setPasswordChangeCookie(cookieStore, request);
        return NextResponse.json(
          { success: true, mustChangePassword: true },
          { headers: NO_STORE_HEADERS },
        );
      }

      await setDashboardAuthCookie(cookieStore, request);

      return NextResponse.json({ success: true, mustChangePassword: false }, { headers: NO_STORE_HEADERS });
    }

    const { remainingBeforeLock } = recordFail(ip);
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
