import { NextResponse } from "next/server";
import { getBulkImportProviderSpec } from "@/lib/oauth/services/bulkImportRegistry";

export const dynamic = "force-dynamic";

export async function GET(_request, { params }) {
  const { provider, jobId } = await params;

  let spec;
  try {
    spec = getBulkImportProviderSpec(provider);
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  const manager = await spec.getManager();
  const job = await manager.getJobWithPreview(jobId);

  if (!job) {
    return NextResponse.json(
      {
        success: false,
        found: false,
        stale: true,
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
