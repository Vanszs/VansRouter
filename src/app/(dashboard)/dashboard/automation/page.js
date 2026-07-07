"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Badge,
  Button,
  BulkAccountAutomationModal,
  Card,
  CardSkeleton,
  CloudflareTokenImportModal,
  CodeBuddyCnPhoneAutomationModal,
  KiroOAuthWrapper,
  Modal,
  OAuthModal,
  AutoclawAutomationModal,
  Pagination,
} from "@/shared/components";
import ProviderIcon from "@/shared/components/ProviderIcon";
import { FREE_PROVIDERS } from "@/shared/constants/providers";

function getConnectionLabel(count) {
  return `${count} connection${count === 1 ? "" : "s"}`;
}

function KiroAutomationPanel({ providerInfo, onRefresh }) {
  const [isOpen, setIsOpen] = useState(false);
  const [isBulkOpen, setIsBulkOpen] = useState(false);
  const [bulkJob, setBulkJob] = useState(null);
  const [initialFlow, setInitialFlow] = useState(null);
  const openFlow = (flow) => {
    setInitialFlow({ ...flow, key: Date.now() });
    setIsOpen(true);
  };

  const options = [
    {
      id: "bulk-account",
      title: "Auto Login Bulk",
      icon: "group_add",
      description: "Run bulk gmail|password automation with worker progress and manual assist.",
      action: () => {
        console.log("[Kiro Automation] Opening BulkAccountAutomationModal");
        setIsBulkOpen(true);
      },
    },
    {
      id: "bulk-token",
      title: "Bulk Token",
      icon: "playlist_add",
      description: "Import many Kiro refresh tokens, one token per line.",
      action: () => openFlow({ method: "import", importMode: "bulk-token" }),
    },
    {
      id: "single-token",
      title: "Single Token",
      icon: "vpn_key",
      description: "Auto-detect or paste one Kiro refresh token.",
      action: () => openFlow({ method: "import", importMode: "single-token" }),
    },
    {
      id: "builder-id",
      title: "AWS Builder ID",
      icon: "shield",
      description: "Open the standard AWS Builder ID device login.",
      action: () => openFlow({ method: "builder-id" }),
    },
    {
      id: "idc",
      title: "AWS IDC",
      icon: "business",
      description: "Enter an IAM Identity Center start URL and region.",
      action: () => openFlow({ method: "idc" }),
    },
    {
      id: "google",
      title: "Google Login",
      icon: "account_circle",
      description: "Open Kiro social Google login with callback capture.",
      action: () => openFlow({ method: "social", provider: "google" }),
    },
  ];

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {options.map((option) => (
          <button
            key={option.id}
            type="button"
            onClick={option.action}
            className="block min-w-0"
          >
            <Card
              hover
              padding="sm"
              className="flex min-h-[112px] flex-col gap-2 cursor-pointer h-full hover:border-brand-500/30 transition-colors"
            >
              <span className="flex items-center gap-2 text-sm font-semibold text-text-main">
                <span className="material-symbols-outlined text-[20px] text-brand-500">{option.icon}</span>
                {option.title}
              </span>
              <span className="text-xs leading-relaxed text-text-muted">{option.description}</span>
            </Card>
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {bulkJob?.jobId && (
          <Badge variant="default">
            Bulk job: {bulkJob.status}
          </Badge>
        )}
        {bulkJob?.jobId && (
          <Button
            size="sm"
            variant="secondary"
            icon="monitoring"
            onClick={() => openFlow({ method: "import", importMode: "bulk-account" })}
          >
            Resume Bulk Progress
          </Button>
        )}
      </div>
      <KiroOAuthWrapper
        isOpen={isOpen}
        providerInfo={providerInfo}
        onSuccess={onRefresh}
        onRefresh={onRefresh}
        initialBulkJobId={bulkJob?.jobId || null}
        initialFlow={initialFlow}
        onBulkJobChange={setBulkJob}
        onClose={() => setIsOpen(false)}
      />
      <BulkAccountAutomationModal
        isOpen={isBulkOpen}
        provider="kiro"
        title="Kiro Bulk GSuite Auto Login"
        serviceName="Kiro"
        onSuccess={onRefresh}
        onClose={() => setIsBulkOpen(false)}
      />
    </>
  );
}

function CodeBuddyBulkTokenModal({ isOpen, onClose, onSuccess }) {
  const [tokens, setTokens] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);

  const handleImport = async () => {
    if (!tokens.trim()) return;
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch("/api/oauth/codebuddy/bulk-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tokens }),
      });
      const data = await res.json();
      setResult(data);
      if (data.success) onSuccess?.();
    } catch (error) {
      setResult({ error: error.message });
    } finally {
      setLoading(false);
    }
  };

  // Build detailed success message with format breakdown
  let successMsg = null;
  if (result?.success) {
    const parts = [`Imported ${result.imported}/${result.total} tokens.`];
    if (result.failed) parts.push(`${result.failed} failed.`);

    // Show format breakdown if available
    if (result.formatCounts) {
      const { "access-only": ao, "with-refresh": wr, "with-api-key": wa } = result.formatCounts;
      const breakdown = [];
      if (wa) breakdown.push(`${wa} with API key`);
      if (wr) breakdown.push(`${wr} with refresh token`);
      if (ao) breakdown.push(`${ao} access-only`);
      if (breakdown.length) parts.push(`(${breakdown.join(", ")})`);
    }

    successMsg = parts.join(" ");
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="CodeBuddy OAuth Token Import" size="lg">
      <div className="flex flex-col gap-4">
        <p className="text-xs text-text-muted">Paste CodeBuddy OAuth tokens, one per line. Supports three formats:</p>
        <div className="flex flex-col gap-2 rounded-[10px] bg-background/50 p-3 text-xs text-text-muted">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[18px] text-brand-500 leading-none">check_circle</span>
            <span className="flex items-center gap-1.5"><code className="text-[10px] bg-border/50 px-1.5 py-0.5 rounded leading-none">accessToken</code><span>— access token only (24h expiry)</span></span>
          </div>
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[18px] text-brand-500 leading-none">check_circle</span>
            <span className="flex items-center gap-1.5"><code className="text-[10px] bg-border/50 px-1.5 py-0.5 rounded leading-none">accessToken:refreshToken</code><span>— enables auto-refresh</span></span>
          </div>
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[18px] text-brand-500 leading-none">check_circle</span>
            <span className="flex items-center gap-1.5"><code className="text-[10px] bg-border/50 px-1.5 py-0.5 rounded leading-none">accessToken:refreshToken:apiKey</code><span>— 365-day access</span></span>
          </div>
        </div>
        <textarea
          className="w-full rounded-[10px] border border-border bg-background p-3 font-mono text-xs text-text-main placeholder:text-text-muted focus:border-brand-500/40 focus:ring-2 focus:ring-brand-500/30 focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed"
          rows={8}
          placeholder={
            "eyJhbGciOiJSUzI1NiIs...\n" +
            "eyJhbGciOiJSUzI1NiIs...:eyJhbGciOiJSUzI1NiIs...\n" +
            "eyJhbGciOiJSUzI1NiIs...:eyJhbGciOiJSUzI1NiIs...:ak_abc123..."
          }
          value={tokens}
          onChange={(e) => setTokens(e.target.value)}
          disabled={loading}
        />
        {result && (
          <div className={`rounded-[10px] p-3 text-xs ${result.success ? "bg-green-500/10 text-green-600 dark:text-green-400" : "bg-red-500/10 text-red-600 dark:text-red-400"}`}>
            {successMsg || result.error || "Import failed"}
          </div>
        )}
        <div className="flex gap-2 pt-2">
          <Button variant="outline" onClick={onClose} fullWidth disabled={loading}>
            Close
          </Button>
          <Button
            variant="primary"
            onClick={handleImport}
            disabled={loading || !tokens.trim()}
            loading={loading}
            fullWidth
          >
            Import Tokens
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function CodeBuddyAutomationPanel({ providerInfo, onRefresh }) {
  const [isOpen, setIsOpen] = useState(false);
  const [isBulkOpen, setIsBulkOpen] = useState(false);
  const [isBulkTokenOpen, setIsBulkTokenOpen] = useState(false);

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <button type="button" onClick={() => setIsBulkOpen(true)} className="text-left">
          <Card
            hover
            padding="md"
            icon="group_add"
            title="Auto Login + Generate Key"
            subtitle="Run bulk GSuite gmail|password login, create a CodeBuddy Access Key, and save it for model calls."
          />
        </button>
        <button type="button" onClick={() => setIsBulkTokenOpen(true)} className="text-left">
          <Card
            hover
            padding="md"
            icon="playlist_add"
            title="OAuth Token Import"
            subtitle="Paste OAuth tokens with optional refresh tokens and API keys for extended access."
          />
        </button>
        <button type="button" onClick={() => setIsOpen(true)} className="text-left">
          <Card
            hover
            padding="md"
            icon="login"
            title="Device OAuth Login"
            subtitle="Open CodeBuddy browser login and poll until the OAuth token is saved."
          />
        </button>
      </div>
      <CodeBuddyBulkTokenModal
        isOpen={isBulkTokenOpen}
        onClose={() => setIsBulkTokenOpen(false)}
        onSuccess={onRefresh}
      />
      <BulkAccountAutomationModal
        isOpen={isBulkOpen}
        provider="codebuddy"
        title="CodeBuddy Bulk GSuite Login + Access Key"
        serviceName="CodeBuddy"
        onSuccess={onRefresh}
        onClose={() => setIsBulkOpen(false)}
      />
      <OAuthModal
        isOpen={isOpen}
        provider="codebuddy"
        providerInfo={providerInfo}
        onSuccess={() => {
          onRefresh?.();
          setIsOpen(false);
        }}
        onClose={() => setIsOpen(false)}
      />
    </>
  );
}

