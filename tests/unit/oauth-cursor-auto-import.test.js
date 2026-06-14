import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fsPromises from "fs/promises";

// Mock next/server
vi.mock("next/server", () => ({
  NextResponse: {
    json: vi.fn((body, init) => ({
      status: init?.status || 200,
      body,
      json: async () => body,
    })),
  },
}));

// Mock os
vi.mock("os", () => ({
  default: { homedir: vi.fn(() => "/mock/home") },
  homedir: vi.fn(() => "/mock/home"),
}));

// Mock fs/promises
vi.mock("fs/promises", () => ({
  access: vi.fn(),
  constants: { R_OK: 4 },
}));

// Shared mock db instance.
// The route queries one key at a time via prepare("...WHERE key=?...").get(key),
// so we model the store as a key→value map.
const mockStore = new Map();
const mockDbInstance = {
  prepare: vi.fn(() => ({
    get: (key) => {
      if (mockStore.has(key)) return { value: mockStore.get(key) };
      return undefined;
    },
  })),
  close: vi.fn(),
  __throwOnConstruct: false,
};

// Mock better-sqlite3 as a class so `new Database(...)` works
vi.mock("better-sqlite3", () => ({
  default: class MockDatabase {
    constructor() {
      if (mockDbInstance.__throwOnConstruct) {
        throw new Error("SQLITE_CANTOPEN");
      }
      return mockDbInstance;
    }
  },
}));

// Mock child_process so the sqlite3 CLI / `which` fallbacks never touch the real
// system. By default they "fail" so only the better-sqlite3 path is exercised.
vi.mock("child_process", () => ({
  execFile: vi.fn((cmd, args, opts, cb) => {
    const callback = typeof opts === "function" ? opts : cb;
    if (callback) callback(new Error("ENOENT"), { stdout: "", stderr: "" });
  }),
}));

let GET;

describe("GET /api/oauth/cursor/auto-import", () => {
  const originalPlatform = process.platform;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockStore.clear();
    mockDbInstance.__throwOnConstruct = false;
    mockDbInstance.prepare.mockImplementation(() => ({
      get: (key) => (mockStore.has(key) ? { value: mockStore.get(key) } : undefined),
    }));
    // Force darwin so macOS-specific path probing is exercised
    Object.defineProperty(process, "platform", { value: "darwin", writable: true });
    const mod = await import("../../src/app/api/oauth/cursor/auto-import/route.js");
    GET = mod.GET;
  });

  afterEach(() => {
    Object.defineProperty(process, "platform", { value: originalPlatform, writable: true });
  });

  // ── macOS path probing ────────────────────────────────────────────────

  it("returns not-found when no macOS cursor db paths are accessible", async () => {
    vi.mocked(fsPromises.access).mockRejectedValue(new Error("ENOENT"));

    const response = await GET();

    expect(response.body.found).toBe(false);
    expect(response.body.error).toContain("Cursor database not found");
    // Lists the probed candidate locations
    expect(response.body.error).toContain("Library/Application Support/Cursor");
  });

  // ── Token extraction ──────────────────────────────────────────────────

  it("extracts tokens using exact keys", async () => {
    vi.mocked(fsPromises.access).mockResolvedValue();
    mockStore.set("cursorAuth/accessToken", "test-token");
    mockStore.set("storage.serviceMachineId", "test-machine-id");

    const response = await GET();

    expect(response.body.found).toBe(true);
    expect(response.body.accessToken).toBe("test-token");
    expect(response.body.machineId).toBe("test-machine-id");
    expect(mockDbInstance.close).toHaveBeenCalled();
  });

  it("unwraps JSON-encoded string values", async () => {
    vi.mocked(fsPromises.access).mockResolvedValue();
    mockStore.set("cursorAuth/accessToken", '"json-token"');
    mockStore.set("storage.serviceMachineId", '"json-machine-id"');

    const response = await GET();

    expect(response.body.found).toBe(true);
    expect(response.body.accessToken).toBe("json-token");
    expect(response.body.machineId).toBe("json-machine-id");
  });

  it("falls back to alternative known keys (cursorAuth/token, storage.machineId)", async () => {
    vi.mocked(fsPromises.access).mockResolvedValue();
    // Primary keys absent; alternative known keys present
    mockStore.set("cursorAuth/token", "fallback-token");
    mockStore.set("storage.machineId", "fallback-machine");

    const response = await GET();

    expect(response.body.found).toBe(true);
    expect(response.body.accessToken).toBe("fallback-token");
    expect(response.body.machineId).toBe("fallback-machine");
  });

  it("returns manual-fallback when tokens are missing from the db", async () => {
    vi.mocked(fsPromises.access).mockResolvedValue();
    // db opens fine but contains none of the known keys

    const response = await GET();

    expect(response.body.found).toBe(false);
    // Source asks the user to paste manually (windowsManual flag + dbPath)
    expect(response.body.windowsManual).toBe(true);
    expect(typeof response.body.dbPath).toBe("string");
  });

  // ── Platform handling ─────────────────────────────────────────────────

  it("linux returns not-found error when no db path is accessible", async () => {
    Object.defineProperty(process, "platform", { value: "linux", writable: true });
    vi.mocked(fsPromises.access).mockRejectedValue(new Error("ENOENT"));

    const response = await GET();

    expect(response.body.found).toBe(false);
    expect(response.body.error).toContain("Cursor database not found");
  });
});
