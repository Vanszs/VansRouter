import { describe, it, expect, beforeEach, vi } from "vitest";

const state = vi.hoisted(() => ({
  rows: new Map(),
  pools: new Map(),
  updates: [],
}));

vi.mock("@/models", () => ({
  getProxyPoolById: vi.fn(async (poolId) => state.pools.get(poolId) || null),
  listProxyPoolFitness: vi.fn(async (poolId) => [...state.rows.values()].filter((row) => poolId == null || row.poolId === poolId)),
  upsertProxyPoolFitness: vi.fn(async (poolId, scope, until, reason) => {
    const row = { poolId, scope, until, reason };
    state.rows.set(`${poolId}:${scope}`, row);
    return row;
  }),
  deleteProxyPoolFitness: vi.fn(async (poolId, scope) => state.rows.delete(`${poolId}:${scope}`)),
  deleteExpiredProxyPoolFitness: vi.fn(async (until) => {
    for (const [key, row] of [...state.rows]) if (row.until <= until) state.rows.delete(key);
  }),
  clearProxyPoolFitness: vi.fn(async (provider) => {
    for (const [key, row] of [...state.rows]) {
      if (!provider || row.scope.startsWith(`${provider}::`)) state.rows.delete(key);
    }
  }),
  updateProxyPool: vi.fn(async (poolId, data) => {
    state.updates.push([poolId, data]);
    const next = { ...(state.pools.get(poolId) || { id: poolId }), ...data };
    state.pools.set(poolId, next);
    return next;
  }),
}));

import {
  markPoolUnfit, clearPoolUnfit, clearAllPoolUnfit, isPoolFit, fitPoolIds,
  poolFitnessSnapshot, loadPoolFitness, resetPoolFitness, earliestPoolUnfitUntil,
} from "open-sse/services/proxyPoolFitness.js";
import { listProxyPoolFitness, upsertProxyPoolFitness } from "@/models";
import { escapeLikePattern } from "../../src/lib/db/repos/proxyPoolFitnessRepo.js";
import { pickProxyPoolId, resolveConnectionProxyConfig } from "../../src/lib/network/connectionProxy.js";

