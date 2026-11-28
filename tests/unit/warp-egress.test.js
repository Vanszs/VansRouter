import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  execFile: vi.fn(),
  inspectRunning: true,
}));

vi.mock("node:child_process", () => ({ execFile: mocks.execFile }));

const dockerRun = () => mocks.execFile.mock.calls.find(([, args]) => args?.[0] === "run")?.[1];
const dockerRuns = () => mocks.execFile.mock.calls.filter(([, args]) => args?.[0] === "run").length;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.inspectRunning = true;
  mocks.execFile.mockImplementation((file, args, options, cb) => {
    const out = args?.[0] === "inspect"
      ? String(mocks.inspectRunning)
      : (file === "curl" ? "ip=104.28.222.43\nwarp=on\n" : "");
    cb(null, { stdout: out, stderr: "" }, "");
  });
});

describe("scoped WARP egress", () => {
  it("recreates the local container and reports the new address", async () => {
    const { rotateWarpEgress, WARP_EGRESS_URL } = await import("../../open-sse/services/warpEgress.js");
    const result = await rotateWarpEgress();
    expect(result).toMatchObject({ ok: true, ip: "104.28.222.43", reused: false });
    expect(mocks.execFile).toHaveBeenNthCalledWith(1, "docker", ["rm", "-f", "warp-socks"], expect.anything(), expect.any(Function));
    const args = dockerRun();
    expect(args).toEqual(expect.arrayContaining([
      "--name", "warp-socks",
      "-p", "127.0.0.1:9091:9091",
      "ghcr.io/mon-ius/docker-warp-socks:latest",
    ]));
    expect(WARP_EGRESS_URL).toBe("http://127.0.0.1:9091");
  });

  it("reuses the address inside the cooldown window instead of re-registering", async () => {
    const { rotateWarpEgress } = await import("../../open-sse/services/warpEgress.js");
    await rotateWarpEgress();
    const runsBefore = dockerRuns();
    const second = await rotateWarpEgress();
    expect(second).toMatchObject({ ok: true, reused: true });
    expect(second.retryAfterMs).toBeGreaterThan(0);
    expect(dockerRuns()).toBe(runsBefore);
  });

  it("recreates when the cooldown is active but the container is gone", async () => {
    const { rotateWarpEgress } = await import("../../open-sse/services/warpEgress.js");
    await rotateWarpEgress();
    const runsBefore = dockerRuns();
    mocks.inspectRunning = false;
    const second = await rotateWarpEgress();
    expect(second).toMatchObject({ ok: true, reused: false });
    expect(dockerRuns()).toBe(runsBefore + 1);
  });

  it("shares one recreation across concurrent refusals", async () => {
    vi.resetModules();
    process.env.WARP_EGRESS_MIN_ROTATE_INTERVAL_MS = "0";
    try {
      const { rotateWarpEgress } = await import("../../open-sse/services/warpEgress.js?concurrent");
      const [a, b] = await Promise.all([rotateWarpEgress(), rotateWarpEgress()]);
      expect(a).toMatchObject({ ok: true });
      expect(b).toMatchObject({ ok: true });
      expect(dockerRuns()).toBe(1);
    } finally {
      delete process.env.WARP_EGRESS_MIN_ROTATE_INTERVAL_MS;
    }
  });
});
