import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { auth } = vi.hoisted(() => ({ auth: vi.fn() }));
vi.mock("@/lib/auth/routeAuth.js", () => ({ requireDashboardAuth: auth }));
vi.mock("@/models", () => ({
  getProxyPoolById: vi.fn(),
  updateProxyPool: vi.fn(),
  deleteProxyPool: vi.fn(),
  getProviderConnections: vi.fn(),
  createProxyPool: vi.fn(),
}));
vi.mock("@/lib/network/proxyTest", () => ({ testProxyUrl: vi.fn() }));
vi.mock("open-sse/services/proxyPoolFitness.js", () => ({
  poolFitnessSnapshot: vi.fn(),
  clearAllPoolUnfit: vi.fn(),
  clearPoolUnfit: vi.fn(),
}));

import { DELETE } from "@/app/api/proxy-pools/[id]/route.js";
import { GET as fitness } from "@/app/api/proxy-pools/fitness/route.js";
import { POST as clearAll } from "@/app/api/proxy-pools/fitness/clear-all/route.js";
import { POST as importPublic } from "@/app/api/proxy-pools/import-public/route.js";

const request = () => new Request("http://localhost/api/proxy-pools", { method: "GET" });

describe("proxy-pools dashboard auth", () => {
  beforeEach(() => auth.mockResolvedValue(false));

  it.each([
    ["DELETE /[id]", () => DELETE(request(), { params: Promise.resolve({ id: "p1" }) })],
    ["GET /fitness", () => fitness(request())],
    ["POST /fitness/clear-all", () => clearAll(new Request(request().url, { method: "POST" }))],
    ["POST /import-public", () => importPublic(new Request("http://localhost/api/proxy-pools/import-public", { method: "POST" }))],
  ])("rejects unauthenticated %s before handler work", async (_name, call) => {
    const response = await call();
    expect(response.status).toBe(401);
  });
});

afterEach(() => vi.clearAllMocks());
