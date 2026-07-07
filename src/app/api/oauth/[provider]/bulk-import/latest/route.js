import { NextResponse } from "next/server";
import { getBulkImportProviderSpec } from "@/lib/oauth/services/bulkImportRegistry";

export const dynamic = "force-dynamic";

export async function GET(request, { params }) {
  const { provider } = await params;

  let spec;
  try {
    spec = getBulkImportProviderSpec(provider);
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  const { searchParams } = new URL(request.url);
  const scope = searchParams.get("scope");
  const includeRecentTerminal = scope === "recent" || scope === "all";

  const manager = await spec.getManager();
  const job = await manager.getLatestJobWithPreview({ includeRecentTerminal });

  if (!job) {
    return NextResponse.json(
      {
        success: false,
        found: false,
        stale: spec.staleOnLatest404,
        recoverable: false,
        job: null,
        error: `${spec.errorLabel} not found`,
      },
      { status: 404 }
    );
  }

  return NextResponse.json({
    success: true,
    found: true,
    stale: false,
    recoverable: true,
    job,
  });
}
