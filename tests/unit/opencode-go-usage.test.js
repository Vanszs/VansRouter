import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: vi.fn(),
}));

import { proxyAwareFetch } from "../../open-sse/utils/proxyFetch.js";
import { getUsageForProvider } from "../../open-sse/services/usage.js";
import {
  USAGE_APIKEY_PROVIDERS,
  USAGE_SUPPORTED_PROVIDERS,
} from "../../src/shared/constants/providers.js";

const USAGE_URL = "https://opencode.ai/inference/go/v1/usage";

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("OpenCode Go usage integration", () => {
  beforeEach(() => vi.clearAllMocks());

  it("advertises API-key usage and normalizes quota data", async () => {
    expect(USAGE_SUPPORTED_PROVIDERS).toContain("opencode-go");
    expect(USAGE_APIKEY_PROVIDERS).toContain("opencode-go");
    proxyAwareFetch.mockResolvedValueOnce(jsonResponse({
      usage: {
        rolling: { percent: 13, resetsAt: "2026-09-04T14:28:02.617Z" },
        weekly: { percent: 5, resetsAt: "2026-09-07T00:00:00.617Z" },
        monthly: { percent: 2, resetsAt: "2026-10-02T12:14:24.617Z" },
      },
    }));

    const usage = await getUsageForProvider({ provider: "opencode-go", apiKey: "sk-go-test" });

    expect(proxyAwareFetch).toHaveBeenCalledWith(
      USAGE_URL,
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({ Authorization: "Bearer sk-go-test" }),
      }),
      null,
    );
    expect(usage).toMatchObject({
      plan: "OpenCode Go",
      quotas: {
        Rolling: { used: 13, remainingPercentage: 87 },
        Weekly: { used: 5, remainingPercentage: 95 },
        Monthly: { used: 2, remainingPercentage: 98 },
      },
    });
  });

  it("reports missing, rejected, and unavailable usage responses", async () => {
    const missing = await getUsageForProvider({ provider: "opencode-go" });
    expect(missing.message).toMatch(/api key/i);
    expect(proxyAwareFetch).not.toHaveBeenCalled();

    proxyAwareFetch.mockResolvedValueOnce(jsonResponse({}, 401));
    await expect(getUsageForProvider({ provider: "opencode-go", apiKey: "bad" })).resolves.toMatchObject({
      message: expect.stringMatching(/authentication failed/i),
    });

    proxyAwareFetch.mockResolvedValueOnce(jsonResponse({}, 500));
    await expect(getUsageForProvider({ provider: "opencode-go", apiKey: "sk-go-test" })).resolves.toMatchObject({
      message: expect.stringContaining("500"),
    });
  });
});
