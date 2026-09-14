import { NextResponse } from "next/server";
import { getCacheStats } from "open-sse/services/requestCache.js";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const stats = getCacheStats();
    return NextResponse.json(stats);
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
