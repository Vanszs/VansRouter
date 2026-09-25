import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSettings, updateSettings } from "@/lib/localDb";
import { applyOutboundProxyEnv } from "@/lib/network/outboundProxy";
import { resetComboRotation } from "open-sse/services/combo.js";
import bcrypt from "bcryptjs";
import { getInitialPassword, isStrongInitialPassword } from "@/lib/auth/password";
import { verifyDashboardAuthToken, verifyPasswordChangeToken } from "@/lib/auth/dashboardSession";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const SETTINGS_RESPONSE_HEADERS = {
  "Cache-Control": "no-store"
};

// Secrets must never be mass-assigned from request body (CWE-915)
const PROTECTED_SETTING_KEYS = ["password", "mitmSudoEncrypted"];

// The password-change grant may touch these keys and nothing else.
const GRANT_ALLOWED_KEYS = new Set(["newPassword", "currentPassword"]);

export async function GET() {
  try {
    const settings = await getSettings();
    const { password, oidcClientSecret, ...safeSettings } = settings;
    safeSettings.oidcConfigured = !!(safeSettings.oidcIssuerUrl && safeSettings.oidcClientId && oidcClientSecret);
    
    const enableRequestLogs = process.env.ENABLE_REQUEST_LOGS === "true";
    const enableTranslator = process.env.ENABLE_TRANSLATOR === "true";
    
    return NextResponse.json({ 
      ...safeSettings, 
      enableRequestLogs,
      enableTranslator,
      hasPassword: !!password
    }, { headers: SETTINGS_RESPONSE_HEADERS });
  } catch (error) {
    console.log("Error getting settings:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PATCH(request) {
  try {
    const body = await request.json();

    // A password-change grant (fresh install, remote, default password) is not a
    // dashboard session: it exists only so the operator can replace that
    // password. Anything else in the body is refused before it reaches the DB.
    const cookieStore = await cookies();
    const hasSession = await verifyDashboardAuthToken(cookieStore.get("auth_token")?.value);
    if (!hasSession && await verifyPasswordChangeToken(cookieStore.get("password_change")?.value)) {
      const keys = Object.keys(body).filter((key) => !PROTECTED_SETTING_KEYS.includes(key));
      const onlyPassword = keys.length > 0 && keys.every((key) => GRANT_ALLOWED_KEYS.has(key));
      if (!onlyPassword || !body.currentPassword) {
        return NextResponse.json(
          { error: "Password change required: set only newPassword and currentPassword" },
          { status: 403, headers: SETTINGS_RESPONSE_HEADERS },
        );
      }
      const initialPassword = getInitialPassword();
      if (!initialPassword || body.currentPassword !== initialPassword) {
        return NextResponse.json(
          { error: "Invalid current password" },
          { status: 401, headers: SETTINGS_RESPONSE_HEADERS },
        );
      }
    }

    // Strip protected secrets before any internal handling sets them
    for (const key of PROTECTED_SETTING_KEYS) delete body[key];

    // If updating password, enforce the production strength policy before hashing it.
    if (body.newPassword && !isStrongInitialPassword(body.newPassword)) {
      return NextResponse.json({ error: "New password must be at least 12 characters and not a placeholder" }, { status: 400 });
    }

    if (body.newPassword) {
      const settings = await getSettings();
      const currentHash = settings.password;

      // Verify current password if it exists
      if (currentHash) {
        if (!body.currentPassword) {
          return NextResponse.json({ error: "Current password required" }, { status: 400 });
        }
        const isValid = await bcrypt.compare(body.currentPassword, currentHash);
        if (!isValid) {
          return NextResponse.json({ error: "Invalid current password" }, { status: 401 });
        }
      } else {
        // First time setting password, no current password is needed. Any
        // supplied legacy value must still be accepted for local development.
        if (body.currentPassword && body.currentPassword !== "123456") {
           return NextResponse.json({ error: "Invalid current password" }, { status: 401 });
        }
      }

      const salt = await bcrypt.genSalt(10);
      body.password = await bcrypt.hash(body.newPassword, salt);
      delete body.newPassword;
      delete body.currentPassword;
    }

    if (Object.prototype.hasOwnProperty.call(body, "oidcClientSecret")) {
      if (!body.oidcClientSecret || !String(body.oidcClientSecret).trim()) {
        delete body.oidcClientSecret;
      }
    }

    const settings = await updateSettings(body);

    // Apply outbound proxy settings immediately (no restart required)
    if (
      Object.prototype.hasOwnProperty.call(body, "outboundProxyEnabled") ||
      Object.prototype.hasOwnProperty.call(body, "outboundProxyUrl") ||
      Object.prototype.hasOwnProperty.call(body, "outboundNoProxy")
    ) {
      applyOutboundProxyEnv(settings);
    }

    // Invalidate combo rotation state when strategy settings change
    if (
      Object.prototype.hasOwnProperty.call(body, "comboStrategy") ||
      Object.prototype.hasOwnProperty.call(body, "comboStickyRoundRobinLimit") ||
      Object.prototype.hasOwnProperty.call(body, "comboStrategies")
    ) {
      resetComboRotation();
    }

    if (
      Object.prototype.hasOwnProperty.call(body, "claudeAutoPing") ||
      Object.prototype.hasOwnProperty.call(body, "codexAutoPing")
    ) {
      // Keep the scheduler absent when no account opted in; load its provider graph only on demand.
      import("@/shared/services/quotaAutoPing")
        .then(({ configureQuotaAutoPing }) => {
          configureQuotaAutoPing(settings);
        })
        .catch((error) => console.warn("[AutoPing] settings update failed:", error.message));
    }

    const { password, oidcClientSecret, ...safeSettings } = settings;
    safeSettings.oidcConfigured = !!(safeSettings.oidcIssuerUrl && safeSettings.oidcClientId && oidcClientSecret);
    return NextResponse.json(safeSettings, { headers: SETTINGS_RESPONSE_HEADERS });
  } catch (error) {
    console.log("Error updating settings:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
