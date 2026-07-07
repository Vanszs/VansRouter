import { NextResponse } from "next/server";
import { getProviderConnections } from "@/lib/db";
import { recoverAutoclawTokenCheckpoints } from "@/lib/oauth/services/autoclawTokenCheckpoint";
import { getAutoclawBalance } from "open-sse/services/usage/autoclaw.js";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await recoverAutoclawTokenCheckpoints();
    const allConnections = await getProviderConnections({ provider: "autoclaw" });
    const active = (allConnections || []).filter((c) => c.isActive !== 0 && c.isActive !== false);

    const enriched = await Promise.all(
      active.map(async (c) => {
        let balance = c.providerSpecificData?.balance ?? null;
        let balanceError = null;
        try {
          const bal = await getAutoclawBalance(c.accessToken, c.providerSpecificData);
          balance = bal.balance;
        } catch (e) {
          balanceError = e.message;
        }
        return {
          id: c.id,
          name: c.name,
          email: c.email,
          balance,
          balanceError,
          expiresAt: c.expiresAt,
          lastRefreshAt: c.lastRefreshAt,
          isActive: c.isActive !== 0 && c.isActive !== false,
        };
      })
    );

    return NextResponse.json({ connections: enriched });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
