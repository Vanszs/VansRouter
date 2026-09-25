import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  parseArgs,
  waitForJson,
  platformPair,
  ensureImageForPlatform,
  verifyContainerOpenClosure,
} = require("../../scripts/smoke-container.cjs");

describe("container release smoke test", () => {
  it("parses image, version, and platform", () => {
    expect(parseArgs(["ghcr.io/example/app@sha256:abc", "1.2.3", "--platform", "linux/arm64", "--pull"])).toEqual({
      image: "ghcr.io/example/app@sha256:abc",
      expectedVersion: "1.2.3",
      platform: "linux/arm64",
      pull: true,
    });
  });

  it("re-pulls a local image when its platform does not match", () => {
    expect(platformPair("linux/arm64")).toBe("linux/arm64");
    let localPlatform = "linux/amd64";
    const calls = [];
    ensureImageForPlatform("example/image", "linux/arm64", {
      inspectFn: () => localPlatform,
      dockerFn: (args) => {
        calls.push(args);
        if (args[0] === "pull") localPlatform = "linux/arm64";
      },
    });
    expect(calls).toEqual([
      ["image", "rm", "example/image"],
      ["pull", "--platform", "linux/arm64", "example/image"],
    ]);
  });

  it("checks the bundled open dependency closure inside the container", () => {
    const calls = [];
    verifyContainerOpenClosure("smoke-container", (args, options) => calls.push({ args, options }));
    expect(calls).toHaveLength(1);
    expect(calls[0].args.slice(0, 3)).toEqual(["exec", "smoke-container", "node"]);
    expect(calls[0].args[4]).toContain("wsl-utils");
  });

  it("retries transient HTTP failures and returns validated JSON", async () => {
    let calls = 0;
    const result = await waitForJson(
      "http://127.0.0.1:1234/api/ready",
      (body) => body.ready === true,
      {
        timeoutMs: 1000,
        intervalMs: 1,
        request: async () => {
          calls += 1;
          return calls < 3
            ? { status: 503, body: "{}" }
            : { status: 200, body: { ready: true } };
        },
      },
    );

    expect(calls).toBe(3);
    expect(result).toEqual({ ready: true });
  });
});
