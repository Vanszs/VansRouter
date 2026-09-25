import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { defaultDataDir, resolveRuntimePaths } = require("../../scripts/runtime-paths.cjs");
const { readPm2App, readPm2Environment } = require("../../scripts/deploy-atomic.cjs");

describe("runtime paths and PM2 state", () => {
  it("uses the compatibility ~/.9router default when DATA_DIR is absent", () => {
    const home = "/home/tester";
    expect(defaultDataDir({ env: {}, home })).toBe(`${home}/.9router`);
    expect(resolveRuntimePaths({ env: {}, home })).toMatchObject({
      dataDir: `${home}/.9router`,
      releaseRoot: `${home}/.9router/releases`,
      currentLink: `${home}/.9router/current`,
    });
  });

  it("keeps an explicit DATA_DIR authoritative", () => {
    expect(resolveRuntimePaths({
      env: { DATA_DIR: "/var/lib/9router" },
      home: "/home/tester",
    })).toMatchObject({
      dataDir: "/var/lib/9router",
      releaseRoot: "/var/lib/9router/releases",
      currentLink: "/var/lib/9router/current",
    });
  });

  it("fails closed when PM2 state cannot be queried", () => {
    const run = () => ({ status: 1, stdout: "", stderr: "daemon unavailable" });
    expect(() => readPm2App({ failOnError: true, run })).toThrow(/Unable to query PM2 state/);
    expect(() => readPm2Environment({ failOnError: true, run })).toThrow(/Unable to query PM2 state/);
  });

  it("does not treat a valid empty PM2 process list as an error", () => {
    const run = () => ({ status: 0, stdout: "[]", stderr: "" });
    expect(readPm2App({ failOnError: true, run })).toBeNull();
    expect(readPm2Environment({ failOnError: true, run })).toEqual({});
  });
});
