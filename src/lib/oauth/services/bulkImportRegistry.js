import {
  applyBulkImportProxyMode,
  resolveBulkImportProxy,
} from "@/lib/oauth/services/bulkImportProxyResolver";

/**
 * Registry of bulk-import providers. Each spec is a lazy adapter over a
 * provider-specific KiroBulkImportManager subclass. Managers are heavy
 * (Playwright) so getManager + parseAccounts resolve via dynamic import()
 * to keep cold start cheap for unrelated routes.
 *
 * Shape:
 * - getManager(): Promise<Manager>                 — singleton factory
 * - parseAccounts(accounts): Promise<{parsed,invalidLines}> | null
 *                                                   — null for 5sim flows
 * - normalizeStartArgs(body, resolvedProxy): args  — maps request body to startJob args
 * - applyProxyMode: boolean                        — codebuddy-cn post-processes proxy
 * - staleOnLatest404: boolean                      — wire-format compatibility for /latest 404
 * - label / errorLabel: string                      — human-readable names + 404 messages
 */
export const BULK_IMPORT_PROVIDERS = Object.freeze({
  kiro: {
    label: "Kiro",
    errorLabel: "Bulk import job",
    staleOnLatest404: true,
    parseAccounts: (accounts) =>
      import("@/lib/oauth/services/kiroBulkImportManager").then((m) => m.parseKiroBulkAccounts(accounts)),
    getManager: () =>
      import("@/lib/oauth/services/kiroBulkImportManager").then((m) => m.getKiroBulkImportManager()),
    normalizeStartArgs: (body, resolvedProxy) => ({
      accounts: body?.accounts ?? [],
      concurrency: body?.concurrency,
      engine: body?.engine,
      headless: body?.headless,
      proxyUrl: resolvedProxy.proxyUrl,
      proxyUrls: resolvedProxy.proxyUrls,
      proxyMode: resolvedProxy.proxyMode,
      proxyPoolId: resolvedProxy.proxyPoolId,
      proxySource: resolvedProxy.proxySource,
      randomizeProxySession: body?.randomizeProxySession,
    }),
  },
  qoder: {
    label: "Qoder",
    errorLabel: "Bulk import job",
    staleOnLatest404: true,
    parseAccounts: (accounts) =>
      import("@/lib/oauth/services/qoderBulkImportManager").then((m) => m.parseKiroBulkAccounts(accounts)),
    getManager: () =>
      import("@/lib/oauth/services/qoderBulkImportManager").then((m) => m.getQoderBulkImportManager()),
    normalizeStartArgs: (body, resolvedProxy) => ({
      accounts: body?.accounts ?? [],
      concurrency: body?.concurrency,
      engine: body?.engine,
      headless: body?.headless,
      proxyUrl: resolvedProxy.proxyUrl,
      proxyUrls: resolvedProxy.proxyUrls,
      proxyMode: resolvedProxy.proxyMode,
      proxyPoolId: resolvedProxy.proxyPoolId,
      proxySource: resolvedProxy.proxySource,
      randomizeProxySession: body?.randomizeProxySession,
    }),
  },
  codebuddy: {
    label: "CodeBuddy",
    errorLabel: "Bulk import job",
    staleOnLatest404: true,
    parseAccounts: (accounts) =>
      import("@/lib/oauth/services/codebuddyBulkImportManager").then((m) => m.parseCodeBuddyBulkAccounts(accounts)),
    getManager: () =>
      import("@/lib/oauth/services/codebuddyBulkImportManager").then((m) => m.getCodeBuddyBulkImportManager()),
    normalizeStartArgs: (body, resolvedProxy) => ({
      accounts: body?.accounts ?? [],
      concurrency: body?.concurrency,
      engine: body?.engine,
      headless: body?.headless,
      proxyUrl: resolvedProxy.proxyUrl,
      proxyUrls: resolvedProxy.proxyUrls,
      proxyMode: resolvedProxy.proxyMode,
      proxyPoolId: resolvedProxy.proxyPoolId,
      proxySource: resolvedProxy.proxySource,
      randomizeProxySession: body?.randomizeProxySession,
    }),
  },
  "codebuddy-cn": {
    label: "CodeBuddy CN",
    errorLabel: "CodeBuddy CN phone import job",
    staleOnLatest404: false,
    applyProxyMode: true,
    // 5sim flow: no client-side account parsing; manager handles phone OTP.
    parseAccounts: null,
    getManager: () =>
      import("@/lib/oauth/services/codebuddyCnPhoneImportManager").then((m) => m.getCodeBuddyCnPhoneImportManager()),
    normalizeStartArgs: (body, resolvedProxy) => ({
      fiveSimToken: body?.fiveSimToken,
      count: body?.count,
      concurrency: body?.concurrency,
      engine: body?.engine,
      country: body?.country,
      operator: body?.operator,
      product: body?.product,
      proxyUrl: resolvedProxy.proxyUrl,
      proxyUrls: resolvedProxy.proxyUrls,
      proxyMode: resolvedProxy.proxyMode,
      proxyPoolId: resolvedProxy.proxyPoolId,
      proxySource: resolvedProxy.proxySource,
      randomizeProxySession: body?.randomizeProxySession,
    }),
  },
  autoclaw: {
    label: "AutoClaw",
    errorLabel: "AutoClaw import job",
    staleOnLatest404: true,
    parseAccounts: (accounts) =>
      import("@/lib/oauth/services/kiroBulkImportManager").then((m) => m.parseKiroBulkAccounts(accounts)),
    getManager: () =>
      import("@/lib/oauth/services/autoclawBulkImportManager").then((m) => m.getAutoclawBulkImportManager()),
    normalizeStartArgs: (body, resolvedProxy) => ({
      accounts: body?.accounts ?? [],
      concurrency: body?.concurrency,
      engine: body?.engine,
      headless: body?.headless,
      proxyUrl: resolvedProxy.proxyUrl,
      proxyUrls: resolvedProxy.proxyUrls,
      proxyMode: resolvedProxy.proxyMode,
      proxyPoolId: resolvedProxy.proxyPoolId,
      proxySource: resolvedProxy.proxySource,
      randomizeProxySession: body?.randomizeProxySession,
    }),
  },
  "cloudflare-ai": {
    label: "Cloudflare AI",
    errorLabel: "Cloudflare AI import job",
    staleOnLatest404: true,
    parseAccounts: (accounts) =>
      import("@/lib/oauth/services/cloudflareBulkImportManager").then((m) => m.parseCloudflareBulkAccounts(accounts)),
    getManager: () =>
      import("@/lib/oauth/services/cloudflareBulkImportManager").then((m) => m.getCloudflareBulkImportManager()),
    normalizeStartArgs: (body, resolvedProxy) => ({
      accounts: body?.accounts ?? [],
      concurrency: body?.concurrency,
      engine: body?.engine,
      headless: body?.headless,
      proxyUrl: resolvedProxy.proxyUrl,
      proxyUrls: resolvedProxy.proxyUrls,
      proxyMode: resolvedProxy.proxyMode,
      proxyPoolId: resolvedProxy.proxyPoolId,
      proxySource: resolvedProxy.proxySource,
      randomizeProxySession: body?.randomizeProxySession,
    }),
  },
});

export function isValidBulkImportProvider(providerId) {
  return Object.prototype.hasOwnProperty.call(BULK_IMPORT_PROVIDERS, providerId);
}

export function getBulkImportProviderSpec(providerId) {
  if (!isValidBulkImportProvider(providerId)) {
    const valid = Object.keys(BULK_IMPORT_PROVIDERS).join(", ");
    const error = new Error(`Unknown bulk import provider: ${providerId}. Valid: ${valid}`);
    error.statusCode = 400;
    throw error;
  }
  return BULK_IMPORT_PROVIDERS[providerId];
}

/**
 * Resolve proxy for a bulk import job. account-bearing providers use
 * resolveBulkImportProxy directly; codebuddy-cn additionally applies
 * applyBulkImportProxyMode to honor the client's proxyMode preference.
 */
export async function resolveProxyForProvider(spec, body) {
  const resolved = await resolveBulkImportProxy({
    proxyPoolId: body?.proxyPoolId,
    proxyUrl: body?.proxyUrl,
  });
  if (spec.applyProxyMode) {
    return applyBulkImportProxyMode(resolved, body?.proxyMode);
  }
  return resolved;
}

export { applyBulkImportProxyMode, resolveBulkImportProxy };