function CodeBuddyCnAutomationPanel({ onRefresh }) {
  const [isPhoneOpen, setIsPhoneOpen] = useState(false);

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <button type="button" onClick={() => setIsPhoneOpen(true)} className="text-left">
          <Card
            hover
            padding="md"
            icon="phone_iphone"
            title="Phone OTP + Generate Key"
            subtitle="Buy 5sim SMS OTP, login to CodeBuddy CN, generate an API key from the authenticated browser session, and save it."
          />
        </button>
      </div>
      <CodeBuddyCnPhoneAutomationModal
        isOpen={isPhoneOpen}
        onSuccess={onRefresh}
        onClose={() => setIsPhoneOpen(false)}
      />
    </>
  );
}

function QoderAutomationPanel({ providerInfo, onRefresh }) {
  const [isBulkOpen, setIsBulkOpen] = useState(false);
  const [isOAuthOpen, setIsOAuthOpen] = useState(false);

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <button type="button" onClick={() => setIsBulkOpen(true)} className="text-left">
          <Card
            hover
            padding="md"
            icon="group_add"
            title="Auto Login Bulk"
            subtitle="Run bulk gmail:password or gmail|password automation via Google SSO with Qoder device flow."
          />
        </button>
        <button type="button" onClick={() => setIsOAuthOpen(true)} className="text-left">
          <Card
            hover
            padding="md"
            icon="login"
            title="Device OAuth Login"
            subtitle="Open Qoder device login in browser and poll until the token is saved."
          />
        </button>
      </div>
      <BulkAccountAutomationModal
        isOpen={isBulkOpen}
        provider="qoder"
        title="Qoder Bulk GSuite Auto Login"
        serviceName="Qoder"
        onSuccess={onRefresh}
        onClose={() => setIsBulkOpen(false)}
      />
      <OAuthModal
        isOpen={isOAuthOpen}
        provider="qoder"
        providerInfo={providerInfo}
        onSuccess={() => {
          onRefresh?.();
          setIsOAuthOpen(false);
        }}
        onClose={() => setIsOAuthOpen(false)}
      />
    </>
  );
}

