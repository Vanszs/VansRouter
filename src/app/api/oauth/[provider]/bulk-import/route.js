import { NextResponse } from "next/server";
import {
  getBulkImportProviderSpec,
  resolveProxyForProvider,
} from "@/lib/oauth/services/bulkImportRegistry";

export const dynamic = "force-dynamic";

export async function POST(request, { params }) {
  const { provider } = await params;

  let spec;
  try {
    spec = getBulkImportProviderSpec(provider);
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  try {
    const body = await request.json();

    const resolvedProxy = await resolveProxyForProvider(spec, body);
    if (resolvedProxy.error) {
      return NextResponse.json({ error: resolvedProxy.error }, { status: 400 });
    }

    const jobArgs = spec.normalizeStartArgs(body, resolvedProxy);

    if (spec.parseAccounts && provider !== "cloudflare-ai") {
      const accounts = Array.isArray(body?.accounts) ? body.accounts : [];
      const { parsed, invalidLines } = await spec.parseAccounts(accounts);

      if (!parsed.length) {
        const payload = { error: invalidLines.length > 0 ? "Invalid account format. Use one account per line: email@gmail.com|password" : "At least one account entry is required" };
        if (invalidLines.length > 0) payload.invalidLines = invalidLines;
        return NextResponse.json(payload, { status: 400 });
      }

      if (invalidLines.length > 0) {
        return NextResponse.json(
          {
            error: "Invalid account format. Use one account per line: email@gmail.com|password",
            invalidLines,
          },
          { status: 400 }
        );
      }

      jobArgs.accounts = body?.accounts ?? [];
    }

    const manager = await spec.getManager();
    const job = await manager.startJob(jobArgs);

    return NextResponse.json({ success: true, job });
  } catch (error) {
    const status = Array.isArray(error?.invalidLines) ? 400 : 500;
    const payload = {
      error: error?.error || error?.message || `Failed to start ${spec.label} bulk import`,
    };
    if (Array.isArray(error?.invalidLines) && error.invalidLines.length > 0) {
      payload.invalidLines = error.invalidLines;
    }
    return NextResponse.json(payload, { status });
  }
}
