import { NextResponse } from "next/server";
import { getApiKeyById, getApiKeyUsageDetails } from "@/lib/localDb";

export const dynamic = "force-dynamic";

// GET /api/keys/[id]/usage?period=7d
export async function GET(request, { params }) {
  try {
    const { id } = await params;
    const key = await getApiKeyById(id);
    if (!key) {
      return NextResponse.json({ error: "Key not found" }, { status: 404 });
    }

    const { searchParams } = new URL(request.url);
    const period = searchParams.get("period") || "all";

    const usage = await getApiKeyUsageDetails(key.key, period);

    return NextResponse.json({
      id: key.id,
      name: key.name,
      totalRequests: key.totalRequests,
      totalPromptTokens: key.totalPromptTokens,
      totalCompletionTokens: key.totalCompletionTokens,
      lastUsedAt: key.lastUsedAt,
      period,
      breakdown: usage.models,
      totals: usage.totals,
    });
  } catch (error) {
    console.log("Error fetching key usage:", error);
    return NextResponse.json({ error: "Failed to fetch usage" }, { status: 500 });
  }
}