describe("proxy pool fitness registry", () => {
  beforeEach(async () => {
    state.rows.clear();
    state.pools.clear();
    state.updates.length = 0;
    await resetPoolFitness();
  });

  it("marks scoped pools and prunes expiry", async () => {
    await markPoolUnfit("p1", "freebuff::m1", Date.now() + 60_000);
    expect(isPoolFit("p1", "freebuff::m1")).toBe(false);
    expect(fitPoolIds(["p1", "p2"], "freebuff::m1")).toEqual(["p2"]);
    await markPoolUnfit("p1", "freebuff::m1", Date.now() - 1);
    expect(isPoolFit("p1", "freebuff::m1")).toBe(true);
  });

  it("reports the earliest bench expiry for the requested scope", async () => {
    await markPoolUnfit("p1", "opencode::*", Date.now() + 60_000);
    await markPoolUnfit("p2", "opencode::m", Date.now() + 120_000);
    const until = earliestPoolUnfitUntil(["p1", "p2"], "opencode::m");
    expect(until).toBeGreaterThan(Date.now() + 50_000);
    expect(until).toBeLessThan(Date.now() + 61_000);
  });

  it("supports wildcard and clearing", async () => {
    await markPoolUnfit("p1", "opencode::*", Date.now() + 60_000);
    expect(isPoolFit("p1", "opencode::m")).toBe(false);
    await clearPoolUnfit("p1", "opencode::*");
    expect(isPoolFit("p1", "opencode::m")).toBe(true);
    await markPoolUnfit("p1", "a::m", Date.now() + 60_000);
    await markPoolUnfit("p1", "b::m", Date.now() + 60_000);
    await clearAllPoolUnfit("a");
    expect((await poolFitnessSnapshot()).p1["b::m"]).toBeDefined();
  });

  it("treats % and _ as literals when clearing a provider", async () => {
    await markPoolUnfit("p1", "a::m", Date.now() + 60_000);
    await clearAllPoolUnfit("%");
    expect((await poolFitnessSnapshot()).p1?.["a::m"]).toBeDefined();
    expect(escapeLikePattern("%_\\")).toBe("\\%\\_\\\\");
  });

  it("prunes expired rows through the snapshot", async () => {
    await markPoolUnfit("p1", "x::m", Date.now() - 1);
    expect(await poolFitnessSnapshot()).toEqual({});
    expect(state.rows.size).toBe(0);
  });

  it("preserves concurrent scopes and reloads from durable rows", async () => {
    await Promise.all([
      markPoolUnfit("p1", "provider::a", Date.now() + 60_000, "a"),
      markPoolUnfit("p1", "provider::b", Date.now() + 60_000, "b"),
    ]);
    expect((await poolFitnessSnapshot()).p1).toEqual(expect.objectContaining({
      "provider::a": expect.objectContaining({ reason: "a" }),
      "provider::b": expect.objectContaining({ reason: "b" }),
    }));
    await resetPoolFitness();
    expect(await poolFitnessSnapshot()).toEqual({});
  });

  it("migrates legacy pool JSON once and never resurrects a cleared block", async () => {
    state.pools.set("p1", {
      id: "p1",
      fitness: { "freebuff::m": { until: Date.now() + 60_000, reason: "legacy" } },
    });

    await loadPoolFitness("p1");
    expect(isPoolFit("p1", "freebuff::m")).toBe(false);
    expect(state.updates).toContainEqual(["p1", { fitness: {} }]);

    await clearAllPoolUnfit();
    await loadPoolFitness("p1");
    expect(await poolFitnessSnapshot()).toEqual({});
  });

  it("does not re-read SQLite inside the load TTL", async () => {
    await loadPoolFitness("p1");
    listProxyPoolFitness.mockClear();
    await loadPoolFitness("p1");
    expect(listProxyPoolFitness).not.toHaveBeenCalled();
  });

  it("keeps a mark that lands while a load is reading", async () => {
    // The read returns no rows, then a mark writes and updates the cache before
    // the loader can apply its (empty) result.
    const realList = listProxyPoolFitness.getMockImplementation();
    listProxyPoolFitness.mockImplementationOnce(async (poolId) => {
      await upsertProxyPoolFitness(poolId, "provider::late", Date.now() + 60_000, "late");
      await markPoolUnfit(poolId, "provider::late", Date.now() + 60_000, "late");
      return realList(poolId);
    });
    await loadPoolFitness("p2");
    expect(isPoolFit("p2", "provider::late")).toBe(false);
  });

  it("Smart returns no pool when every scoped pool is unfit", async () => {
    await markPoolUnfit("p1", "provider::model", Date.now() + 60_000);
    await markPoolUnfit("p2", "provider::model", Date.now() + 60_000);
    expect(pickProxyPoolId(["p1", "p2"], "smart", "provider", [], { scope: "provider::model" })).toBeNull();
  });

  it("honors fitness for non-smart strategies", async () => {
    await markPoolUnfit("p1", "provider::model", Date.now() + 60_000);
    expect(pickProxyPoolId(["p1", "p2"], "round-robin", "provider", [], { scope: "provider::model" })).toBe("p2");
    await markPoolUnfit("p2", "provider::model", Date.now() + 60_000);
    expect(pickProxyPoolId(["p1", "p2"], "round-robin", "provider", [], { scope: "provider::model" })).toBeNull();
  });

  it("honors the selected pool first and rotates when it is excluded", async () => {
    state.pools.set("p1", { id: "p1", isActive: true, proxyUrl: "http://a" });
    state.pools.set("p2", { id: "p2", isActive: true, proxyUrl: "http://b" });
    const psd = {
      proxyPoolId: "p1",
      proxyPoolIds: ["p1", "p2"],
      proxyRotationStrategy: "round-robin",
      proxyPoolScope: "provider::model",
    };
    expect((await resolveConnectionProxyConfig(psd)).proxyPoolId).toBe("p1");
    expect((await resolveConnectionProxyConfig(psd, null, ["p1"])).proxyPoolId).toBe("p2");
  });

  it("returns a Freebuff no-fit result instead of falling back to direct egress", async () => {
    await markPoolUnfit("p1", "freebuff::model", Date.now() + 60_000);
    const result = await resolveConnectionProxyConfig({
      proxyPoolIds: ["p1"],
      proxyRotationStrategy: "smart",
      proxyPoolScope: "freebuff::model",
    });
    expect(result).toMatchObject({ noFitPool: true, strictProxy: true });
    expect(result.connectionProxyEnabled).toBe(false);
  });

  it("fails closed for an invalid explicitly selected Freebuff pool", async () => {
    const result = await resolveConnectionProxyConfig({
      proxyPoolId: "missing",
      proxyPoolScope: "freebuff::model",
    });
    expect(result).toMatchObject({ noFitPool: true, strictProxy: true });
  });
});
