import { NextResponse } from "next/server";
import { importCloudflareToken } from "@/lib/oauth/services/cloudflareBulkImportManager.js";

export const dynamic = "force-dynamic";

function parseLine(line) {
  const trimmed = String(line || "").trim();
  if (!trimmed || trimmed.startsWith("#")) return null;

  if (trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed);
      return {
        apiToken: parsed.apiToken || parsed.apiKey || parsed.token || "",
        accountId: parsed.accountId || parsed.account_id || "",
        name: parsed.name || "",
      };
    } catch {
      return { invalid: true };
    }
  }

  const parts = trimmed.split("|").map((part) => part.trim());
  const apiToken = parts[0] || "";
  const accountId = parts[1] || "";
  const name = parts[2] || "";
  if (!apiToken || !accountId) return { invalid: true };
  return { apiToken, accountId, name };
}

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid or empty request body" }, { status: 400 });
  }

  const rawText = String(body?.text || "").trim();
  const singleToken = String(body?.apiToken || "").trim();
  const singleAccountId = String(body?.accountId || "").trim();
  const singleName = String(body?.name || "").trim();

  const entries = [];

  if (rawText) {
    const lines = rawText.split("\n");
    for (const line of lines) {
      const parsed = parseLine(line);
      if (!parsed) continue;
      if (parsed.invalid) {
        return NextResponse.json(
          { error: "Invalid line format. Use apiToken|accountId|optionalName or JSON." },
          { status: 400 }
        );
      }
      entries.push(parsed);
    }
  } else if (singleToken && singleAccountId) {
    entries.push({ apiToken: singleToken, accountId: singleAccountId, name: singleName });
  }

  if (!entries.length) {
    return NextResponse.json(
      { error: "Provide at least one entry: apiToken|accountId or JSON." },
      { status: 400 }
    );
  }

  const results = [];
  const failures = [];
  let imported = 0;

  for (const [index, entry] of entries.entries()) {
    try {
      const { connection, tokenCheck, workerAi } = await importCloudflareToken({
        token: entry.apiToken,
        accountId: entry.accountId,
        name: entry.name,
      });
      imported += 1;
      results.push({
        line: index + 1,
        success: true,
        connectionId: connection.id,
        accountId: entry.accountId,
        name: connection.name,
        tokenStatus: tokenCheck.payload?.result?.status || "valid",
        workerAiStatus: workerAi.status,
      });
    } catch (error) {
      failures.push({
        line: index + 1,
        accountId: entry.accountId,
        error: error.message,
        code: error.code || "failed",
      });
    }
  }

  const response = {
    success: failures.length === 0,
    imported,
    total: entries.length,
    failed: failures.length,
    results,
  };
  if (failures.length > 0) response.failures = failures;

  return NextResponse.json(response, { status: failures.length === entries.length ? 422 : 200 });
}
