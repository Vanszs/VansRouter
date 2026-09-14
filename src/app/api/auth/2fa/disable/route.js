import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getDashboardAuthSession } from "@/lib/auth/dashboardSession";
import { getSettings, updateSettings } from "@/lib/localDb";
import { verifyTOTP } from "@/lib/auth/totp.js";
import { verifyDashboardPassword } from "@/lib/auth/dashboardSession";

export async function POST(request) {
  try {
    // Require authenticated session
    const cookieStore = await cookies();
    const token = cookieStore.get("auth_token")?.value;
    const session = await getDashboardAuthSession(token);
    if (!session) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    const { password, code } = await request.json();

    // Require password re-verification
    if (!password) {
      return NextResponse.json({ error: "Current password required to disable 2FA" }, { status: 400 });
    }
    const passwordValid = await verifyDashboardPassword(password);
    if (!passwordValid) {
      return NextResponse.json({ error: "Invalid password" }, { status: 401 });
    }

    const settings = await getSettings();
    if (!settings.totpSecret) {
      return NextResponse.json({ error: "2FA is not enabled" }, { status: 400 });
    }

    // Verify TOTP code as additional confirmation
    if (code) {
      if (!verifyTOTP(settings.totpSecret, code)) {
        return NextResponse.json({ error: "Invalid TOTP code" }, { status: 401 });
      }
    }

    // Disable 2FA
    await updateSettings({
      totpSecret: null,
      totpPendingSecret: null,
      totpEnabledAt: null,
    });

    return NextResponse.json({
      success: true,
      message: "2FA has been disabled.",
    });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
