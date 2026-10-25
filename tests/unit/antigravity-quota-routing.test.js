import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getProviderConnections: vi.fn(),
  getSettings: vi.fn(),
  resolveConnectionProxyConfig: vi.fn(),
  getAntigravityUsage: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  getProviderConnections: mocks.getProviderConnections,
  getSettings: mocks.getSettings,
  getProxyPools: vi.fn(),
  validateApiKey: vi.fn(),
  updateProviderConnection: vi.fn(),
}));
vi.mock("@/lib/network/connectionProxy", () => ({
  resolveConnectionProxyConfig: mocks.resolveConnectionProxyConfig,
  pickProxyPoolId: vi.fn(),
}));
vi.mock("@/shared/constants/providers.js", () => ({
  FREE_PROVIDERS: {},
  resolveProviderId: (provider) => provider,
}));
vi.mock("open-sse/services/usage/google.js", () => ({
  getAntigravityUsage: mocks.getAntigravityUsage,
}));
vi.mock("@/sse/utils/logger.js", () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn() }));

const { getAntigravityQuotaCache, handleAntigravityQuotaError, refreshAntigravityQuota } = await import("@/sse/services/antigravityQuota.js");
const { getProviderCredentials } = await import("@/sse/services/auth.js");

const MODEL = "claude-opus-4-6-thinking";
const FUTURE_RESET = "2026-09-01T00:00:00.000Z";

beforeEach(() => {
  vi.clearAllMocks();
  getAntigravityQuotaCache().clear();
  mocks.resolveConnectionProxyConfig.mockResolvedValue({});
  mocks.getSettings.mockResolvedValue({});
});

