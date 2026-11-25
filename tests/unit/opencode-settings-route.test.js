import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  config: null,
  installed: true,
}));

vi.mock("child_process", () => ({
  exec: (command, options, callback) => callback(null, "", ""),
}));
vi.mock("os", async (importOriginal) => ({ ...(await importOriginal()),
  default: { homedir: () => "/tmp/opencode-test", platform: () => "linux" },
}));
vi.mock("fs/promises", () => ({
  default: {
    readFile: vi.fn(async () => {
      if (!state.config) {
        const error = new Error("missing");
        error.code = "ENOENT";
        throw error;
      }
      return JSON.stringify(state.config);
    }),
    mkdir: vi.fn(async () => {}),
    writeFile: vi.fn(async (file, content) => { state.config = JSON.parse(content); }),
    rename: vi.fn(async (temp, target) => {
      const fs = await import("fs/promises");
      const content = await fs.default.readFile(temp, "utf8");
      state.config = JSON.parse(content);
    }),
    rm: vi.fn(async () => {}),
    access: vi.fn(async () => {}),
  },
}));

const { GET, POST, PATCH, DELETE } = await import("../../src/app/api/cli-tools/opencode-settings/route.js");

const request = (body = {}) => ({
  json: async () => body,
  url: "http://localhost/api/cli-tools/opencode-settings",
});

beforeEach(() => {
  state.config = null;
});

afterEach(() => vi.clearAllMocks());

describe("OpenCode VansRoute contract", () => {
  it("detects canonical and legacy providers", async () => {
    state.config = { provider: { VansRoute: { options: {}, models: { alpha: {} } } }, model: "VansRoute/alpha" };
    let data = await (await GET()).json();
    expect(data.hasVansRoute).toBe(true);
    expect(data.opencode.activeModel).toBe("alpha");

    state.config = { provider: { "9router": { options: {}, models: { beta: {} } } }, model: "9router/beta" };
    data = await (await GET()).json();
    expect(data.hasVansRoute).toBe(true);
    expect(data.opencode.activeModel).toBe("beta");
  });

  it("writes VansRoute and migrates the legacy provider", async () => {
    state.config = { provider: { "9router": { options: {}, models: { old: { name: "old" } } } } };
    await POST(request({ baseUrl: "https://router.example", models: ["new"], activeModel: "new" }));
    expect(state.config.provider.VansRoute).toBeDefined();
    expect(state.config.provider["9router"]).toBeUndefined();
    expect(state.config.model).toBe("VansRoute/new");
  });

  it("rejects invalid URLs and clears legacy active models", async () => {
    expect((await POST(request({ baseUrl: "file:///tmp/x", models: ["x"] }))).status).toBe(400);
    state.config = { model: "9router/old", provider: { "9router": { models: { old: {} } } } };
    expect((await PATCH(request({ clearActiveModel: true }))).status).toBe(200);
    expect(state.config.model).toBe("");
  });

  it("deletes legacy provider and explorer config", async () => {
    state.config = {
      provider: { "9router": { models: { old: {} } } },
      model: "9router/old",
      agent: { explorer: { model: "9router/old" } },
    };
    expect((await DELETE(request())).status).toBe(200);
    expect(state.config.provider).toEqual({});
    expect(state.config.model).toBeUndefined();
    expect(state.config.agent).toBeUndefined();
  });
});
