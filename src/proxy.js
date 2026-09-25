import { proxy as dashboardProxy } from "./dashboardGuard";

export default async function proxy(request) {
  return dashboardProxy(request);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon\\.|providers/|icons/|i18n/|manifest\\.webmanifest|sw\\.js).*)"],
};
