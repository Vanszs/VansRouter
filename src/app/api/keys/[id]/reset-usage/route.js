import { NextResponse } from "next/server";
import { getApiKeyById, resetApiKeyUsage } from "@/lib/localDb";

// POST /api/keys/[id]/reset-usage
export async function POST(request, { params }) {
  try {
    const { id } = await params;
    const key = await getApiKeyById(id);
    if (!key) {
      return NextResponse.json({ error: "Key not found" }, { status: 404 });
    }

    await resetApiKeyUsage(id);

    return NextResponse.json({ success: true, message: "Usage counters reset" });
  } catch (error) {
    console.log("Error resetting key usage:", error);
    return NextResponse.json({ error: "Failed to reset usage" }, { status: 500 });
  }
}
