import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: vi.fn() }));

import { proxyAwareFetch } from "../../open-sse/utils/proxyFetch.js";
import { getUsageForProvider } from "../../open-sse/services/usage.js";
import { USAGE_SUPPORTED_PROVIDERS } from "../../src/shared/constants/providers.js";

const URLS = [
  "https://api2.cursor.sh/aiserver.v1.DashboardService/GetCurrentPeriodUsage",
  "https://api2.cursor.sh/aiserver.v1.DashboardService/GetPlanInfo",
];
const response = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "Content-Type": "application/json" },
});

describe("Cursor usage", () => {
  beforeEach(() => vi.clearAllMocks());

  it("registers and normalizes plan, on-demand, and request quotas", async () => {
    expect(USAGE_SUPPORTED_PROVIDERS).toContain("cursor");
    proxyAwareFetch
      .mockResolvedValueOnce(response({ billingCycleEnd: "2026-11-01T00:00:00Z", planUsage: { limit: 2000, includedSpend: 500, remaining: 1500, totalPercentUsed: 25, autoPercentUsed: 40, apiPercentUsed: 10 }, spendLimitUsage: { individualLimit: 1000, individualUsed: 200, individualRemaining: 800 } }))
      .mockResolvedValueOnce(response({ planInfo: { planName: "Pro" } }));

    const usage = await getUsageForProvider({
      provider: "cursor",
      accessToken: "cursor-token",
      providerSpecificData: { machineId: "machine-id" },
    }, { proxyPoolId: "pool" });

    expect(proxyAwareFetch).toHaveBeenCalledTimes(2);
    expect(proxyAwareFetch.mock.calls.map(([url]) => url)).toEqual(URLS);
    expect(proxyAwareFetch.mock.calls[0][1].headers["x-cursor-client-version"]).toBeTruthy();
    expect(proxyAwareFetch.mock.calls.every(([, , options]) => options?.proxyPoolId === "pool")).toBe(true);
    expect(usage).toMatchObject({
      plan: "Cursor Pro",
      quotas: {
        "Plan (USD)": { used: 5, total: 20, remainingPercentage: 75 },
        "Auto models (%)": { used: 40, total: 100, remainingPercentage: 60 },
        "Named models (%)": { used: 10, total: 100, remainingPercentage: 90 },
        "On-demand (USD)": { used: 2, total: 10, remainingPercentage: 80 },
      },
    });
  });

  it("rejects missing tokens and returns available buckets when one endpoint fails", async () => {
    await expect(getUsageForProvider({ provider: "cursor" })).resolves.toMatchObject({
      message: expect.stringMatching(/token not available/i),
    });
    proxyAwareFetch
      .mockResolvedValueOnce(response({}, 500))
      .mockResolvedValueOnce(response({ startOfMonth: "2026-10-01T00:00:00Z", premium: { numRequests: 2, maxRequestUsage: 10 } }, 200))
      .mockResolvedValueOnce(response({ planInfo: { planName: "Pro" } }));

    await expect(getUsageForProvider({ provider: "cursor", accessToken: "x" })).resolves.toMatchObject({
      plan: "Cursor Pro",
      quotas: { "premium requests": { used: 2, total: 10 } },
    });
  });
});
