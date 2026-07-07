import { NextResponse } from "next/server";
import { autoclawService } from "@/lib/oauth/services/autoclaw";

export const dynamic = "force-dynamic";

export async function GET(request) {
  const url = new URL(request.url);
  const connectionId = url.searchParams.get("connectionId");
  if (!connectionId) {
    return NextResponse.json(
      { error: "connectionId query parameter is required" },
      { status: 400 }
    );
  }
  try {
    const balance = await autoclawService.getBalance(connectionId);
    return NextResponse.json({ success: true, ...balance });
  } catch (e) {
    const status = e.recoverable ? 503 : 502;
    return NextResponse.json({ error: e.message }, { status });
  }
}
