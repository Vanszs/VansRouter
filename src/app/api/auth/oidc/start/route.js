import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  buildOidcAuthorizationUrl,
  createOidcNonce,
  createOidcState,
  createPkcePair,
  fetchOidcDiscovery,
  getOidcRuntimeConfig,
  getPublicOrigin,
} from "@/lib/auth/oidc";
import { shouldUseSecureCookie } from "@/lib/auth/dashboardSession";

/**
 * CSRF/prefetch mitigation for cookie-setting GET handler.
 *
 * This route sets HttpOnly cookies (oidc_state, nonce, pkce_verifier) then
 * redirects to the IdP. It MUST remain GET because the /masuk page triggers
 * it via window.location.href (top-level navigation).
 *
 * To prevent browsers from prefetching (speculation rules, <link rel=prefetch>,
 * Chromium predictive preconnect) or cross-origin CSRF triggering cookie writes:
 * - Require Sec-Fetch-Mode: navigate AND Sec-Fetch-Dest: document
 * - Reject requests with Sec-Purpose:prefetch / Purpose:prefetch
 *
 * These headers are added by browsers on genuine navigations and cannot be
 * forged by cross-origin JS (Fetch metadata is a forbidden header name).
 */
export async function GET(request) {
  try {
    const secFetchMode = request.headers.get("sec-fetch-mode");
    const secFetchDest = request.headers.get("sec-fetch-dest");
    const secPurpose = (request.headers.get("sec-purpose") || "").toLowerCase();
    const purpose = (request.headers.get("purpose") || "").toLowerCase();

    if (secPurpose === "prefetch" || purpose === "prefetch") {
      return NextResponse.json({ error: "Prefetch not allowed" }, { status: 403 });
    }

    if (secFetchMode && secFetchMode !== "navigate") {
      return NextResponse.json({ error: "Invalid request mode" }, { status: 403 });
    }

    if (secFetchDest && secFetchDest !== "document") {
      return NextResponse.json({ error: "Invalid request destination" }, { status: 403 });
    }

    const config = await getOidcRuntimeConfig();
    if (!config) {
      return NextResponse.redirect(new URL("/login?error=oidc_not_configured", getPublicOrigin(request)));
    }

    const discovery = await fetchOidcDiscovery(config.issuerUrl);
    const state = createOidcState();
    const nonce = createOidcNonce();
    const { verifier, challenge } = createPkcePair();
    const redirectUri = `${getPublicOrigin(request)}/api/auth/oidc/callback`;
    const authUrl = buildOidcAuthorizationUrl({
      authorizationEndpoint: discovery.authorization_endpoint,
      clientId: config.clientId,
      redirectUri,
      scopes: config.scopes,
      state,
      nonce,
      codeChallenge: challenge,
    });

    const cookieStore = await cookies();
    const baseOptions = {
      httpOnly: true,
      secure: shouldUseSecureCookie(request),
      sameSite: "lax",
      path: "/",
      maxAge: 10 * 60,
    };
    cookieStore.set("oidc_state", state, baseOptions);
    cookieStore.set("oidc_nonce", nonce, baseOptions);
    cookieStore.set("oidc_code_verifier", verifier, baseOptions);

    return NextResponse.redirect(authUrl);
  } catch (error) {
    return NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(error.message || "oidc_start_failed")}`, getPublicOrigin(request)));
  }
}
