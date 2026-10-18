import { NextResponse } from "next/server";
import { FILTERS } from "./filters.js";
import { guardedFetch } from "@/shared/utils/ssrfGuard.js";

export const dynamic = "force-dynamic";

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const url = searchParams.get("url");
  const type = searchParams.get("type");

  if (!url || !type) {
    return NextResponse.json({ error: "Missing url or type" }, { status: 400 });
  }

  const filter = FILTERS[type];
  if (!filter) {
    return NextResponse.json({ error: "Unknown filter type" }, { status: 400 });
  }

  try {
    // guardedFetch pins the connection to the address it just validated, so the
    // fetch cannot resolve the host again and land on an unreachable address.
    const res = await guardedFetch(url, { redirect: "manual", signal: AbortSignal.timeout(15000) });
    if (res.status >= 300 && res.status < 400) {
      return NextResponse.json({ error: "Model catalog redirected" }, { status: 502 });
    }
    if (!res.ok) {
      return NextResponse.json({ error: `Model catalog answered ${res.status}` }, { status: 502 });
    }
    const json = await res.json();
    const raw = json.data ?? json.models ?? json;
    const data = filter(Array.isArray(raw) ? raw : []);
    return NextResponse.json({ data });
  } catch (error) {
    const message = error?.name === "TimeoutError" ? "Model catalog timed out" : (error?.message || "Model catalog request failed");
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
