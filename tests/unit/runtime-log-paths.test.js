import path from "node:path";
import { readFileSync, rmSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { getRuntimeDataDir, getRuntimeLogsDir } from "../../open-sse/utils/runtimePaths.js";

describe("runtime log paths", () => {
  it("uses an explicit DATA_DIR for logs", () => {
    const dataDir = path.join(path.sep, "var", "lib", "9router");
    const logsDir = getRuntimeLogsDir({
      env: { DATA_DIR: dataDir },
      platform: "linux",
      home: "/home/tester",
    });

    expect(logsDir).toBe(path.join(dataDir, "logs"));
  });

  it("uses the persistent user data directory when DATA_DIR is absent", () => {
    const dataDir = getRuntimeDataDir({
      env: {},
      platform: "linux",
      home: "/home/tester",
    });

    expect(dataDir).toBe(path.join(path.sep, "home", "tester", ".9router"));
  });

  it("writes gateway errors below DATA_DIR/logs", () => {
    const dataDir = path.join(path.sep, "tmp", `vansrouter-log-test-${process.pid}`);
    const result = spawnSync(process.execPath, [
      "--input-type=module",
      "-e",
      "import { logGatewayError } from './open-sse/utils/errorLog.js'; logGatewayError({ message: 'test' });",
    ], {
      env: { ...process.env, DATA_DIR: dataDir },
      encoding: "utf8",
    });

    expect(result.status).toBe(0);
    expect(() => statSync(path.join(dataDir, "logs", "gateway-errors.jsonl"))).not.toThrow();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("creates request log sessions below DATA_DIR/logs", async () => {
    const dataDir = path.join(path.sep, "tmp", `vansrouter-request-log-test-${process.pid}`);
    const result = spawnSync(process.execPath, [
      "--input-type=module",
      "-e",
      "import { createRequestLogger } from './open-sse/utils/requestLogger.js'; const logger = await createRequestLogger('openai', 'claude', 'test'); console.log(logger.sessionPath);",
    ], {
      env: { ...process.env, DATA_DIR: dataDir, ENABLE_REQUEST_LOGS: "true" },
      encoding: "utf8",
    });

    expect(result.status).toBe(0);
    expect(result.stdout.trim().startsWith(path.join(dataDir, "logs"))).toBe(true);
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("keeps translator files in DATA_DIR instead of the read-only app root", () => {
    const saveRoute = readFileSync("src/app/api/translator/save/route.js", "utf8");
    const loadRoute = readFileSync("src/app/api/translator/load/route.js", "utf8");

    expect(saveRoute).toContain('from "@/lib/dataDir"');
    expect(loadRoute).toContain('from "@/lib/dataDir"');
    expect(saveRoute).not.toContain("process.cwd()");
    expect(loadRoute).not.toContain("process.cwd()");
  });
});
