// Usage chart data: per-bucket request counts + the "all" period spanning
// every recorded day.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

const originalDataDir = process.env.DATA_DIR;
let tempDir;
let db;

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-chart-periods-"));
  process.env.DATA_DIR = tempDir;
  vi.resetModules();
  db = await import("@/lib/db/index.js");
  await db.initDb();
});

afterAll(() => {
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

describe("getChartData periods", () => {
  it("all: no recorded days → empty array", async () => {
    expect(await db.getChartData("all")).toEqual([]);
  });

  it("all: spans earliest recorded day through today and counts requests", async () => {
    const old = new Date();
    old.setDate(old.getDate() - 10);
    old.setHours(12, 0, 0, 0);

    await db.saveRequestUsage({ timestamp: old.toISOString(), provider: "openai", model: "gpt-4", connectionId: "c1", tokens: { prompt_tokens: 10, completion_tokens: 5 }, status: "ok" });
    await db.saveRequestUsage({ provider: "anthropic", model: "claude-sonnet-4-6", connectionId: "c2", tokens: { prompt_tokens: 20, completion_tokens: 7 }, status: "ok" });
    await db.saveRequestUsage({ provider: "anthropic", model: "claude-sonnet-4-6", connectionId: "c2", tokens: { prompt_tokens: 21, completion_tokens: 8 }, status: "ok" });

    const data = await db.getChartData("all");
    expect(data).toHaveLength(11);
    expect(data.every((d) => typeof d.requests === "number")).toBe(true);

    expect(data.reduce((sum, d) => sum + d.requests, 0)).toBe(3);
    expect(data[0].requests).toBe(1);
    expect(data[0].tokens).toBe(15);

    expect(data[data.length - 1].label).toBe(new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" }));
    expect(data[data.length - 1].requests).toBe(2);
    expect(data[data.length - 1].tokens).toBe(56);
  });

  it("fixed windows keep their bucket count and carry requests", async () => {
    const week = await db.getChartData("7d");
    expect(week).toHaveLength(7);
    expect(week.every((d) => typeof d.requests === "number")).toBe(true);
    expect(week[week.length - 1].requests).toBe(2);

    const month = await db.getChartData("30d");
    expect(month).toHaveLength(30);

    const hours = await db.getChartData("24h");
    expect(hours).toHaveLength(24);
    expect(hours.reduce((sum, d) => sum + d.requests, 0)).toBe(2);
  });
});

describe("GET /api/usage/chart", () => {
  it("accepts the all period and still rejects unknown ones", async () => {
    const { GET } = await import("../../src/app/api/usage/chart/route.js");

    const ok = await GET(new Request("http://localhost/api/usage/chart?period=all"));
    expect(ok.status).toBe(200);
    const all = await ok.json();
    expect(Array.isArray(all)).toBe(true);
    expect(all.length).toBeGreaterThan(0);
    expect(all.every((d) => typeof d.requests === "number")).toBe(true);

    const bad = await GET(new Request("http://localhost/api/usage/chart?period=90d"));
    expect(bad.status).toBe(400);
  });
});
