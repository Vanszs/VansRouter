import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fsSync from "fs";
import nodePath from "path";
import { parseTOML } from "confbox";
import { CLI_TOOLS } from "../../src/shared/constants/cliTools.js";

const HOME = "/home/tester";
const XDG = "/home/tester/xdg";
const PI_PATH = `${HOME}/.pi/agent/models.json`;
const OMP_PATH = `${HOME}/.omp/agent/models.yml`;
const FORGE_PATH = `${HOME}/.forge/config.toml`;
const SMELT_PATH = `${HOME}/.smelt/config.json`;
const CODEWHALE_PATH = `${HOME}/.codewhale/config.toml`;

const state = vi.hoisted(() => ({ files: new Map(), home: "/home/tester", xdg: "/home/tester/xdg" }));

vi.mock("child_process", async (importOriginal) => {
  const actual = await importOriginal();
  const succeed = (...args) => {
    const callback = args[args.length - 1];
    if (typeof callback === "function") callback(null, "", "");
  };
  const overrides = { exec: succeed, execFile: succeed };
  return { ...actual, ...overrides, default: { ...(actual.default || actual), ...overrides } };
});
vi.mock("os", async (importOriginal) => {
  const actual = await importOriginal();
  const overrides = { homedir: () => state.home, platform: () => "linux" };
  return { ...actual, ...overrides, default: { ...(actual.default || actual), ...overrides } };
});
vi.mock("better-sqlite3", () => ({
  default: class {
    constructor() {
      throw new Error("better-sqlite3 unavailable in test");
    }
  },
}));
vi.mock("fs/promises", () => {
  const enoent = (file) => Object.assign(new Error(`ENOENT: ${file}`), { code: "ENOENT" });
  return {
    default: {
      readFile: vi.fn(async (file) => {
        if (!state.files.has(file)) throw enoent(file);
        return state.files.get(file);
      }),
      writeFile: vi.fn(async (file, content) => { state.files.set(file, content); }),
      mkdir: vi.fn(async () => {}),
      rm: vi.fn(async (file) => { state.files.delete(file); }),
      access: vi.fn(async (file) => {
        if (!state.files.has(file)) throw enoent(file);
      }),
    },
  };
});

const pi = await import("../../src/app/api/cli-tools/pi-settings/route.js");
const omp = await import("../../src/app/api/cli-tools/omp-settings/route.js");
const crush = await import("../../src/app/api/cli-tools/crush-settings/route.js");
const forge = await import("../../src/app/api/cli-tools/forge-settings/route.js");
const smelt = await import("../../src/app/api/cli-tools/smelt-settings/route.js");
const codewhale = await import("../../src/app/api/cli-tools/codewhale-settings/route.js");
const allStatuses = await import("../../src/app/api/cli-tools/all-statuses/route.js");

const post = (route, body) => route.POST({ json: async () => body });
const readJson = (file) => JSON.parse(state.files.get(file));

beforeEach(() => {
  state.files.clear();
  process.env.XDG_CONFIG_HOME = XDG;
});

afterEach(() => {
  delete process.env.XDG_CONFIG_HOME;
  vi.clearAllMocks();
});

