import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSettings: vi.fn(),
  updateSettings: vi.fn(),
  checkLock: vi.fn(),
  recordFail: vi.fn(),
  recordSuccess: vi.fn(),
  getClientIp: vi.fn(() => "203.0.113.10"),
  isOidcConfigured: vi.fn(() => false),
  isLocalRequest: vi.fn(() => false),
  isHostGatewayPeer: vi.fn(() => false),
  setDashboardAuthCookie: vi.fn(),
  setPasswordChangeCookie: vi.fn(),
  clearDashboardAuthCookie: vi.fn(),
  verifyDashboardAuthToken: vi.fn(async () => false),
  verifyPasswordChangeToken: vi.fn(async () => false),
}));

vi.mock("@/lib/localDb", () => ({ getSettings: mocks.getSettings, updateSettings: mocks.updateSettings }));

// In-memory cookie store so the routes' `cookies()` calls run inside a fake scope.
const cookieJar = new Map();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name) => (cookieJar.has(name) ? { name, value: cookieJar.get(name) } : undefined),
    set: (name, value) => cookieJar.set(name, value),
    delete: (name) => cookieJar.delete(name),
  }),
}));
vi.mock("@/lib/auth/loginLimiter", () => ({
  checkLock: mocks.checkLock,
  recordFail: mocks.recordFail,
  recordSuccess: mocks.recordSuccess,
  getClientIp: mocks.getClientIp,
}));
vi.mock("@/lib/auth/oidc", () => ({ isOidcConfigured: mocks.isOidcConfigured }));
vi.mock("@/dashboardGuard", () => ({
  isLocalRequest: mocks.isLocalRequest,
  isHostGatewayPeer: mocks.isHostGatewayPeer,
}));
// Real bcrypt rejects the synthetic hash used below, so stub the comparison.
vi.mock("bcryptjs", () => ({
  default: {
    compare: async (plain, hash) => hash === `hashed:${plain}`,
    hash: async (plain) => `hashed:${plain}`,
    genSalt: async () => "salt",
  },
}));
vi.mock("@/lib/auth/dashboardSession", () => ({
  setDashboardAuthCookie: mocks.setDashboardAuthCookie,
  setPasswordChangeCookie: mocks.setPasswordChangeCookie,
  clearDashboardAuthCookie: mocks.clearDashboardAuthCookie,
  verifyDashboardAuthToken: mocks.verifyDashboardAuthToken,
  verifyPasswordChangeToken: mocks.verifyPasswordChangeToken,
}));

const { POST } = await import("../../src/app/api/auth/login/route.js");
const { PATCH } = await import("../../src/app/api/settings/route.js");

const REMOTE_HEADERS = { "content-type": "application/json" };
const STRONG = "a-long-random-password";

function loginRequest(body) {
  return new Request("https://router.example/api/auth/login", {
    method: "POST",
    headers: REMOTE_HEADERS,
    body: JSON.stringify(body),
  });
}

function settingsPatch(body) {
  return new Request("https://router.example/api/settings", {
    method: "PATCH",
    headers: { ...REMOTE_HEADERS, cookie: "password_change=granted" },
    body: JSON.stringify(body),
  });
}

describe("remote default-password bootstrap (no local shell required)", () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalInitial = process.env.INITIAL_PASSWORD;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NODE_ENV = "production";
    delete process.env.INITIAL_PASSWORD;
    mocks.getSettings.mockResolvedValue({});
    mocks.checkLock.mockReturnValue({ locked: false });
    mocks.recordSuccess.mockReturnValue({});
    mocks.recordFail.mockReturnValue({ remainingBeforeLock: 3 });
    mocks.updateSettings.mockImplementation(async (next) => next);
    mocks.isLocalRequest.mockReturnValue(false);
  });

  afterEach(() => {
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
    if (originalInitial === undefined) delete process.env.INITIAL_PASSWORD;
    else process.env.INITIAL_PASSWORD = originalInitial;
  });

  it("issues a password-change-only grant instead of a hard 403 lockout", async () => {
    const response = await POST(loginRequest({ password: "123456" }));
    const body = await response.json();

    // The operator must be able to continue: 200 + explicit mustChangePassword.
    expect(response.status).toBe(200);
    expect(body).toMatchObject({ success: true, mustChangePassword: true });
    expect(mocks.setPasswordChangeCookie).toHaveBeenCalledTimes(1);
    // Critically: this must NOT be a full dashboard session.
    expect(mocks.setDashboardAuthCookie).not.toHaveBeenCalled();
  });

  it("still hands out a full session once the placeholder is replaced", async () => {
    mocks.getSettings.mockResolvedValue({ password: `hashed:${STRONG}` });

    const response = await POST(loginRequest({ password: STRONG }));

    expect(response.status).toBe(200);
    expect(mocks.setDashboardAuthCookie).toHaveBeenCalledTimes(1);
    expect(mocks.setPasswordChangeCookie).not.toHaveBeenCalled();
  });

  it("does not issue the grant for a wrong password", async () => {
    const response = await POST(loginRequest({ password: "wrong-password" }));

    expect(response.status).toBe(401);
    expect(mocks.setPasswordChangeCookie).not.toHaveBeenCalled();
    expect(mocks.setDashboardAuthCookie).not.toHaveBeenCalled();
  });

  it("keeps the local flow free of the grant entirely", async () => {
    mocks.isLocalRequest.mockReturnValue(true);

    const response = await POST(loginRequest({ password: "123456" }));

    expect(response.status).toBe(200);
    expect(mocks.setDashboardAuthCookie).toHaveBeenCalledTimes(1);
    expect(mocks.setPasswordChangeCookie).not.toHaveBeenCalled();
  });

  // Docker NATs host traffic to the container gateway, so a host operator hits
  // the published port as a "remote" peer. They must still get a usable path.
  it("grants the password change to any non-local default-password login", async () => {
    mocks.isHostGatewayPeer.mockReturnValue(true);

    const response = await POST(loginRequest({ password: "123456" }));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ mustChangePassword: true });
    expect(mocks.setPasswordChangeCookie).toHaveBeenCalledTimes(1);
    expect(mocks.setDashboardAuthCookie).not.toHaveBeenCalled();
  });
});

describe("password-change grant is only good for changing the password", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.updateSettings.mockImplementation(async (next) => next);
    mocks.verifyDashboardAuthToken.mockResolvedValue(false);
    mocks.verifyPasswordChangeToken.mockResolvedValue(true);
  });

  it("rejects any settings write other than the password swap", async () => {
    const response = await PATCH(settingsPatch({ newPassword: STRONG, currentPassword: "123456", requireLogin: false }));
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error).toMatch(/password/i);
    expect(mocks.updateSettings).not.toHaveBeenCalled();
  });

  it("rejects a password swap that skips the current password", async () => {
    const response = await PATCH(settingsPatch({ newPassword: STRONG }));

    expect(response.status).toBe(403);
    expect(mocks.updateSettings).not.toHaveBeenCalled();
  });

  it("rejects a weak replacement", async () => {
    const response = await PATCH(settingsPatch({ newPassword: "123456", currentPassword: "123456" }));

    expect(response.status).toBe(400);
    expect(mocks.updateSettings).not.toHaveBeenCalled();
  });
});
