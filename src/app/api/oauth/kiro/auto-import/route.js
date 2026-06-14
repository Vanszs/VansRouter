import { NextResponse } from "next/server";
import { readFile, readdir } from "fs/promises";
import { homedir } from "os";
import { join } from "path";

const CACHE_TTL = 3000; // 3 seconds
let _cache = { result: null, ts: 0 };

/** Scan AWS SSO cache for Kiro refresh token */
async function scanForKiroToken() {
  const now = Date.now();
  if (_cache.result && now - _cache.ts < CACHE_TTL) return _cache.result;

  const cachePath = join(homedir(), ".aws/sso/cache");
  let files;
  try {
    files = await readdir(cachePath);
  } catch {
    const r = { found: false, error: "AWS SSO cache not found. Please login to Kiro IDE first." };
    _cache = { result: r, ts: now };
    return r;
  }

  let refreshToken = null;
  let foundFile = null;

  const kiroTokenFile = "kiro-auth-token.json";
  if (files.includes(kiroTokenFile)) {
    try {
      const data = JSON.parse(await readFile(join(cachePath, kiroTokenFile), "utf-8"));
      if (data.refreshToken?.startsWith("aorAAAAAG")) {
        refreshToken = data.refreshToken;
        foundFile = kiroTokenFile;
      }
    } catch { /* continue */ }
  }

  if (!refreshToken) {
    const jsonFiles = files.filter(f => f.endsWith(".json"));
    const results = await Promise.all(
      jsonFiles.map(async (file) => {
        try {
          const data = JSON.parse(await readFile(join(cachePath, file), "utf-8"));
          if (data.refreshToken?.startsWith("aorAAAAAG")) return { refreshToken: data.refreshToken, file };
        } catch { /* skip */ }
        return null;
      })
    );
    const found = results.find(Boolean);
    if (found) {
      refreshToken = found.refreshToken;
      foundFile = found.file;
    }
  }

  const r = refreshToken
    ? { found: true, refreshToken, source: foundFile }
    : { found: false, error: "Kiro token not found in AWS SSO cache. Please login to Kiro IDE first." };
  _cache = { result: r, ts: now };
  return r;
}

/**
 * GET /api/oauth/kiro/auto-import
 * Auto-detect and extract Kiro refresh token from AWS SSO cache
 */
export async function GET() {
  try {
    const result = await scanForKiroToken();
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { found: false, error: error.message },
      { status: 500 }
    );
  }
}