function AutoclawAutomationPanel({ onRefresh }) {
  const AUTOCLAW_PAGE_SIZE = 10;
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [isBulkOpen, setIsBulkOpen] = useState(false);
  const [autoclawConnections, setAutoclawConnections] = useState([]);
  const [autoclawPage, setAutoclawPage] = useState(1);
  const [refreshingIds, setRefreshingIds] = useState(() => new Set());
  const [autoRefreshingIds, setAutoRefreshingIds] = useState(() => new Set());
  const autoRefreshedRef = useRef(new Set());

  const visibleAutoclawConnections = useMemo(() => {
    const totalPages = Math.max(1, Math.ceil(autoclawConnections.length / AUTOCLAW_PAGE_SIZE));
    const page = Math.min(autoclawPage, totalPages);
    const start = (page - 1) * AUTOCLAW_PAGE_SIZE;
    return autoclawConnections.slice(start, start + AUTOCLAW_PAGE_SIZE);
  }, [autoclawConnections, autoclawPage]);

  const autoclawTotalPages = Math.max(1, Math.ceil(autoclawConnections.length / AUTOCLAW_PAGE_SIZE));
  const autoclawCurrentPage = Math.min(autoclawPage, autoclawTotalPages);

  const refreshAutoclawList = useCallback(async () => {
    try {
      const res = await fetch("/api/oauth/autoclaw/connections", { cache: "no-store" });
      const data = await res.json();
      if (res.ok) setAutoclawConnections(data.connections || []);
    } catch {
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- mount-only data fetch
    refreshAutoclawList();
  }, [refreshAutoclawList]);

  const refreshTokenFor = useCallback(async (connectionId, { auto = false } = {}) => {
    setRefreshingIds((prev) => new Set(prev).add(connectionId));
    if (auto) setAutoRefreshingIds((prev) => new Set(prev).add(connectionId));
    try {
      const res = await fetch(`/api/oauth/autoclaw/refresh?connectionId=${connectionId}`, { method: "POST" });
      if (res.ok) {
        await refreshAutoclawList();
      }
    } catch {
    } finally {
      setRefreshingIds((prev) => {
        const next = new Set(prev);
        next.delete(connectionId);
        return next;
      });
      if (auto) setAutoRefreshingIds((prev) => {
        const next = new Set(prev);
        next.delete(connectionId);
        return next;
      });
    }
  }, [refreshAutoclawList]);

  // Auto-refresh tokens for visible-page accounts with 0 points or balance fetch error (token likely revoked → keep alive)
  useEffect(() => {
    const needsRefresh = visibleAutoclawConnections.filter(
      (c) => !autoRefreshedRef.current.has(c.id) && (c.balance === 0 || c.balanceError)
    );
    if (needsRefresh.length === 0) return;
    needsRefresh.forEach((c) => autoRefreshedRef.current.add(c.id));
    let cancelled = false;
    (async () => {
      for (const c of needsRefresh) {
        if (cancelled) return;
        await refreshTokenFor(c.id, { auto: true });
        if (cancelled) return;
        await new Promise((r) => setTimeout(r, 1000));
      }
    })();
    return () => { cancelled = true; };
  }, [visibleAutoclawConnections, refreshTokenFor]);

  const handleSaved = async () => {
    await refreshAutoclawList();
    onRefresh?.();
  };

  const handleRefreshToken = (connectionId) => refreshTokenFor(connectionId);

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <button type="button" onClick={() => setIsBulkOpen(true)} className="text-left">
          <Card
            hover
            padding="md"
            icon="group_add"
            title="Auto Login Bulk"
            subtitle="Run bulk gmail|password automation via Google OAuth for AutoClaw."
          />
        </button>
        <button type="button" onClick={() => setIsImportOpen(true)} className="text-left">
          <Card
            hover
            padding="md"
            icon="token"
            title="Import Account"
            subtitle="Paste access_token + refresh_token from autoclaw.z.ai (Google OAuth interception)."
          />
        </button>
      </div>

      <BulkAccountAutomationModal
        isOpen={isBulkOpen}
        provider="autoclaw"
        title="AutoClaw Bulk Auto Login"
        serviceName="AutoClaw"
        onSuccess={onRefresh}
        onClose={() => setIsBulkOpen(false)}
      />

      {autoclawConnections.length > 0 && (
        <div className="mt-4 flex flex-col gap-2">
          <h3 className="text-sm font-semibold text-text-main">Saved Accounts</h3>
          <div className="flex flex-col gap-1">
            {visibleAutoclawConnections.map((c) => {
              const isAutoRefreshing = autoRefreshingIds.has(c.id);
              return (
                <div
                  key={c.id}
                  className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface px-3 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium">{c.name || c.email}</span>
                      {isAutoRefreshing && (
                        <Badge variant="warning" size="sm" dot>
                          Auto-refreshing
                        </Badge>
                      )}
                    </div>
                    <div className="text-xs text-text-muted">
                      {c.balance !== null && c.balance !== undefined ? `${c.balance} pts` : "—"}
                      {c.balanceError ? ` · ${c.balanceError}` : ""}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    loading={refreshingIds.has(c.id)}
                    onClick={() => handleRefreshToken(c.id)}
                  >
                    Refresh
                  </Button>
                </div>
              );
            })}
          </div>
          {autoclawConnections.length > AUTOCLAW_PAGE_SIZE && (
            <Pagination
              currentPage={autoclawCurrentPage}
              pageSize={AUTOCLAW_PAGE_SIZE}
              totalItems={autoclawConnections.length}
              onPageChange={setAutoclawPage}
              className="py-2 px-0"
            />
          )}
        </div>
      )}

      <AutoclawAutomationModal
        isOpen={isImportOpen}
        onClose={() => setIsImportOpen(false)}
        onSaved={handleSaved}
      />
    </>
  );
}

