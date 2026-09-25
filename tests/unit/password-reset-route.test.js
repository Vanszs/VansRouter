import bcrypt from "bcryptjs";
import { afterEach, describe, expect, it, vi } from "vitest";

const updateSettings = vi.fn();

async function loadRoute() {
  vi.resetModules();
  vi.doMock("next/server", () => ({
    NextResponse: {
      json(body, init = {}) {
        return new Response(JSON.stringify(body), {
          status: init.status || 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    },
  }));
  vi.doMock("@/lib/localDb", () => ({ updateSettings }));
  return import("@/app/api/auth/reset-password/route.js");
}

function request(body) {
  return new Request("http://localhost/api/auth/reset-password", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

afterEach(() => {
  updateSettings.mockReset();
  vi.doUnmock("next/server");
  vi.doUnmock("@/lib/localDb");
  vi.resetModules();
});

describe("production password reset", () => {
  it("sets a strong replacement password instead of clearing the hash", async () => {
    const { POST } = await loadRoute();
    const replacement = "a-long-random-password";

    const response = await POST(request({ newPassword: replacement }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(updateSettings).toHaveBeenCalledOnce();
    const stored = updateSettings.mock.calls[0][0];
    expect(stored.password).not.toBeNull();
    expect(await bcrypt.compare(replacement, stored.password)).toBe(true);
  });

  it("rejects a short replacement password", async () => {
    const { POST } = await loadRoute();

    const response = await POST(request({ newPassword: "123456" }));

    expect(response.status).toBe(400);
    expect(updateSettings).not.toHaveBeenCalled();
  });

  it("returns 400 for malformed request JSON", async () => {
    const { POST } = await loadRoute();
    const malformed = new Request("http://localhost/api/auth/reset-password", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{",
    });

    const response = await POST(malformed);

    expect(response.status).toBe(400);
    expect(updateSettings).not.toHaveBeenCalled();
  });
});
