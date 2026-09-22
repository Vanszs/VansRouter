import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ files: new Map() }));

vi.mock("child_process", () => ({
  exec: (command, options, callback) => callback(null, "", ""),
}));
vi.mock("os", () => ({
  default: { homedir: () => "/tmp/claude-test", platform: () => "linux" },
}));
vi.mock("fs/promises", () => ({
  default: {
    readFile: vi.fn(async (file) => {
      if (!state.files.has(file)) {
        const error = new Error("missing");
        error.code = "ENOENT";
        throw error;
      }
      return state.files.get(file);
    }),
    writeFile: vi.fn(async (file, content) => { state.files.set(file, content); }),
    mkdir: vi.fn(async () => {}),
    access: vi.fn(async () => {}),
  },
}));

const { POST, DELETE } = await import("../../src/app/api/cli-tools/claude-settings/route.js");

const SETTINGS_PATH = "/tmp/claude-test/.claude/settings.json";

const request = (body = {}) => ({ json: async () => body });

const writtenEnv = () => JSON.parse(state.files.get(SETTINGS_PATH)).env;

beforeEach(() => {
  state.files.clear();
});

afterEach(() => vi.clearAllMocks());

describe("Claude Code auto-compact window", () => {
  it("writes CLAUDE_CODE_AUTO_COMPACT_WINDOW when a preset is chosen", async () => {
    const res = await POST(request({ env: { ANTHROPIC_BASE_URL: "http://localhost:20127" }, autoCompactWindow: "298000" }));
    expect(res.status).toBe(200);
    expect(writtenEnv().CLAUDE_CODE_AUTO_COMPACT_WINDOW).toBe("298000");
  });

  it("removes the key on Default so Claude Code derives the window from the model", async () => {
    state.files.set(SETTINGS_PATH, JSON.stringify({ env: { ANTHROPIC_BASE_URL: "http://x", CLAUDE_CODE_AUTO_COMPACT_WINDOW: "498000" } }));
    const res = await POST(request({ env: { ANTHROPIC_BASE_URL: "http://localhost:20127" }, autoCompactWindow: "" }));
    expect(res.status).toBe(200);
    expect("CLAUDE_CODE_AUTO_COMPACT_WINDOW" in writtenEnv()).toBe(false);
  });

  it("drops the key on reset", async () => {
    state.files.set(SETTINGS_PATH, JSON.stringify({
      env: { ANTHROPIC_BASE_URL: "http://x", ANTHROPIC_DEFAULT_SONNET_MODEL: "cc/claude-sonnet-5", CLAUDE_CODE_AUTO_COMPACT_WINDOW: "298000" },
    }));
    const res = await DELETE();
    expect(res.status).toBe(200);
    const env = JSON.parse(state.files.get(SETTINGS_PATH)).env || {};
    expect("CLAUDE_CODE_AUTO_COMPACT_WINDOW" in env).toBe(false);
    expect("ANTHROPIC_DEFAULT_SONNET_MODEL" in env).toBe(false);
  });

  it("stores the [1m] marker verbatim on the model envs", async () => {
    const res = await POST(request({
      env: { ANTHROPIC_BASE_URL: "http://localhost:20127", ANTHROPIC_DEFAULT_OPUS_MODEL: "cc/claude-opus-4-8[1m]" },
      autoCompactWindow: "698000",
    }));
    expect(res.status).toBe(200);
    expect(writtenEnv().ANTHROPIC_DEFAULT_OPUS_MODEL).toBe("cc/claude-opus-4-8[1m]");
  });
});