function CloudflareAutomationPanel({ onRefresh }) {
  const [isBulkOpen, setIsBulkOpen] = useState(false);
  const [isTokenOpen, setIsTokenOpen] = useState(false);

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <button type="button" onClick={() => setIsBulkOpen(true)} className="text-left">
          <Card
            hover
            padding="md"
            icon="cloud"
            title="Register/Login + Create Token"
            subtitle="Register or login Cloudflare via Google, create a Workers AI API token, verify it, test Workers AI, and save the Cloudflare AI provider."
          />
        </button>
        <button type="button" onClick={() => setIsTokenOpen(true)} className="text-left">
          <Card
            hover
            padding="md"
            icon="vpn_key"
            title="Import Existing Token"
            subtitle="Paste apiToken|accountId to verify the token, test Workers AI access, and save the connection. No browser needed."
          />
        </button>
      </div>

      <BulkAccountAutomationModal
        isOpen={isBulkOpen}
        provider="cloudflare-ai"
        title="Cloudflare AI Automation"
        serviceName="Cloudflare AI"
        onSuccess={onRefresh}
        onClose={() => setIsBulkOpen(false)}
      />
      <CloudflareTokenImportModal
        isOpen={isTokenOpen}
        onSuccess={onRefresh}
        onClose={() => setIsTokenOpen(false)}
      />
    </>
  );
}

