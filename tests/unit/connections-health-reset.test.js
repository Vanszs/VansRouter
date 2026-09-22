import { beforeAll, afterAll, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { isModelLockActive } from "open-sse/services/accountFallback.js";

const originalDataDir = process.env.DATA_DIR;
const originalFetch = global.fetch;
let tempDir;
let sqliteDb;

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-health-reset-"));
  process.env.DATA_DIR = tempDir;
  vi.resetModules();
  sqliteDb = await import("@/lib/db/index.js");
  await sqliteDb.initDb();
});

afterAll(() => {
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

describe("provider connection health reset", () => {
  it("clears routing state after activation", async () => {
    const connection = await sqliteDb.createProviderConnection({
      provider: "health-reset-update",
      authType: "oauth",
      email: "update@example.com",
      accessToken: "old-token",
    });
    await sqliteDb.updateProviderConnection(connection.id, {
      testStatus: "unavailable",
      lastError: "Access denied",
      lastErrorAt: "2026-09-05T00:00:00.000Z",
      errorCode: 403,
      backoffLevel: 3,
      rateLimitedUntil: "2099-01-01T00:00:00.000Z",
      modelLock_modelA: "2099-01-01T00:00:00.000Z",
    });

    await sqliteDb.updateProviderConnection(connection.id, { testStatus: "active" });

    expect(await sqliteDb.getProviderConnectionById(connection.id)).toMatchObject({
      testStatus: "active",
      lastError: null,
      lastErrorAt: null,
      errorCode: null,
      backoffLevel: 0,
      rateLimitedUntil: null,
      modelLock_modelA: null,
    });
  });

  it("clears routing state when valid OAuth credentials are re-saved", async () => {
    const existing = await sqliteDb.createProviderConnection({
      provider: "health-reset-resave",
      authType: "oauth",
      email: "resave@example.com",
      accessToken: "old-token",
    });
    await sqliteDb.updateProviderConnection(existing.id, {
      testStatus: "unavailable",
      lastError: "Access denied",
      errorCode: 403,
      backoffLevel: 2,
      modelLock_modelA: "2099-01-01T00:00:00.000Z",
    });

    const resaved = await sqliteDb.createProviderConnection({
      provider: "health-reset-resave",
      authType: "oauth",
      email: "resave@example.com",
      accessToken: "new-token",
      testStatus: "active",
    });

    expect(resaved.id).toBe(existing.id);
    expect(await sqliteDb.getProviderConnectionById(existing.id)).toMatchObject({
      accessToken: "new-token",
      testStatus: "active",
      lastError: null,
      errorCode: null,
      backoffLevel: 0,
      modelLock_modelA: null,
    });
  });

  it("preserves an active soft warning while resetting routing state", async () => {
    const connection = await sqliteDb.createProviderConnection({
      provider: "health-reset-warning",
      authType: "oauth",
      email: "warning@example.com",
    });
    await sqliteDb.updateProviderConnection(connection.id, {
      testStatus: "unavailable",
      lastError: "Old failure",
      modelLock_modelA: "2099-01-01T00:00:00.000Z",
    });
    const warningAt = "2026-09-06T00:00:00.000Z";

    await sqliteDb.updateProviderConnection(connection.id, {
      testStatus: "active",
      lastError: "Connected, but credits are exhausted",
      lastErrorAt: warningAt,
    });

    expect(await sqliteDb.getProviderConnectionById(connection.id)).toMatchObject({
      testStatus: "active",
      lastError: "Connected, but credits are exhausted",
      lastErrorAt: warningAt,
      errorCode: null,
      backoffLevel: 0,
      modelLock_modelA: null,
    });
  });
});

const STALE_HEALTH = {
  testStatus: "unavailable",
  lastError: "429 Too Many Requests",
  lastErrorAt: "2026-09-05T00:00:00.000Z",
  errorCode: 429,
  backoffLevel: 4,
  rateLimitedUntil: "2099-01-01T00:00:00.000Z",
  "modelLock_gpt-4o": "2099-01-01T00:00:00.000Z",
};

async function seedStaleConnection(provider) {
  const connection = await sqliteDb.createProviderConnection({
    provider,
    authType: "apikey",
    name: `${provider}-stale`,
    apiKey: "sk-stale",
  });
  await sqliteDb.updateProviderConnection(connection.id, { ...STALE_HEALTH });
  return connection;
}

describe("provider connection re-validation (test route path)", () => {
  afterAll(() => {
    global.fetch = originalFetch;
  });

  it("makes a stale, locked connection usable after a successful re-validation", async () => {
    const connection = await seedStaleConnection("openai");
    global.fetch = vi.fn(async () => new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } }));

    const { testSingleConnection } = await import("../../src/app/api/providers/[id]/test/testUtils.js");
    const result = await testSingleConnection(connection.id);
    expect(result.valid).toBe(true);

    const back = await sqliteDb.getProviderConnectionById(connection.id);
    expect(back).toMatchObject({
      testStatus: "active",
      lastError: null,
      lastErrorAt: null,
      errorCode: null,
      backoffLevel: 0,
      rateLimitedUntil: null,
      "modelLock_gpt-4o": null,
    });
    expect(isModelLockActive(back, "gpt-4o")).toBe(false);
    const active = await sqliteDb.getProviderConnections({ provider: "openai", isActive: true });
    expect(active.map((c) => c.id)).toContain(connection.id);
  });

  it("keeps the rate-limited state when the re-validation fails", async () => {
    const connection = await seedStaleConnection("deepseek");
    global.fetch = vi.fn(async () => new Response(JSON.stringify({ error: "rate limited" }), { status: 429 }));

    const { testSingleConnection } = await import("../../src/app/api/providers/[id]/test/testUtils.js");
    const result = await testSingleConnection(connection.id);
    expect(result.valid).toBe(false);

    const back = await sqliteDb.getProviderConnectionById(connection.id);
    expect(back).toMatchObject({
      testStatus: "error",
      errorCode: 429,
      backoffLevel: 4,
      rateLimitedUntil: STALE_HEALTH.rateLimitedUntil,
      "modelLock_gpt-4o": STALE_HEALTH["modelLock_gpt-4o"],
    });
    expect(isModelLockActive(back, "gpt-4o")).toBe(true);
  });
});
