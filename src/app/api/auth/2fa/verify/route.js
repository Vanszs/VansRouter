import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getDashboardAuthSession } from "@/lib/auth/dashboardSession";
import { getSettings, updateSettings } from "@/lib/localDb";
import { verifyTOTP } from "@/lib/auth/totp.js";

export async function POST(request) {
  try {
    // Require authenticated session
    const cookieStore = await cookies();
    const token = cookieStore.get("auth_token")?.value;
    const session = await getDashboardAuthSession(token);
    if (!session) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    const { code } = await request.json();
    if (!code || typeof code !== "string" || code.length !== 6) {
      return NextResponse.json({ error: "Invalid code. Must be a 6-digit TOTP code." }, { status: 400 });
    }

    const settings = await getSettings();
    const secret = settings.totpPendingSecret;
    if (!secret) {
      return NextResponse.json({ error: "No pending 2FA setup. Call /api/auth/2fa/setup first." }, { status: 400 });
    }

    // Verify the code against the pending secret
    if (!verifyTOTP(secret, code)) {
      return NextResponse.json({ error: "Invalid TOTP code. Try again." }, { status: 401 });
    }

    // Code is valid — activate 2FA
    await updateSettings({
      totpSecret: secret,
      totpPendingSecret: null,
      totpEnabledAt: new Date().toISOString(),
    });

    return NextResponse.json({
      success: true,
      message: "2FA is now enabled. You will need your authenticator app for future logins.",
    });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
