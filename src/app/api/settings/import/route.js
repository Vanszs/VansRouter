import { NextResponse } from "next/server";
import { importDb } from "@/lib/db/index.js";
import { auditLog } from "@/lib/db/index.js";

export const dynamic = "force-dynamic";

export async function POST(request) {
  try {
    const payload = await request.json();

    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return NextResponse.json({ error: "Invalid import payload" }, { status: 400 });
    }

    // Validate expected top-level keys
    const validKeys = [
      "settings", "providerConnections", "providerNodes", "proxyPools",
      "proxyPoolFitness", "apiKeys", "combos", "modelAliases",
      "customModels", "mitmAlias", "pricing", "_exportMeta",
    ];
    const unknownKeys = Object.keys(payload).filter(k => !validKeys.includes(k));
    if (unknownKeys.length > 0) {
      console.warn(`[Import] Ignoring unknown keys: ${unknownKeys.join(", ")}`);
    }

    // Strip export metadata before import
    const { _exportMeta, ...importPayload } = payload;

    const result = await importDb(importPayload);

    auditLog({
      action: "settings.import",
      actor: "dashboard",
      details: {
        providers: importPayload.providerConnections?.length || 0,
        keys: importPayload.apiKeys?.length || 0,
        combos: importPayload.combos?.length || 0,
      },
      ip: request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || null,
    }).catch(() => {});

    return NextResponse.json({
      success: true,
      message: "Settings imported successfully",
      stats: {
        providers: result?.providerConnections?.length || 0,
        keys: result?.apiKeys?.length || 0,
        combos: result?.combos?.length || 0,
      },
    });
  } catch (error) {
    console.error("Import error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
