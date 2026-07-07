import { POST as cancelBulkImportJob } from "../../../../[provider]/bulk-import/[jobId]/cancel/route";

export const dynamic = "force-dynamic";

export async function POST(request, { params }) {
  const { jobId } = await params;
  return cancelBulkImportJob(request, {
    params: Promise.resolve({ provider: "autoclaw", jobId }),
  });
}