const AUTOMATION_PROVIDERS = [
  {
    id: "kiro",
    label: "Kiro AI",
    icon: "psychology_alt",
    description: "Token import, bulk import, and social login automation.",
    supportedModes: ["single-token", "bulk-token", "bulk-account", "social"],
    component: KiroAutomationPanel,
  },
  {
    id: "codebuddy",
    label: "CodeBuddy",
    icon: "smart_toy",
    description: "Bulk GSuite automation and browser OAuth polling login.",
    supportedModes: ["bulk-account", "device-oauth"],
    component: CodeBuddyAutomationPanel,
  },
  {
    id: "codebuddy-cn",
    label: "CodeBuddy CN",
    icon: "smart_toy",
    description: "5sim phone OTP automation and generated API key import.",
    supportedModes: ["phone-otp", "api-key", "proxy-pool"],
    component: CodeBuddyCnAutomationPanel,
  },
  {
    id: "qoder",
    label: "Qoder",
    icon: "code",
    description: "Bulk GSuite auto login via Google SSO and device flow.",
    supportedModes: ["bulk-account", "device-oauth"],
    component: QoderAutomationPanel,
  },
  {
    id: "autoclaw",
    label: "AutoClaw",
    icon: "smart_toy",
    iconSrc: "/providers/autoclaw.webp?v=2",
    description: "Import AutoClaw access tokens or run bulk Google OAuth login. Tracks point balance + auto-refreshes tokens.",
    supportedModes: ["import-token", "bulk-account"],
    component: AutoclawAutomationPanel,
  },
  {
    id: "cloudflare-ai",
    label: "Cloudflare AI",
    icon: "cloud",
    description: "Register/login via Google, create Workers AI API tokens, verify access, and import existing tokens.",
    supportedModes: ["google-register", "cloudflare-login", "token-import", "workers-ai-test"],
    component: CloudflareAutomationPanel,
  },
];

