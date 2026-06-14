import { cookies } from "next/headers";
import { getSettings } from "@/lib/localDb";
import { isOidcConfigured } from "@/lib/auth/oidc";
import { getDashboardAuthSession } from "@/lib/auth/dashboardSession";
import MasukClient from "./MasukClient";

export default async function MasukPage() {
  let initialAuth = { hasPassword: true, authMode: "password", oidcConfigured: false, oidcLoginLabel: "Masuk dengan OIDC", requireLogin: true };
  try {
    const settings = await getSettings();
    const cookieStore = await cookies();
    const session = await getDashboardAuthSession(cookieStore.get("auth_token")?.value);
    const requireLogin = settings.requireLogin !== false;
    initialAuth = {
      requireLogin,
      authMode: settings.authMode || "password",
      oidcConfigured: isOidcConfigured(settings),
      oidcLoginLabel: (settings.oidcLoginLabel || "Sign in with OIDC").trim() || "Sign in with OIDC",
      hasPassword: !!settings.password,
      isLoggedIn: !!session,
    };
  } catch {}
  return <MasukClient initialAuth={initialAuth} />;
}
