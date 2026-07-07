import { NextResponse } from "next/server";
import { getBulkImportProviderSpec } from "@/lib/oauth/services/bulkImportRegistry";

export const dynamic = "force-dynamic";

export async function POST(_request, { params }) {
  const { provider, jobId, workerId } = await params;

  let spec;
  try {
    spec = getBulkImportProviderSpec(provider);
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  const manager = await spec.getManager();
  const result = await manager.openManualSession(jobId, workerId);

  if (!result) {
    return NextResponse.json({ error: `${spec.errorLabel} not found` }, { status: 404 });
  }

  if (!result.ok) {
    return NextResponse.json(
      {
        error: result.error || "Manual session not found for this worker",
        job: result.job,
      },
      { status: 404 }
    );
  }

  return NextResponse.json({
    success: true,
    job: result.job,
    account: result.account,
  });
}
