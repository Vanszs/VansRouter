import { NextResponse } from "next/server";
import { getAuditLogs, getAuditActions } from "@/lib/db/index.js";

export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    const url = new URL(request.url);
    const page = parseInt(url.searchParams.get("page"), 10) || 1;
    const limit = Math.min(parseInt(url.searchParams.get("limit"), 10) || 50, 200);
    const action = url.searchParams.get("action") || null;
    const actor = url.searchParams.get("actor") || null;
    const from = url.searchParams.get("from") || null;
    const to = url.searchParams.get("to") || null;

    // Special case: get available filter options
    if (url.searchParams.get("actions") === "list") {
      const actions = await getAuditActions();
      return NextResponse.json({ actions });
    }

    const result = await getAuditLogs({ page, limit, action, actor, from, to });
    return NextResponse.json(result);
  } catch (error) {
    console.error("Error getting audit logs:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
