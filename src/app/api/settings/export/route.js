import { NextResponse } from "next/server";
import { exportDb } from "@/lib/db/index.js";
import { auditLog } from "@/lib/db/index.js";

export const dynamic = "force-dynamic";

// Sensitive fields to strip from export by default
const SENSITIVE_FIELDS = [
  "password", "accessToken", "refreshToken", "idToken",
  "apiKey", "oidcClientSecret", "mitmSudoEncrypted",
];

function stripSecrets(obj) {
  if (!obj || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map(stripSecrets);
  const cleaned = {};
  for (const [key, value] of Object.entries(obj)) {
    if (SENSITIVE_FIELDS.includes(key)) continue;
    cleaned[key] = typeof value === "object" ? stripSecrets(value) : value;
  }
  return cleaned;
}

export async function GET(request) {
  try {
    const url = new URL(request.url);
    const includeSecrets = url.searchParams.get("includeSecrets") === "true";

    let data = await exportDb();

    if (!includeSecrets) {
      data = stripSecrets(data);
    }

    data._exportMeta = {
      exportedAt: new Date().toISOString(),
      version: "1.0",
    };

    auditLog({
      action: "settings.export",
      actor: "dashboard",
      details: { includeSecrets },
      ip: request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || null,
    }).catch(() => {});

    return NextResponse.json(data, {
      headers: {
        "Content-Disposition": `attachment; filename="9router-backup-${new Date().toISOString().slice(0, 10)}.json"`,
      },
    });
  } catch (error) {
    console.error("Export error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
