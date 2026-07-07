import { NextResponse } from "next/server";
import { autoclawService } from "@/lib/oauth/services/autoclaw";

export const dynamic = "force-dynamic";

export async function POST(request) {
  const body = await request.json().catch(() => ({}));
  const { accessToken, refreshToken, deviceId } = body;

  if (!accessToken || !refreshToken) {
    return NextResponse.json(
      { error: "accessToken and refreshToken are required" },
      { status: 400 }
    );
  }

  try {
    const result = await autoclawService.validateAndSaveImport({
      accessToken,
      refreshToken,
      deviceId,
    });
    return NextResponse.json({ success: true, connection: result });
  } catch (e) {
    const status = e.code === "INVALID_TOKEN" ? 400 : 502;
    return NextResponse.json({ error: e.message }, { status });
  }
}
