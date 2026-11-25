import { NextResponse } from "next/server";
import { createProxyPool, getProxyPools } from "@/models";
import { requireDashboardAuth } from "@/lib/auth/routeAuth.js";
import {
  PUBLIC_PROXY_ANONYMITY_LEVELS,
  PUBLIC_PROXY_SOURCES,
} from "@/shared/constants/publicProxySources.js";
import { fetchPublicProxyEntries, normalizeProxyUrlKey, resolveVpsLabFile } from "@/lib/network/publicProxySources.js";

const COUNTRY_PATTERN = /^[A-Za-z]{2}(,[A-Za-z]{2})*$/;

function parseImportRequest(body = {}, source) {
  const protocol = source.protocols.includes(body?.protocol) ? body.protocol : "http";
  const countRaw = Number.parseInt(body?.count, 10);
  const count = Number.isFinite(countRaw)
    ? Math.min(Math.max(countRaw, source.minCount), source.maxCount)
    : source.defaultCount;

  let country = "";
  if (body?.country && typeof body.country === "string" && body.country.trim()) {
    country = body.country.trim().toUpperCase();
    if (!source.supportsCountry || !COUNTRY_PATTERN.test(country)) {
      return { error: `Invalid country filter for ${source.label}` };
    }
  }

  let anonymity = "";
  if (body?.anonymity && typeof body.anonymity === "string" && body.anonymity.trim()) {
    anonymity = body.anonymity.trim().toLowerCase();
    if (!PUBLIC_PROXY_ANONYMITY_LEVELS.includes(anonymity)) {
      return { error: "Invalid anonymity filter" };
    }
  }

  const httpsOnly = body?.httpsOnly === true;
  const maxSpeedRaw = Number.parseFloat(body?.maxSpeed);
  const maxSpeed = Number.isFinite(maxSpeedRaw) && maxSpeedRaw > 0 ? maxSpeedRaw : null;
  if (maxSpeed && !source.supportsMaxSpeed) {
    return { error: `Speed filter is not supported for ${source.label}` };
  }

  const orderBy = typeof body?.orderBy === "string" && body.orderBy ? body.orderBy : "success";
  if (!source.supportsOrderBy && orderBy !== "success") {
    return { error: `Ordering is not supported for ${source.label}` };
  }

  return { protocol, count, country, anonymity, httpsOnly, maxSpeed, orderBy };
}

// POST /api/proxy-pools/import-public - Import proxies from a public list source
export async function POST(request) {
  if (!await requireDashboardAuth(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const body = await request.json().catch(() => ({}));
    const sourceId = typeof body?.source === "string" ? body.source : "";
    const source = Object.hasOwn(PUBLIC_PROXY_SOURCES, sourceId)
      ? PUBLIC_PROXY_SOURCES[sourceId]
      : null;
    if (!source) {
      return NextResponse.json({ error: "Unknown proxy source" }, { status: 400 });
    }

    const normalized = parseImportRequest(body, source);
    if (normalized.error) {
      return NextResponse.json({ error: normalized.error }, { status: 400 });
    }

    let entries;
    try {
      entries = await fetchPublicProxyEntries(sourceId, normalized);
    } catch (error) {
      const status = error?.status === 429 ? 429 : 502;
      return NextResponse.json({ error: error?.message || "Proxy source fetch failed" }, { status });
    }

    const existing = await getProxyPools();
    const existingKeys = new Set(existing.map((pool) => normalizeProxyUrlKey(pool.proxyUrl)));

    let imported = 0;
    let duplicates = 0;
    let failed = 0;
    const created = [];
    for (const entry of entries) {
      const key = normalizeProxyUrlKey(entry.proxyUrl);
      if (existingKeys.has(key)) {
        duplicates += 1;
        continue;
      }
      existingKeys.add(key);
      try {
        const pool = await createProxyPool({
          name: entry.name,
          proxyUrl: entry.proxyUrl,
          noProxy: "",
          isActive: true,
          type: "http",
        });
        imported += 1;
        created.push({ id: pool.id, name: pool.name, proxyUrl: pool.proxyUrl });
      } catch {
        failed += 1;
      }
    }

    return NextResponse.json({
      source: sourceId,
      file: sourceId === "vpslab" ? resolveVpsLabFile(normalized) : null,
      fetched: entries.length,
      imported,
      duplicates,
      failed,
      created,
      ...(entries.length === 0
        ? { reason: "No currently-valid proxies matched these filters — relax the filters, switch the ordering, or try again later (the list refreshes continuously)." }
        : {}),
    });
  } catch (error) {
    console.log("Error importing public proxies:", error);
    return NextResponse.json({ error: "Failed to import public proxies" }, { status: 500 });
  }
}
