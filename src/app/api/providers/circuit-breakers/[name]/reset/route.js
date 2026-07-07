import { NextResponse } from "next/server";
import { resetCircuitBreaker } from "@/open-sse/utils/circuitBreaker";

export const runtime = "nodejs";

/**
 * POST /api/providers/circuit-breakers/[name]/reset
 * Resets a specific circuit breaker to CLOSED state
 */
export async function POST(request, { params }) {
  try {
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
