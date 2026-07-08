import { NextResponse } from "next/server";
import { getAllCircuitBreakerStatuses } from "open-sse/utils/circuitBreaker";

export const runtime = "nodejs";

/**
 * GET /api/providers/circuit-breakers
 * Returns all active circuit breaker statuses
 */
export async function GET() {
  try {
    const statuses = getAllCircuitBreakerStatuses();
    return NextResponse.json({ statuses });
  } catch (error) {
    console.error("Failed to fetch circuit breaker statuses:", error);
    return NextResponse.json(
      { error: "Failed to fetch circuit breaker statuses" },
      { status: 500 }
    );
  }
}