function TabIcon({ provider, className = "" }) {
  const iconPath = provider.iconSrc || `/providers/${provider.id}.webp`;
  return (
    <div
      className="size-8 shrink-0 rounded-lg flex items-center justify-center"
      style={{
        backgroundColor: `${(provider.color || "#6B7280").length > 7 ? provider.color : (provider.color || "#6B7280") + "15"}`,
      }}
    >
      <ProviderIcon
        src={iconPath}
        alt={provider.label}
        size={30}
        className={`object-contain rounded-lg max-w-[32px] max-h-[32px] ${className}`}
        fallbackText={provider.label?.[0]}
        fallbackColor={provider.color}
      />
    </div>
  );
}

export default function AutomationPage() {
  const [connections, setConnections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeProviderId, setActiveProviderId] = useState(AUTOMATION_PROVIDERS[0].id);

  const fetchConnections = useCallback(async () => {
    try {
      const res = await fetch("/api/providers", { cache: "no-store" });
      const data = await res.json();
      if (res.ok) setConnections(data.connections || []);
    } catch (error) {
      console.log("Error fetching automation connections:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- mount-only data fetch
    fetchConnections();
  }, [fetchConnections]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const requestedProvider = new URLSearchParams(window.location.search).get("provider");
    console.log("[Automation Page] URL search params:", window.location.search);
    console.log("[Automation Page] Requested provider:", requestedProvider);
    if (AUTOMATION_PROVIDERS.some((provider) => provider.id === requestedProvider)) {
      console.log("[Automation Page] Setting active provider to:", requestedProvider);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time URL→state sync on mount
      setActiveProviderId(requestedProvider);
    } else {
      console.log("[Automation Page] Provider not found, using default:", AUTOMATION_PROVIDERS[0].id);
    }
  }, []);

  const activeProvider = AUTOMATION_PROVIDERS.find((provider) => provider.id === activeProviderId) || AUTOMATION_PROVIDERS[0];
  const providerInfo = FREE_PROVIDERS[activeProvider.id] || { id: activeProvider.id, name: activeProvider.label };
  const ProviderPanel = activeProvider.component;
  const providerCounts = useMemo(() => {
    const counts = {};
    for (const provider of AUTOMATION_PROVIDERS) {
      counts[provider.id] = connections.filter((connection) => connection.provider === provider.id).length;
    }
    return counts;
  }, [connections]);

  if (loading) {
    return (
      <div className="flex flex-col gap-6">
        <CardSkeleton />
        <CardSkeleton />
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-6 px-1 sm:px-0">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">Automation</h1>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {AUTOMATION_PROVIDERS.map((provider) => {
          const selected = provider.id === activeProviderId;
          return (
            <button
              key={provider.id}
              type="button"
              onClick={() => setActiveProviderId(provider.id)}
              className={`flex min-w-0 items-center gap-3 rounded-lg border px-4 py-3 text-left transition-colors ${
                selected
                  ? "border-primary/50 bg-primary/10 text-primary"
                  : "border-border bg-surface text-text-main hover:border-primary/30 hover:bg-primary/5"
              }`}
            >
              <TabIcon provider={provider} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">{provider.label}</span>
                <span className="mt-0.5 block text-xs text-text-muted">
                  {getConnectionLabel(providerCounts[provider.id] || 0)}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      <Card>
        <div className="flex min-w-0 flex-col gap-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <TabIcon provider={activeProvider} className="text-primary" />
                <h2 className="text-lg font-semibold">{activeProvider.label}</h2>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {activeProvider.supportedModes.map((mode) => (
                  <Badge key={mode} variant="default" size="sm">
                    {mode}
                  </Badge>
                ))}
              </div>
            </div>
            <Badge variant="success">{getConnectionLabel(providerCounts[activeProvider.id] || 0)}</Badge>
          </div>

          <ProviderPanel providerInfo={providerInfo} onRefresh={fetchConnections} />
        </div>
      </Card>
    </div>
  );
}
