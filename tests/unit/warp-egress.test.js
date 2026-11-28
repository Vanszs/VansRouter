import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  execFile: vi.fn(),
}));

vi.mock("node:child_process", () => ({ execFile: mocks.execFile }));

const dockerRun = () => mocks.execFile.mock.calls.find(([, args]) => args?.[0] === "run")?.[1];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.execFile.mockImplementation((file, args, options, cb) => cb(
    null,
    { stdout: file === "curl" ? "ip=104.28.222.43\nwarp=on\n" : "", stderr: "" },
    "",
  ));
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
    const runsBefore = mocks.execFile.mock.calls.filter(([, args]) => args?.[0] === "run").length;
    const second = await rotateWarpEgress();
    expect(second).toMatchObject({ ok: true, reused: true });
    expect(second.retryAfterMs).toBeGreaterThan(0);
    expect(mocks.execFile.mock.calls.filter(([, args]) => args?.[0] === "run").length).toBe(runsBefore);
  });

  it("shares one recreation across concurrent refusals", async () => {
    vi.resetModules();
    process.env.WARP_EGRESS_MIN_ROTATE_INTERVAL_MS = "0";
    try {
      const { rotateWarpEgress } = await import("../../open-sse/services/warpEgress.js?concurrent");
      const [a, b] = await Promise.all([rotateWarpEgress(), rotateWarpEgress()]);
      expect(a).toMatchObject({ ok: true });
      expect(b).toMatchObject({ ok: true });
      expect(mocks.execFile.mock.calls.filter(([, args]) => args?.[0] === "run").length).toBe(1);
    } finally {
      delete process.env.WARP_EGRESS_MIN_ROTATE_INTERVAL_MS;
    }
  });
});
