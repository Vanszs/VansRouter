// Next.js Edge Middleware — enforces authentication on all routes.
// dashboardGuard.proxy implements deny-by-default: every /api/* path
// requires a valid JWT or CLI token unless it is in PUBLIC_API_PATHS.
// This is the central auth guard that react-doctor's server-auth-actions
// rule expects to find at src/middleware.js.
import { proxy as dashboardProxy } from "./dashboardGuard";

export default async function middleware(request) {
  return dashboardProxy(request);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon\\.ico).*)"],
};
