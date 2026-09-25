import { describe, it, expect, beforeEach, afterEach } from "vitest";
import path from "node:path";
import process from "node:process";
import { DevinCliExecutor, resolveDevinBin } from "../../open-sse/executors/devin-cli.js";

const fixture = path.resolve("tests/fixtures/fake-devin-acp.mjs");
const envNames = ["CLI_DEVIN_BIN", "DEVIN_CLI_TIMEOUT_MS", "WINDSURF_API_KEY", "SECRET_ENV", "FAKE_DEVIN_HANG"];
let savedEnv;

function readSse(text) {
  return text.split("\n\n").filter((part) => part.startsWith("data: ")).map((part) => {
    const data = part.slice(6).trim();
    return data === "[DONE]" ? data : JSON.parse(data);
  });
}

async function run(options = {}) {
  const logs = [];
  process.env.CLI_DEVIN_BIN = options.bin || fixture;
  process.env.FAKE_DEVIN_HANG = options.hang ? "1" : "";
  const result = await new DevinCliExecutor().execute({
    model: "fake-model",
    body: { messages: [{ role: "user", content: options.hang ? "hang" : options.prompt || "hello" }] },
    credentials: options.credentials,
    signal: options.signal,
    log: { debug: (_scope, message) => logs.push(message) },
  });
  return { events: readSse(await result.response.text()), logs };
}

beforeEach(() => {
  savedEnv = Object.fromEntries(envNames.map((name) => [name, process.env[name]]));
  process.env.DEVIN_CLI_TIMEOUT_MS = "1000";
  process.env.WINDSURF_API_KEY = "ambient-secret";
  process.env.SECRET_ENV = "must-not-leak";
});

afterEach(() => {
  for (const name of envNames) {
    if (savedEnv[name] === undefined) delete process.env[name];
    else process.env[name] = savedEnv[name];
  }
});

describe("DevinCliExecutor", () => {
  it("honors CLI_DEVIN_BIN through the shared server-safe resolver", () => {
    const previous = process.env.CLI_DEVIN_BIN;
    process.env.CLI_DEVIN_BIN = "/custom/devin";
    expect(resolveDevinBin()).toBe("/custom/devin");
    if (previous === undefined) delete process.env.CLI_DEVIN_BIN;
    else process.env.CLI_DEVIN_BIN = previous;
  });

  it("uses an allowlisted environment and dedicated cwd", async () => {
    const { logs } = await run({ credentials: { apiKey: "request-secret" } });
    const observation = logs.filter((line) => line.includes("FAKE_DEVIN_OBSERVED")).join("\n");
    expect(observation).toContain("[REDACTED]");
    expect(observation).not.toContain("request-secret");
    expect(observation).not.toContain("must-not-leak");
    expect(observation).not.toContain(process.cwd());
  });

  it("runs initialize, session/new, and session/prompt then emits one DONE", async () => {
    const { events, logs } = await run();
    const observation = logs.filter((line) => line.includes("FAKE_DEVIN_OBSERVED")).join("\n");
    expect(observation).toContain("initialize,session/new,session/prompt");
    expect(events.filter((event) => event === "[DONE]")).toHaveLength(1);
    expect(events.map((event) => event.choices?.[0]?.delta?.content).filter(Boolean).join(""))
      .toBe("fragmented");
    expect(events.at(-2).choices[0].finish_reason).toBe("stop");
  });

  it("handles a correlated session/prompt result", async () => {
    const { events } = await run({ prompt: "correlated" });
    expect(events.filter((event) => event === "[DONE]")).toHaveLength(1);
    expect(events.map((event) => event.choices?.[0]?.delta?.content).filter(Boolean).join(""))
      .toBe("correlated result");
    expect(events.at(-2).choices[0].finish_reason).toBe("stop");
  });

  it("handles fragmented NDJSON output", async () => {
    const { events } = await run();
    const fragments = events
      .map((event) => event.choices?.[0]?.delta?.content)
      .filter(Boolean);
    expect(fragments.length).toBeGreaterThanOrEqual(2);
    expect(fragments.join("")).toBe("fragmented");
  });

  it("times out a hanging CLI and emits one DONE", async () => {
    const { events } = await run({ hang: true });
    expect(events.at(-1)).toBe("[DONE]");
    expect(events.at(-2).error.message).toMatch(/timed out after 1000ms/);
    expect(events.filter((event) => event === "[DONE]")).toHaveLength(1);
  });

  it("aborts the CLI and emits one DONE", async () => {
    const controller = new AbortController();
    const pending = run({ signal: controller.signal, hang: true });
    setTimeout(() => controller.abort(), 10);
    const { events } = await pending;
    expect(events.at(-1)).toBe("[DONE]");
    expect(events.at(-2).error.message).toBe("Devin CLI request aborted");
    expect(events.filter((event) => event === "[DONE]")).toHaveLength(1);
  });

  it("reports spawn errors", async () => {
    const { events } = await run({ bin: path.join("/definitely", "missing", "devin") });
    expect(events.at(-2).error.message).toMatch(/Devin CLI not found/);
    expect(events.at(-1)).toBe("[DONE]");
  });
});
