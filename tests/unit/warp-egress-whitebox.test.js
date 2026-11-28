// White-box coverage for the WARP egress branches that the black-box stress
// test cannot reach deterministically: docker failures, probe outages, the
// readiness deadline, and environment overrides.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ execFile: vi.fn() }));

vi.mock("node:child_process", () => ({ execFile: mocks.execFile }));

async function load(env = {}) {
  vi.resetModules();
  process.env.WARP_EGRESS_MIN_ROTATE_INTERVAL_MS = "0";
  Object.assign(process.env, env);
  return import("../../open-sse/services/warpEgress.js");
}

const isRun = ([, args]) => args?.[0] === "run";
const isCurl = ([file]) => file === "curl";

function okDocker(cb) {
  cb(null, { stdout: "", stderr: "" }, "");
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
  for (const key of [
    "WARP_EGRESS_MIN_ROTATE_INTERVAL_MS",
    "WARP_EGRESS_PORT",
    "WARP_EGRESS_CONTAINER",
    "WARP_EGRESS_IMAGE",
  ]) delete process.env[key];
});

describe("WARP probe parsing", () => {
  it("accepts only warp=on with an address", async () => {
    const { probeWarpEgress } = await load();
    mocks.execFile.mockImplementation((file, args, options, cb) => cb(null, {
      stdout: "ip=104.28.222.46\nwarp=on\n",
      stderr: "",
    }, ""));
    await expect(probeWarpEgress()).resolves.toEqual({ ok: true, ip: "104.28.222.46" });

    mocks.execFile.mockImplementation((file, args, options, cb) => cb(null, {
      stdout: "ip=104.28.222.46\nwarp=off\n",
      stderr: "",
    }, ""));
    await expect(probeWarpEgress()).resolves.toEqual({ ok: false, ip: "104.28.222.46" });

    mocks.execFile.mockImplementation((file, args, options, cb) => cb(null, { stdout: "", stderr: "" }, ""));
    await expect(probeWarpEgress()).resolves.toEqual({ ok: false, ip: null });
  });

  it("propagates a curl failure to the rotation loop", async () => {
    const { probeWarpEgress } = await load();
    mocks.execFile.mockImplementation((file, args, options, cb) => cb(new Error("curl: (7) refused")));
    await expect(probeWarpEgress()).rejects.toThrow("refused");
  });
});

describe("WARP rotation failure branches", () => {
  it("ignores a failed docker rm and still starts the new container", async () => {
    const { rotateWarpEgress } = await load();
    mocks.execFile.mockImplementation((file, args, options, cb) => {
      if (args?.[0] === "rm") return cb(new Error("no such container"));
      if (isRun([file, args])) return okDocker(cb);
      cb(null, { stdout: "ip=203.0.113.7\nwarp=on\n", stderr: "" }, "");
    });
    await expect(rotateWarpEgress()).resolves.toMatchObject({ ok: true, ip: "203.0.113.7" });
    expect(mocks.execFile.mock.calls.filter(isRun)).toHaveLength(1);
  });

  it("rejects when docker run fails and releases the lock for a retry", async () => {
    const { rotateWarpEgress } = await load();
    let runs = 0;
    mocks.execFile.mockImplementation((file, args, options, cb) => {
      if (isRun([file, args])) {
        runs++;
        return runs === 1 ? cb(new Error("name already in use")) : okDocker(cb);
      }
      cb(null, { stdout: "ip=203.0.113.7\nwarp=on\n", stderr: "" }, "");
    });

    await expect(rotateWarpEgress()).rejects.toThrow("name already in use");
    await expect(rotateWarpEgress()).resolves.toMatchObject({ ok: true });
    expect(runs).toBe(2);
  });

  it("gives up after the readiness deadline and keeps the lock reusable", async () => {
    vi.useFakeTimers();
    const { rotateWarpEgress } = await load();
    mocks.execFile.mockImplementation((file, args, options, cb) => {
      if (isCurl([file])) return cb(new Error("tunnel not ready"));
      okDocker(cb);
    });

    const pending = rotateWarpEgress({ waitMs: 3_000 });
    await vi.advanceTimersByTimeAsync(10_000);
    await expect(pending).resolves.toEqual({ ok: false, ip: null, reused: false });
  });
});

describe("WARP environment overrides", () => {
  it("uses the configured container, port and image", async () => {
    const { rotateWarpEgress, WARP_EGRESS_URL } = await load({
      WARP_EGRESS_CONTAINER: "warp-custom",
      WARP_EGRESS_PORT: "9191",
      WARP_EGRESS_IMAGE: "example/warp:test",
    });
    mocks.execFile.mockImplementation((file, args, options, cb) => {
      if (isCurl([file])) return cb(null, { stdout: "ip=203.0.113.8\nwarp=on\n", stderr: "" }, "");
      okDocker(cb);
    });

    await rotateWarpEgress();
    expect(WARP_EGRESS_URL).toBe("http://127.0.0.1:9191");
    expect(mocks.execFile.mock.calls.find(([, args]) => args?.[0] === "rm")?.[1])
      .toEqual(["rm", "-f", "warp-custom"]);
    expect(mocks.execFile.mock.calls.find(isRun)?.[1]).toEqual(expect.arrayContaining([
      "--name", "warp-custom",
      "-p", "127.0.0.1:9191:9091",
      "example/warp:test",
    ]));
  });
});
