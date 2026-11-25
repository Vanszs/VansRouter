import { describe, it, expect, vi, beforeEach } from "vitest";

const { baseExecuteMock } = vi.hoisted(() => ({ baseExecuteMock: vi.fn() }));

vi.mock("../../open-sse/executors/base.js", () => ({
  BaseExecutor: class {
    constructor() {
      this.config = { baseUrl: "https://opencode.ai/zen/v1" };
    }
    async execute(args) {
      return baseExecuteMock(args);
    }
  },
}));

const { OpenCodeExecutor } = await import("../../open-sse/executors/opencode.js");

const overload = () => new Response(JSON.stringify({
  error: { type: "server_error", message: "The inference service is overloaded. Please try again later." },
}), { status: 429 });
const quota = () => new Response(JSON.stringify({
  error: { type: "FreeUsageLimitError", message: "Free usage limit reached" },
}), { status: 429 });

describe("OpenCode free-lane overload retry", () => {
  beforeEach(() => baseExecuteMock.mockReset());

  it("retries a transient overload and returns the next response", async () => {
    const ok = new Response("{}", { status: 200 });
    baseExecuteMock.mockResolvedValueOnce({ response: overload() }).mockResolvedValueOnce({ response: ok });

    const result = await new OpenCodeExecutor().execute({ model: "m", body: {}, signal: undefined });

    expect(baseExecuteMock).toHaveBeenCalledTimes(2);
    expect(result.response.status).toBe(200);
  });

  it("delivers a real free-tier quota 429 without retrying", async () => {
    const limited = quota();
    baseExecuteMock.mockResolvedValue({ response: limited });

    const result = await new OpenCodeExecutor().execute({ model: "m", body: {} });

    expect(baseExecuteMock).toHaveBeenCalledTimes(1);
    expect(result.response.status).toBe(429);
  });

  it("never retries a 403", async () => {
    baseExecuteMock.mockResolvedValue({ response: new Response("no", { status: 403 }) });

    const result = await new OpenCodeExecutor().execute({ model: "m", body: {} });

    expect(baseExecuteMock).toHaveBeenCalledTimes(1);
    expect(result.response.status).toBe(403);
  });
});
