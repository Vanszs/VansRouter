import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getDashboardAuthSession } from "@/lib/auth/dashboardSession";
import { getSettings, updateSettings } from "@/lib/localDb";
import { generateTOTPSecret, generateTOTPUri } from "@/lib/auth/totp.js";

export async function POST(request) {
  try {
    // Require authenticated session
    const cookieStore = await cookies();
    const token = cookieStore.get("auth_token")?.value;
    const session = await getDashboardAuthSession(token);
    if (!session) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    const settings = await getSettings();
    if (settings.totpSecret) {
      return NextResponse.json({ error: "2FA is already enabled. Disable it first to set up again." }, { status: 400 });
    }

    // Generate new secret
    const secret = generateTOTPSecret();
    const uri = generateTOTPUri(secret, "admin", "9Router");

    // Store as pending (not yet verified)
    await updateSettings({ totpPendingSecret: secret });

    return NextResponse.json({
      secret,
      uri,
      message: "Scan the QR code with your authenticator app, then verify with /api/auth/2fa/verify",
    });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