describe("Antigravity quota-aware routing", () => {
  it("records exhausted upstream quota after 429 and returns its exact reset time", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-26T00:00:00.000Z"));
    mocks.getAntigravityUsage.mockResolvedValue({ quotas: {
      [MODEL]: { remainingPercentage: 0, resetAt: FUTURE_RESET },
    } });

    try {
      await expect(handleAntigravityQuotaError("ag-a", 429, MODEL, "token", {}))
        .resolves.toBe(Date.parse(FUTURE_RESET));
      expect(getAntigravityQuotaCache().get("ag-a")[MODEL]).toEqual({
        remainingPercentage: 0,
        resetAt: FUTURE_RESET,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("skips exhausted account/model and selects the next account", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-26T00:00:00.000Z"));
    mocks.getProviderConnections.mockResolvedValue([
      { id: "ag-a", email: "a@example.com", isActive: true },
      { id: "ag-b", email: "b@example.com", isActive: true },
    ]);
    getAntigravityQuotaCache().set("ag-a", {
      [MODEL]: { remainingPercentage: 0, resetAt: FUTURE_RESET },
    });

    try {
      await expect(getProviderCredentials("antigravity", null, MODEL)).resolves.toMatchObject({
        connectionId: "ag-b",
        connectionName: "b@example.com",
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("reports retry time when every account is cache-blocked", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-26T00:00:00.000Z"));
    mocks.getProviderConnections.mockResolvedValue([{ id: "ag-a", email: "a@example.com", isActive: true }]);
    getAntigravityQuotaCache().set("ag-a", {
      [MODEL]: { remainingPercentage: 0, resetAt: FUTURE_RESET },
    });

    try {
      await expect(getProviderCredentials("antigravity", null, MODEL)).resolves.toMatchObject({
        allRateLimited: true,
        retryAfter: FUTURE_RESET,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("lets account back into rotation once reset time has passed", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-01T00:00:01.000Z"));
    mocks.getProviderConnections.mockResolvedValue([{ id: "ag-a", email: "a@example.com", isActive: true }]);
    getAntigravityQuotaCache().set("ag-a", {
      [MODEL]: { remainingPercentage: 0, resetAt: FUTURE_RESET },
    });

    try {
      await expect(getProviderCredentials("antigravity", null, MODEL)).resolves.toMatchObject({
        connectionId: "ag-a",
        connectionName: "a@example.com",
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("coalesces concurrent quota refreshes for one account", async () => {
    let resolveUsage;
    mocks.getAntigravityUsage.mockReturnValue(new Promise(resolve => { resolveUsage = resolve; }));

    const first = refreshAntigravityQuota("ag-concurrent", "token", {});
    const second = refreshAntigravityQuota("ag-concurrent", "token", {});
    resolveUsage({ quotas: { [MODEL]: { remainingPercentage: 0, resetAt: FUTURE_RESET } } });

    await expect(Promise.all([first, second])).resolves.toEqual([
      { [MODEL]: { remainingPercentage: 0, resetAt: FUTURE_RESET } },
      { [MODEL]: { remainingPercentage: 0, resetAt: FUTURE_RESET } },
    ]);
    expect(mocks.getAntigravityUsage).toHaveBeenCalledTimes(1);
  });

  it("preserves strict proxy policy for usage refresh", async () => {
    mocks.resolveConnectionProxyConfig.mockResolvedValue({ strictProxy: true });
    mocks.getAntigravityUsage.mockResolvedValue({ quotas: {} });

    await refreshAntigravityQuota("ag-strict-proxy", "token", {});

    expect(mocks.getAntigravityUsage).toHaveBeenCalledWith("token", {}, expect.objectContaining({
      strictProxy: true,
    }));
  });

  it("keeps known cache when quota endpoint returns an error payload", async () => {
    const cached = { [MODEL]: { remainingPercentage: 0, resetAt: FUTURE_RESET } };
    getAntigravityQuotaCache().set("ag-error-response", cached);
    mocks.getAntigravityUsage.mockResolvedValue({ message: "Unauthorized", quotas: {} });

    await expect(refreshAntigravityQuota("ag-error-response", "token", {})).resolves.toBeNull();
    expect(getAntigravityQuotaCache().get("ag-error-response")).toBe(cached);
  });

  it("throttles failed refresh attempts for 30 seconds", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-26T00:00:00.000Z"));
    mocks.getAntigravityUsage.mockRejectedValue(new Error("usage unavailable"));

    try {
      await refreshAntigravityQuota("ag-failed-refresh", "token", {});
      await refreshAntigravityQuota("ag-failed-refresh", "token", {});
      expect(mocks.getAntigravityUsage).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(30_000);
      await refreshAntigravityQuota("ag-failed-refresh", "token", {});
      expect(mocks.getAntigravityUsage).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

  it("checks shared family summary quota (claude_gpt_session / weekly)", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-26T00:00:00.000Z"));
    mocks.getAntigravityUsage.mockResolvedValue({
      quotas: {
        claude_gpt_session: { remainingPercentage: 0, resetAt: FUTURE_RESET },
        claude_gpt_weekly: { remainingPercentage: 50, resetAt: "2026-09-02T00:00:00.000Z" },
      }
    });

    try {
      const reset = await handleAntigravityQuotaError("ag-family", 429, "claude-sonnet-5-5", "token", {});
      expect(reset).toBe(Date.parse(FUTURE_RESET));
      expect(getAntigravityQuotaCache().get("ag-family")["claude-sonnet-5-5"]).toMatchObject({
        remainingPercentage: 0,
        resetAt: FUTURE_RESET,
      });

      // auth pre-filter should skip this account for claude-sonnet-5-5 based on cache
      mocks.getProviderConnections.mockResolvedValue([
        { id: "ag-family", email: "family@example.com", isActive: true },
        { id: "ag-other", email: "other@example.com", isActive: true },
      ]);
      const creds = await getProviderCredentials("antigravity", null, "claude-sonnet-5-5");
      expect(creds.connectionId).toBe("ag-other");
    } finally {
      vi.useRealTimers();
    }
  });

  it("checks shared family summary quota for gemini models", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-26T00:00:00.000Z"));
    mocks.getAntigravityUsage.mockResolvedValue({
      quotas: {
        gemini_weekly: { remainingPercentage: 0, resetAt: FUTURE_RESET },
      }
    });

    try {
      const reset = await handleAntigravityQuotaError("ag-gem", 429, "gemini-3.8-flash-high", "token", {});
      expect(reset).toBe(Date.parse(FUTURE_RESET));
      expect(getAntigravityQuotaCache().get("ag-gem")["gemini-3.8-flash-high"]).toMatchObject({
        remainingPercentage: 0,
        resetAt: FUTURE_RESET,
      });
    } finally {
      vi.useRealTimers();
    }
  });