describe("cli-tools dynamic settings routes", () => {
  it("writes the Pi multi-model provider block and resets it", async () => {
    const res = await post(pi, {
      baseUrl: "https://router.example",
      apiKey: "sk_test",
      models: ["gemini/gemini-3-flash", "cc/claude-sonnet-5"],
    });
    expect(res.status).toBe(200);
    expect((await res.json()).success).toBe(true);

    const config = readJson(PI_PATH);
    expect(config.providers["9router"]).toEqual({
      baseUrl: "https://router.example/v1",
      apiKey: "sk_test",
      api: "openai-completions",
      models: [
        { id: "gemini/gemini-3-flash", name: "gemini/gemini-3-flash", contextWindow: 128000, maxTokens: 16384 },
        { id: "cc/claude-sonnet-5", name: "cc/claude-sonnet-5", contextWindow: 128000, maxTokens: 16384 },
      ],
    });

    const status = await (await pi.GET()).json();
    expect(status).toMatchObject({ installed: true, has9Router: true, configPath: PI_PATH });

    await pi.DELETE();
    expect(state.files.has(PI_PATH)).toBe(true);
    expect(readJson(PI_PATH).providers).toBeUndefined();

    state.files.clear();
    expect((await (await pi.DELETE()).json()).message).toBe("No config file to reset");
  });

  it("keeps unrelated Pi providers and tolerates JSONC trailing commas", async () => {
    state.files.set(PI_PATH, '{\n  "theme": "dark",\n  "providers": {\n    "other": { "baseUrl": "https://other.example" },\n  },\n}\n');

    expect((await (await pi.GET()).json()).has9Router).toBe(false);

    await post(pi, { baseUrl: "http://localhost:20128", apiKey: "sk_local", model: "gemini/gemini-3-flash" });
    const config = readJson(PI_PATH);
    expect(config.theme).toBe("dark");
    expect(config.providers.other.baseUrl).toBe("https://other.example");
    expect(config.providers["9router"].models).toHaveLength(1);
    expect(config.providers["9router"].models[0].id).toBe("gemini/gemini-3-flash");
  });

  it("writes the Oh My Pi proxy block and removes it without touching other providers", async () => {
    state.files.set(OMP_PATH, "providers:\n  openai:\n    baseUrl: https://api.openai.com\n");

    const res = await post(omp, { baseUrl: "https://router.example/v1", apiKey: "sk_omp" });
    expect(res.status).toBe(200);

    const yml = state.files.get(OMP_PATH);
    expect(yml).toContain("  9router:");
    expect(yml).toContain("    baseUrl: https://router.example/v1");
    expect(yml).toContain("    apiKey: sk_omp");
    expect(yml).toContain("      type: proxy");
    expect(yml).toContain("  openai:\n    baseUrl: https://api.openai.com");

    expect((await (await omp.GET()).json()).has9Router).toBe(true);

    await omp.DELETE();
    const remaining = state.files.get(OMP_PATH);
    expect(remaining).toContain("  openai:");
    expect(remaining).not.toContain("9router");
    expect(remaining).not.toContain("baseUrl: https://router.example/v1");
  });

  it("drops the whole models.yml when it only held the 9Router provider", async () => {
    await post(omp, { baseUrl: "http://localhost:20128", apiKey: "sk_local" });
    expect((await omp.DELETE()).status).toBe(200);
    expect(state.files.has(OMP_PATH)).toBe(false);
  });

  it("writes Crush config under XDG_CONFIG_HOME, falling back to ~/.config", async () => {
    await post(crush, { baseUrl: "http://localhost:20128", apiKey: "sk_local", model: "gemini/gemini-3-flash" });
    expect(readJson(`${XDG}/crush/crush.json`).providers["9router"]).toEqual({
      type: "openai-compat",
      base_url: "http://localhost:20128/v1",
      api_key: "sk_local",
      models: [{ id: "gemini/gemini-3-flash", name: "gemini/gemini-3-flash", context_window: 128000 }],
    });
    expect((await (await crush.GET()).json()).has9Router).toBe(true);

    delete process.env.XDG_CONFIG_HOME;
    await post(crush, { baseUrl: "http://localhost:20128", apiKey: "sk_local", model: "cc/claude-sonnet-5" });
    expect(readJson(`${HOME}/.config/crush/crush.json`).providers["9router"].models[0].id).toBe("cc/claude-sonnet-5");
  });

  it("round-trips ForgeCode TOML and keeps unrelated tables on reset", async () => {
    state.files.set(FORGE_PATH, '[other]\nkeep = "yes"\n');

    const res = await post(forge, { baseUrl: "https://router.example", apiKey: "sk_forge", model: "gemini/gemini-3-flash" });
    expect(res.status).toBe(200);

    const content = state.files.get(FORGE_PATH);
    expect(content.startsWith("# Forge config — managed by 9Router\n")).toBe(true);
    const config = parseTOML(content);
    expect(config.other).toEqual({ keep: "yes" });
    expect(config.openai).toEqual({
      api_key: "sk_forge",
      base_url: "https://router.example/v1",
      model: "gemini/gemini-3-flash",
    });
    expect((await (await forge.GET()).json()).has9Router).toBe(true);

    await forge.DELETE();
    const afterReset = parseTOML(state.files.get(FORGE_PATH));
    expect(afterReset.openai).toBeUndefined();
    expect(afterReset.other).toEqual({ keep: "yes" });
  });

  it("writes flat Smelt config and keeps the saved model when omitted", async () => {
    await post(smelt, { baseUrl: "https://router.example", apiKey: "sk_smelt" });
    expect(readJson(SMELT_PATH)).toEqual({
      baseUrl: "https://router.example/v1",
      apiKey: "sk_smelt",
      model: "provider/model-id",
      _managedBy: "9router",
    });

    await post(smelt, { baseUrl: "https://router.example", model: "cc/claude-sonnet-5" });
    expect(readJson(SMELT_PATH)).toMatchObject({ apiKey: "sk_9router", model: "cc/claude-sonnet-5" });

    await post(smelt, { baseUrl: "https://router.example" });
    expect(readJson(SMELT_PATH).model).toBe("cc/claude-sonnet-5");

    expect((await (await smelt.GET()).json()).has9Router).toBe(true);
    await smelt.DELETE();
    expect(state.files.has(SMELT_PATH)).toBe(false);
  });

  it("writes the CodeWhale openai table and resets it", async () => {
    const res = await post(codewhale, { baseUrl: "https://router.example", apiKey: "sk_whale", model: "gemini/gemini-3-flash" });
    expect(res.status).toBe(200);

    const config = parseTOML(state.files.get(CODEWHALE_PATH));
    expect(config.openai).toEqual({
      base_url: "https://router.example/v1",
      api_key: "sk_whale",
      model: "gemini/gemini-3-flash",
    });
    expect((await (await codewhale.GET()).json()).has9Router).toBe(true);

    await codewhale.DELETE();
    expect(state.files.has(CODEWHALE_PATH)).toBe(false);
  });

  it("rejects missing baseUrl and unparseable bodies", async () => {
    for (const route of [pi, omp, crush, forge, smelt, codewhale]) {
      const res = await post(route, { apiKey: "sk_x" });
      expect(res.status).toBe(400);
      expect((await res.json()).error.message).toBe("baseUrl is required");
    }

    const broken = await crush.POST({ json: async () => { throw new Error("bad body"); } });
    expect(broken.status).toBe(400);
    expect((await broken.json()).error.message).toBe("Invalid JSON body");
  });

  it("reports the new tools through the all-statuses batch endpoint", async () => {
    const statuses = await (await allStatuses.GET()).json();
    for (const toolId of ["pi", "omp", "crush", "forge", "smelt", "codewhale"]) {
      expect(statuses[toolId]).toMatchObject({ installed: true });
    }
  });

  it("keeps the catalog, detail page, status batch and logos wired together", () => {
    const detailSource = fsSync.readFileSync(nodePath.resolve("src/app/(dashboard)/dashboard/cli-tools/[toolId]/ToolDetailClient.js"), "utf8");
    const statusSource = fsSync.readFileSync(nodePath.resolve("src/app/api/cli-tools/all-statuses/route.js"), "utf8");

    for (const toolId of ["pi", "omp", "crush", "forge", "smelt", "codewhale"]) {
      const tool = CLI_TOOLS[toolId];
      expect(tool?.configType).toBe("custom");
      expect(fsSync.existsSync(nodePath.resolve(`public${tool.image}`))).toBe(true);
      expect(fsSync.existsSync(nodePath.resolve(`src/app/api/cli-tools/${toolId}-settings/route.js`))).toBe(true);
      expect(detailSource).toContain(`case "${toolId}":`);
      expect(statusSource).toContain(`../${toolId}-settings/route`);
    }
  });
});
