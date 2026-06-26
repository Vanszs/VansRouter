import { describe, it, expect } from "vitest";

import { getProxyHash } from "../../src/lib/network/connectionProxy.js";
import {
  acquire as acquireAccountSemaphore,
  buildAccountSemaphoreKey,
} from "../../open-sse/services/accountSemaphore.js";
import {
  isProviderInCooldown,
  recordProviderFailure,
  clearProviderFailure,
} from "../../open-sse/services/accountFallback.js";
import { resetAllCircuitBreakers } from "../../open-sse/utils/circuitBreaker.js";

describe("Proxy-aware resilience", () => {
  beforeEach(() => {
    resetAllCircuitBreakers();
  });

  describe("getProxyHash", () => {
    it("returns 'direct' when no proxy is configured", () => {
      expect(getProxyHash({})).toBe("direct");
      expect(getProxyHash({ providerSpecificData: {} })).toBe("direct");
    });

    it("returns 'direct' when connectionProxyEnabled is false", () => {
      expect(getProxyHash({
        connectionProxyEnabled: false,
        connectionProxyUrl: "http://proxy.example.com:8080",
      })).toBe("direct");
    });

    it("returns 'proxy-<hash>' when connectionProxyEnabled and URL present", () => {
      const hash = getProxyHash({
        connectionProxyEnabled: true,
        connectionProxyUrl: "http://proxy-a.example.com:8080",
      });
      expect(hash).toMatch(/^proxy-[a-z0-9]+$/);
    });

    it("returns the same hash for the same proxy URL (stable)", () => {
      const a = getProxyHash({ connectionProxyEnabled: true, connectionProxyUrl: "http://proxy.example.com:8080" });
      const b = getProxyHash({ connectionProxyEnabled: true, connectionProxyUrl: "http://proxy.example.com:8080" });
      expect(a).toBe(b);
    });

    it("returns different hashes for different proxy URLs", () => {
      const a = getProxyHash({ connectionProxyEnabled: true, connectionProxyUrl: "http://proxy-a.example.com:8080" });
      const b = getProxyHash({ connectionProxyEnabled: true, connectionProxyUrl: "http://proxy-b.example.com:8080" });
      expect(a).not.toBe(b);
    });

    it("returns 'pool-<hash>' for proxyPoolId without explicit URL", () => {
      const hash = getProxyHash({ proxyPoolId: "pool-abc" });
      expect(hash).toMatch(/^pool-[a-z0-9]+$/);
    });

    it("explicit proxy URL takes priority over proxy pool", () => {
      const withBoth = getProxyHash({
        connectionProxyEnabled: true,
        connectionProxyUrl: "http://proxy-a.example.com:8080",
        proxyPoolId: "pool-abc",
      });
      expect(withBoth).toMatch(/^proxy-/);
    });
  });

  describe("Semaphore key includes proxyHash", () => {
    it("default proxyHash is 'direct'", () => {
      const key = buildAccountSemaphoreKey({ provider: "kimchi", accountKey: "acc-1" });
      expect(key).toBe("kimchi:acc-1:direct");
    });

    it("same provider+account but different proxyHash produces different keys", () => {
      const k1 = buildAccountSemaphoreKey({ provider: "kimchi", accountKey: "acc-1", proxyHash: "proxy-aaa" });
      const k2 = buildAccountSemaphoreKey({ provider: "kimchi", accountKey: "acc-1", proxyHash: "proxy-bbb" });
      expect(k1).not.toBe(k2);
      expect(k1).toBe("kimchi:acc-1:proxy-aaa");
      expect(k2).toBe("kimchi:acc-1:proxy-bbb");
    });

    it("same (account, proxy) combination reuses the same slot", async () => {
      const key = buildAccountSemaphoreKey({ provider: "test-sem-1", accountKey: "acc-1", proxyHash: "proxy-shared" });

      const releaseA = await acquireAccountSemaphore(key, { maxConcurrency: 1, timeoutMs: 100 });
      try {
        // Second acquire on the same (account, proxy) key should time out
        await expect(
          acquireAccountSemaphore(key, { maxConcurrency: 1, timeoutMs: 50 })
        ).rejects.toThrow();
      } finally {
        releaseA();
      }
    });

    it("accounts on different proxies get independent slots", async () => {
      const keyProxyA = buildAccountSemaphoreKey({ provider: "test-sem-2", accountKey: "acc-1", proxyHash: "proxy-a" });
      const keyProxyB = buildAccountSemaphoreKey({ provider: "test-sem-2", accountKey: "acc-1", proxyHash: "proxy-b" });

      const releaseA = await acquireAccountSemaphore(keyProxyA, { maxConcurrency: 1, timeoutMs: 100 });
      try {
        // Different proxy = different key, should acquire immediately
        const releaseB = await acquireAccountSemaphore(keyProxyB, { maxConcurrency: 1, timeoutMs: 100 });
        releaseB();
      } finally {
        releaseA();
      }
    });
  });

  describe("Circuit breaker is proxy-aware", () => {
    it("default proxyHash is 'direct' — backward compatible", () => {
      expect(isProviderInCooldown("test-cb-1")).toBe(false);
      recordProviderFailure("test-cb-1", 500, "server error", null, "acc-1");
      recordProviderFailure("test-cb-1", 500, "server error", null, "acc-2");
      recordProviderFailure("test-cb-1", 500, "server error", null, "acc-3");
      recordProviderFailure("test-cb-1", 500, "server error", null, "acc-4");
      recordProviderFailure("test-cb-1", 500, "server error", null, "acc-5");
      // After 5 failures on default (direct) bucket, provider:direct breaker opens
      expect(isProviderInCooldown("test-cb-1")).toBe(true);
      // But proxy-X bucket is still CLOSED
      expect(isProviderInCooldown("test-cb-1", "proxy-X")).toBe(false);
    });

    it("failures on one proxy don't affect another proxy's breaker", () => {
      // Trip proxy-a breaker (default direct equivalent for this provider)
      for (let i = 0; i < 5; i++) {
        recordProviderFailure("test-cb-2", 500, "err", null, `acc-${i}`, "proxy-a");
      }
      expect(isProviderInCooldown("test-cb-2", "proxy-a")).toBe(true);
      // proxy-b bucket is unaffected
      expect(isProviderInCooldown("test-cb-2", "proxy-b")).toBe(false);
      // default direct bucket is unaffected
      expect(isProviderInCooldown("test-cb-2")).toBe(false);
    });

    it("clearProviderFailure resets only the specified proxy bucket", () => {
      // Trip both proxy buckets
      for (let i = 0; i < 5; i++) {
        recordProviderFailure("test-cb-3", 500, "err", null, `acc-a-${i}`, "proxy-a");
        recordProviderFailure("test-cb-3", 500, "err", null, `acc-b-${i}`, "proxy-b");
      }
      expect(isProviderInCooldown("test-cb-3", "proxy-a")).toBe(true);
      expect(isProviderInCooldown("test-cb-3", "proxy-b")).toBe(true);

      // Clear only proxy-a
      clearProviderFailure("test-cb-3", "proxy-a");
      expect(isProviderInCooldown("test-cb-3", "proxy-a")).toBe(false);
      expect(isProviderInCooldown("test-cb-3", "proxy-b")).toBe(true);
    });

    it("accounts on different proxies are isolated for dedup too", () => {
      // Same account, different proxies, should not dedup each other
      recordProviderFailure("test-cb-4", 500, "err", null, "acc-1", "proxy-a");
      recordProviderFailure("test-cb-4", 500, "err", null, "acc-1", "proxy-b");
      recordProviderFailure("test-cb-4", 500, "err", null, "acc-1", "proxy-a"); // deduped — no new failure counted
      // After 2 unique failures (one per proxy), neither bucket has 5 yet
      expect(isProviderInCooldown("test-cb-4", "proxy-a")).toBe(false);
      expect(isProviderInCooldown("test-cb-4", "proxy-b")).toBe(false);
    });
  });

  describe("Integration: multi-proxy scenario", () => {
    it("if proxy-a is down, accounts on proxy-b still work", async () => {
      // Simulate: 5 accounts on proxy-a all fail (proxy dies)
      for (let i = 0; i < 5; i++) {
        recordProviderFailure("kimchi", 503, "proxy unreachable", null, `acc-a-${i}`, "proxy-a");
      }
      // proxy-a bucket is OPEN
      expect(isProviderInCooldown("kimchi", "proxy-a")).toBe(true);
      // proxy-b bucket is CLOSED — accounts on proxy-b still usable
      expect(isProviderInCooldown("kimchi", "proxy-b")).toBe(false);
      // direct (no proxy) bucket is CLOSED
      expect(isProviderInCooldown("kimchi")).toBe(false);
    });
  });
});
