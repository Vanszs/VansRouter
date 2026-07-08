import { NextResponse } from "next/server";
import { resetCircuitBreaker } from "open-sse/utils/circuitBreaker";
import { jwtVerify } from "jose";
import { getSettings } from "@/lib/localDb";

export const runtime = "nodejs";

function getSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("JWT_SECRET environment variable is required");
  }
  return new TextEncoder().encode(secret);
}

async function checkAuth(request) {
  const settings = await getSettings();
  if (settings && settings.requireLogin === false) {
    return true;
  }
  
  const { cookies } = await import("next/headers");
  const cookieStore = await cookies();
  const token = cookieStore.get("auth_token")?.value;
  
  if (!token) {
    return false;
  }
  
  try {
    await jwtVerify(token, getSecret());
    return true;
  } catch {
    return false;
  }
}

/**
 * POST /api/providers/circuit-breakers/[name]/reset
 * Resets a specific circuit breaker to CLOSED state
 */
export async function POST(request, { params }) {
  try {
    const isAuthenticated = await checkAuth(request);
    if (!isAuthenticated) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { name } = await params;
    if (!name) {
      return NextResponse.json(
        { error: "Circuit breaker name is required" },
        { status: 400 }
      );
    }

    resetCircuitBreaker(decodeURIComponent(name));
    return NextResponse.json({ success: true, message: `Circuit breaker "${name}" reset to CLOSED` });
  } catch (error) {
    console.error("Failed to reset circuit breaker:", error);
    return NextResponse.json(
      { error: "Failed to reset circuit breaker" },
      { status: 500 }
    );
  }
}
