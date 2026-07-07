import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { getBulkImportProviderSpec } from "@/lib/oauth/services/bulkImportRegistry";

export const dynamic = "force-dynamic";

const ACTIVE_JOB_STATUSES = new Set(["queued", "running", "needs_manual"]);

function cancelPersistedJob(manager, jobId) {
  if (!manager?.storageDir) return null;
  const filePath = path.join(manager.storageDir, `${jobId}.json`);
  if (!fs.existsSync(filePath)) return null;

  const job = JSON.parse(fs.readFileSync(filePath, "utf8"));
  if (!ACTIVE_JOB_STATUSES.has(job?.status)) return job;

  const cancelledAt = new Date().toISOString();
  job.status = "cancelled";
  job.finishedAt = job.finishedAt || cancelledAt;
  job.error = "Job cancelled";
  job.accounts = (job.accounts || []).map((account) => (
    ACTIVE_JOB_STATUSES.has(account.status)
      ? { ...account, status: "cancelled", error: "Job cancelled", updatedAt: cancelledAt }
      : account
  ));
  fs.writeFileSync(filePath, JSON.stringify(job, null, 2), "utf8");
  return job;
}

export async function POST(_request, { params }) {
  const { provider, jobId } = await params;

  let spec;
  try {
    spec = getBulkImportProviderSpec(provider);
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  const manager = await spec.getManager();
  const job = await manager.cancelJob(jobId) || cancelPersistedJob(manager, jobId);

  if (!job) {
    return NextResponse.json({ error: `${spec.errorLabel} not found` }, { status: 404 });
  }

  return NextResponse.json({ success: true, job });
}
