"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Badge from "./Badge";
import Button from "./Button";
import Input from "./Input";
import Modal from "./Modal";
import {
  formatBrowserProxyPoolOption,
  getBrowserProxyPools,
} from "@/lib/oauth/services/bulkImportProxyOptions.js";
import { readJsonResponse } from "@/shared/utils/httpResponse.js";

const DEFAULT_CONCURRENCY = 4;
const ACTIVE_JOB_STATUSES = new Set(["queued", "running", "needs_manual"]);
const TERMINAL_JOB_STATUSES = new Set(["completed", "failed", "cancelled"]);
const DEFAULT_ENGINE = "cloakbrowser";
const ENGINE_OPTIONS = [
  { value: "cloakbrowser", label: "CloakBrowser (anti-detect, default)" },
  { value: "chromium", label: "Chromium (fast)" },
  { value: "camoufox", label: "Camoufox (stealth Firefox, slower)" },
  { value: "patchright", label: "Patchright (Chromium stealth)" },
  { value: "patchright-chrome", label: "Patchright Chrome (system Chrome)" },
  { value: "cloakbrowser", label: "CloakBrowser (anti-detect)" },
];

function describeWorkerLimit(limitedBy) {
  if (limitedBy === "ram") return "RAM";
  if (limitedBy === "cpu") return "CPU";
  return "default";
}

function formatStepLabel(value) {
  return String(value || "waiting").replaceAll("_", " ");
}

function formatClock(value) {
  if (!value) return "now";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "now";
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function getStatusVariant(status) {
  if (status === "success" || status === "completed") return "success";
  if (status === "needs_manual") return "warning";
  if (status === "running" || status === "queued") return "info";
  if (status === "cancelled") return "default";
  return "danger";
}

function AccountStatusBadge({ status }) {
  return (
    <Badge variant={getStatusVariant(status)} size="sm">
      {formatStepLabel(status)}
    </Badge>
  );
}

function StepStatusDot({ status }) {
  const className = status === "done"
    ? "bg-green-500"
    : status === "running"
      ? "bg-blue-500"
      : status === "failed"
        ? "bg-red-500"
        : "bg-border";

  return <span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${className}`} />;
}

async function fetchJob(provider, jobId) {
  const res = await fetch(`/api/oauth/${provider}/bulk-import/${jobId}`, { cache: "no-store" });
  const data = await readJsonResponse(res, "Failed to fetch bulk login job");
  return { res, data };
}

async function fetchLatestJob(provider, scope = "recoverable") {
  const res = await fetch(`/api/oauth/${provider}/bulk-import/latest?scope=${encodeURIComponent(scope)}`, { cache: "no-store" });
  if (res.status === 404 || !res.ok) {
    return { res, data: { success: false, job: null, recoverable: false } };
  }
  const data = await readJsonResponse(res, "Failed to fetch latest bulk login job");
  return { res, data };
}

export default function BulkAccountAutomationModal({
  isOpen,
  onClose,
  onSuccess,
  provider,
  title,
  serviceName,
}) {
  const storageKey = `${provider}-bulk-import-active-job`;
  const configStorageKey = `${provider}-bulk-import-config`;
  const completedRefreshJobsRef = useRef(new Set());

  // Load cached config from localStorage on first render. This preserves the
  // user's engine/proxy/concurrency choices across modal open/close cycles so
  // they don't have to reconfigure every time.
  const cachedConfig = useMemo(() => {
    if (typeof window === "undefined") return {};
    try {
      const raw = window.localStorage.getItem(configStorageKey);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }, [configStorageKey]);

  const [bulkText, setBulkText] = useState("");
  const [concurrency, setConcurrency] = useState(String(cachedConfig.concurrency ?? DEFAULT_CONCURRENCY));
  const [autoConcurrency, setAutoConcurrency] = useState(cachedConfig.autoConcurrency ?? true);
  const [systemSpecInfo, setSystemSpecInfo] = useState(null);
  const [systemSpecLoading, setSystemSpecLoading] = useState(false);
  const [engine, setEngine] = useState(cachedConfig.engine ?? DEFAULT_ENGINE);
  const [headless, setHeadless] = useState(cachedConfig.headless ?? false);
  const [proxyPoolId, setProxyPoolId] = useState(cachedConfig.proxyPoolId ?? "");
  const [proxyUrl, setProxyUrl] = useState(cachedConfig.proxyUrl ?? "");
  const [randomizeProxySession, setRandomizeProxySession] = useState(cachedConfig.randomizeProxySession ?? false);
  const [proxyPools, setProxyPools] = useState([]);
  const [activeJob, setActiveJob] = useState(null);
  const [error, setError] = useState(null);
  const [importing, setImporting] = useState(false);
  const [jobRestoreNotice, setJobRestoreNotice] = useState(null);

  // Persist config to localStorage whenever it changes. Debounce via
  // useEffect so we only write once per render cycle.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const config = { engine, headless, proxyPoolId, proxyUrl, randomizeProxySession, autoConcurrency, concurrency };
      window.localStorage.setItem(configStorageKey, JSON.stringify(config));
    } catch {
      // localStorage might be full or disabled — ignore
    }
  }, [configStorageKey, engine, headless, proxyPoolId, proxyUrl, randomizeProxySession, autoConcurrency, concurrency]);

  const runningJob = activeJob && ACTIVE_JOB_STATUSES.has(activeJob.status);
  const finishedJob = activeJob && TERMINAL_JOB_STATUSES.has(activeJob.status);

  const groupedAccounts = useMemo(() => {
    const groups = new Map();
    for (const account of activeJob?.accounts || []) {
      const key = account.status || "unknown";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(account);
    }
    return [...groups.entries()].map(([status, accounts]) => ({ status, accounts }));
  }, [activeJob]);

  const activityItems = useMemo(() => (
    [...(activeJob?.activity || [])].reverse()
  ), [activeJob]);

  const resetState = useCallback(() => {
    setBulkText("");
    setActiveJob(null);
    setError(null);
    setImporting(false);
    setJobRestoreNotice(null);
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(storageKey);
    }
  }, [storageKey]);

  useEffect(() => {
    if (!isOpen) return;
    if (systemSpecInfo) return;

    let cancelled = false;
    const run = async () => {
      setSystemSpecLoading(true);
      try {
        const res = await fetch("/api/system/specs", { cache: "no-store" });
        const data = await readJsonResponse(res, "Failed to detect system specs");
        if (cancelled || !data?.success) return;
        setSystemSpecInfo(data);
        setConcurrency((current) => {
          const parsed = Number.parseInt(current, 10);
          return Number.isFinite(parsed) ? current : String(data.recommended);
        });
      } catch {
        // noop
      } finally {
        if (!cancelled) setSystemSpecLoading(false);
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [isOpen, systemSpecInfo]);

  useEffect(() => {
    if (!isOpen) return;

    let cancelled = false;
    const loadPools = async () => {
      try {
        const res = await fetch("/api/proxy-pools?isActive=true", { cache: "no-store" });
        if (!res.ok) return;
        const data = await readJsonResponse(res, "Failed to fetch proxy pools");
        if (cancelled) return;
        setProxyPools(getBrowserProxyPools(data));
      } catch {
        // noop
      }
    };

    void loadPools();
    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    let cancelled = false;
    const restore = async () => {
      setError(null);
      setJobRestoreNotice(null);
      try {
        const storedJobId = typeof window !== "undefined"
          ? window.localStorage.getItem(storageKey)
          : null;
        if (storedJobId) {
          const { res, data } = await fetchJob(provider, storedJobId);
          if (!cancelled && res.ok && data?.job && data.recoverable) {
            setActiveJob(data.job);
            setJobRestoreNotice("Restored the active bulk login job.");
            return;
          }
        }

        const latest = await fetchLatestJob(provider);
        if (!cancelled && latest.res.ok && latest.data?.job) {
          setActiveJob(latest.data.job);
          setJobRestoreNotice("Restored the latest recoverable bulk login job.");
          if (typeof window !== "undefined") {
            window.localStorage.setItem(storageKey, latest.data.job.jobId);
          }
        }
      } catch {
        if (!cancelled) setJobRestoreNotice(null);
      }
    };

    void restore();
    return () => {
      cancelled = true;
    };
  }, [isOpen, provider, storageKey]);

  useEffect(() => {
    if (!isOpen || !activeJob?.jobId || finishedJob) return undefined;

    const interval = window.setInterval(async () => {
      try {
        const { res, data } = await fetchJob(provider, activeJob.jobId);
        if (res.ok && data?.job) {
          setActiveJob((prev) => {
            const next = data.job;
            if (prev && next?.jobId === prev.jobId) {
              const prevPreview = prev.preview?.imageData;
              const nextPreview = next.preview?.imageData;
              const prevActivityLen = prev.activity?.length || 0;
              const nextActivityLen = next.activity?.length || 0;
              const prevSummary = JSON.stringify(prev.summary || {});
              const nextSummary = JSON.stringify(next.summary || {});
              const prevAccountsSig = (prev.accounts || []).map((a) => `${a.line}:${a.status}`).join(",");
              const nextAccountsSig = (next.accounts || []).map((a) => `${a.line}:${a.status}`).join(",");
              if (
                prevPreview === nextPreview &&
                prevActivityLen === nextActivityLen &&
                prevSummary === nextSummary &&
                prevAccountsSig === nextAccountsSig &&
                prev.status === next.status
              ) {
                return prev;
              }
            }
            return next;
          });
          if (typeof window !== "undefined") {
            window.localStorage.setItem(storageKey, data.job.jobId);
          }
          if (TERMINAL_JOB_STATUSES.has(data.job.status) && !completedRefreshJobsRef.current.has(data.job.jobId)) {
            completedRefreshJobsRef.current.add(data.job.jobId);
            onSuccess?.();
          }
        }
      } catch {
        // Keep the current snapshot visible; the next interval can recover.
      }
    }, 2000);

    return () => window.clearInterval(interval);
  }, [activeJob?.jobId, finishedJob, isOpen, onSuccess, provider, storageKey]);

  const handleStartBulk = async () => {
    const isCloudflare = provider === "cloudflare-ai";
    const lines = bulkText
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

    if (!lines.length) {
      setError(isCloudflare ? "Please enter at least one email:password line" : "Please enter at least one email:password or email|password line");
      return;
    }

    setImporting(true);
    setError(null);
    setJobRestoreNotice(null);

    try {
      const postBody = {
        accounts: lines,
        concurrency: autoConcurrency
          ? "auto"
          : Number.parseInt(concurrency, 10) || DEFAULT_CONCURRENCY,
        engine,
        headless,
      };
      if (proxyPoolId) {
        postBody.proxyPoolId = proxyPoolId;
      } else if (proxyUrl.trim()) {
        postBody.proxyUrl = proxyUrl.trim();
      }
      postBody.randomizeProxySession = randomizeProxySession;
      const res = await fetch(`/api/oauth/${provider}/bulk-import`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(postBody),
      });
      const data = await readJsonResponse(res, "Bulk account import failed");
      if (!res.ok || data.error) {
        const invalidHint = Array.isArray(data.invalidLines) && data.invalidLines.length > 0
          ? ` Invalid lines: ${data.invalidLines.join(", ")}`
          : "";
        throw new Error((data.error || "Bulk account import failed") + invalidHint);
      }

      setActiveJob(data.job || null);
      if (data.job?.jobId) {
        completedRefreshJobsRef.current.delete(data.job.jobId);
        if (typeof window !== "undefined") window.localStorage.setItem(storageKey, data.job.jobId);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setImporting(false);
    }
  };

  const handleCancelJob = async () => {
    if (!activeJob?.jobId) return;

    try {
      const res = await fetch(`/api/oauth/${provider}/bulk-import/${activeJob.jobId}/cancel`, {
        method: "POST",
      });
      const data = await readJsonResponse(res, "Failed to cancel job");
      if (!res.ok || data.error) throw new Error(data.error || "Failed to cancel job");
      if (data.job) setActiveJob(data.job);
    } catch (err) {
      setError(err.message);
    }
  };

  const handleOpenManualSession = async (workerId) => {
    if (!activeJob?.jobId || !workerId) return;

    try {
      const res = await fetch(`/api/oauth/${provider}/bulk-import/${activeJob.jobId}/manual/${workerId}`, {
        method: "POST",
      });
      const data = await readJsonResponse(res, "Failed to open manual session");
      if (!res.ok || data.error) throw new Error(data.error || "Failed to open manual session");
      if (data.job) setActiveJob(data.job);
    } catch (err) {
      setError(err.message);
    }
  };

  const handleDoneRefresh = () => {
    resetState();
    onSuccess?.();
  };

  return (
    <Modal
      isOpen={isOpen}
      title={title}
      onClose={onClose}
      size="full"
      className="max-w-[min(96vw,1320px)]"
    >
      <div className="flex flex-col gap-4">
        {!activeJob && (
          <>
            <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 dark:border-blue-800 dark:bg-blue-900/20">
              {provider === "cloudflare-ai" ? (
                <p className="text-sm text-blue-800 dark:text-blue-200">
                  Bulk Cloudflare import uses Google signup/login by default, then creates a Workers AI token and saves it. Use one account per line: <code className="rounded bg-blue-100 px-1 dark:bg-blue-800">email:password</code> or <code className="rounded bg-blue-100 px-1 dark:bg-blue-800">email|password</code>. Existing tokens still support <code className="rounded bg-blue-100 px-1 dark:bg-blue-800">apiToken|accountId|optionalName</code>. Complete captcha/2FA in the opened browser if needed.
                </p>
              ) : (
                <p className="text-sm text-blue-800 dark:text-blue-200">
                  Bulk GSuite login runs browser workers in the background. Use one account per line: <code className="rounded bg-blue-100 px-1 dark:bg-blue-800">email:password</code> or <code className="rounded bg-blue-100 px-1 dark:bg-blue-800">email|password</code>. Lines starting with <code className="rounded bg-blue-100 px-1 dark:bg-blue-800">#</code> are skipped. Accounts that hit CAPTCHA, 2FA, or recovery prompts move to manual assist.
                </p>
              )}
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium">
                Bulk Accounts <span className="text-red-500">*</span>
              </label>
              <textarea
                value={bulkText}
                onChange={(event) => setBulkText(event.target.value)}
                placeholder={provider === "cloudflare-ai" ? "gmail1@example.com:password1\ngmail2@example.com|password2\ncf_api_token_1|account_id_1|main\n# comment lines are skipped" : "gmail1@example.com:password1\ngmail2@example.com|password2\n# comment lines are skipped"}
                className="min-h-[180px] w-full resize-y rounded-lg border border-border bg-background px-3 py-2 font-mono text-sm focus:outline-none focus:ring-1 focus:ring-primary"
              />
              <p className="mt-1 text-xs text-text-muted">
                {provider === "cloudflare-ai" ? "One account per line. Supported: email:password, email|password, apiToken|accountId|name, or JSON." : "One account per line. Supported formats: email:password, email|password, or tab-separated."}
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <label className="block text-sm font-medium">Concurrent Workers</label>
                  <label className="flex cursor-pointer items-center gap-2 text-xs text-text-muted">
                    <input
                      type="checkbox"
                      checked={autoConcurrency}
                      onChange={(event) => {
                        const next = event.target.checked;
                        setAutoConcurrency(next);
                        if (next && systemSpecInfo?.recommended) {
                          setConcurrency(String(systemSpecInfo.recommended));
                        }
                      }}
                    />
                    Auto-detect by system spec
                  </label>
                </div>
                <Input
                  type="number"
                  min="1"
                  max="8"
                  value={
                    autoConcurrency
                      ? String(systemSpecInfo?.recommended ?? concurrency)
                      : concurrency
                  }
                  onChange={(event) => setConcurrency(event.target.value)}
                  disabled={autoConcurrency}
                  placeholder="4"
                />
                <p className="mt-1 text-xs text-text-muted">
                  {autoConcurrency
                    ? systemSpecLoading
                      ? "Detecting system specs..."
                      : systemSpecInfo
                        ? `Recommended ${systemSpecInfo.recommended} workers for this machine (${systemSpecInfo.specs.cpuCount}-core CPU, ${systemSpecInfo.specs.totalMemGb} GB RAM, limited by ${describeWorkerLimit(systemSpecInfo.limitedBy)}).`
                        : `Falling back to default ${DEFAULT_CONCURRENCY} workers.`
                    : "Manual mode. Allowed range: 1 to 8 workers."}
                </p>
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium">Browser Engine</label>
                <select
                  value={engine}
                  onChange={(event) => setEngine(event.target.value)}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                >
                  {ENGINE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-text-muted">
                  CloakBrowser is anti-detect; Camoufox is stealth Firefox (~150MB download).
                </p>
              </div>
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium">Browser Mode</label>
              <label className="flex cursor-pointer items-center gap-2 text-sm text-text-main">
                <input
                  type="checkbox"
                  checked={headless}
                  onChange={(event) => setHeadless(event.target.checked)}
                  className="h-4 w-4 rounded border-border"
                />
                Run headless (no visible browser window)
              </label>
              <p className="mt-1 text-xs text-text-muted">
                Headless is faster but you cannot manually solve CAPTCHA/2FA. Turn off if login needs manual interaction.
              </p>
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium">Network Proxy (optional)</label>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs text-text-muted">Proxy Pool</label>
                  <select
                    value={proxyPoolId}
                    onChange={(event) => {
                      setProxyPoolId(event.target.value);
                      if (event.target.value) setProxyUrl("");
                    }}
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                  >
                    <option value="">None</option>
                    {proxyPools.map((pool) => (
                      <option key={pool.id} value={pool.id} disabled={!pool.browserCompatible}>
                        {formatBrowserProxyPoolOption(pool)}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs text-text-muted">Custom Proxy URL</label>
                  <Input
                    type="text"
                    value={proxyUrl}
                    onChange={(event) => setProxyUrl(event.target.value)}
                    disabled={Boolean(proxyPoolId)}
                    placeholder="http://user:pass@host:port"
                  />
                  <label className="mt-2 flex cursor-pointer items-start gap-2 text-xs text-text-muted">
                    <input
                      type="checkbox"
                      checked={randomizeProxySession}
                      onChange={(event) => setRandomizeProxySession(event.target.checked)}
                      className="mt-0.5 h-4 w-4 rounded border-border"
                    />
                    <span>Randomize proxy session ID on launch (changes <code className="rounded bg-sidebar px-1">sid-*</code> when present).</span>
                  </label>
                </div>
              </div>
              <p className="mt-1 text-xs text-text-muted">
                Browsers will route login traffic through the chosen proxy. Multiple URLs in a pool or custom field rotate round-robin across workers. Relay-style pools (Vercel, Cloudflare, Deno) are excluded because they only rewrite API URLs.
              </p>
            </div>
          </>
        )}

        {activeJob && (
          <div className="space-y-4">
            <div className="flex flex-col gap-3 rounded-xl border border-border p-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h3 className="font-semibold">{serviceName} Bulk Login Job</h3>
                <p className="text-xs text-text-muted">
                  Job ID: <span className="font-mono">{activeJob.jobId}</span>
                </p>
                <p className="text-xs text-text-muted">
                  Status: <span className="font-medium">{activeJob.status}</span> | Workers: {activeJob.concurrency}
                </p>
              </div>
              <div className="flex gap-2">
                {runningJob && (
                  <Button size="sm" variant="secondary" onClick={handleCancelJob}>
                    Cancel Job
                  </Button>
                )}
                {finishedJob && (
                  <Button size="sm" onClick={handleDoneRefresh}>
                    Done & Refresh
                  </Button>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
              {Object.entries(activeJob.summary || {}).map(([label, value]) => (
                <div key={label} className="rounded-lg bg-sidebar px-3 py-2">
                  <p className="text-[11px] uppercase tracking-wide text-text-muted">{formatStepLabel(label)}</p>
                  <p className="text-lg font-semibold">{value}</p>
                </div>
              ))}
            </div>

            {activeJob.error && (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300">
                {activeJob.error}
              </div>
            )}

            {activeJob.summary?.needs_manual > 0 && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-200">
                Some accounts need manual assist. Open the worker session, finish the Google or {serviceName} prompts, and the job will keep polling.
              </div>
            )}

            <div className="grid gap-4 lg:grid-cols-[minmax(0,7fr)_minmax(300px,3fr)]">
              <div className="space-y-4">
                <div className="overflow-hidden rounded-xl border border-border bg-sidebar">
                  <div className="flex flex-col gap-2 border-b border-border px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-sm font-semibold">Live Browser Preview</p>
                      <p className="text-xs text-text-muted">
                        {activeJob.preview?.email || "Waiting for worker"}
                        {activeJob.preview?.workerId ? ` | Worker ${activeJob.preview.workerId}` : ""}
                      </p>
                    </div>
                    <div className="text-right text-xs text-text-muted">
                      <p>{formatStepLabel(activeJob.preview?.step)}</p>
                      <p>Updated {formatClock(activeJob.preview?.updatedAt)}</p>
                    </div>
                  </div>
                  <div className="relative bg-black/90">
                    {activeJob.preview?.imageData ? (
                      <img
                        src={activeJob.preview.imageData}
                        alt={`Live worker preview for ${activeJob.preview.email || serviceName}`}
                        className="h-[340px] w-full object-contain transition-opacity duration-150"
                        loading="eager"
                        decoding="async"
                      />
                    ) : (
                      <div className="flex h-[340px] flex-col items-center justify-center gap-3 px-6 text-center text-slate-200">
                        <span className="material-symbols-outlined text-5xl text-primary/80">browser_updated</span>
                        <div>
                          <p className="text-base font-medium">Preview will appear when a worker opens Google or {serviceName}</p>
                          <p className="mt-1 text-sm text-slate-400">The job keeps running even when a screenshot is not available yet.</p>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {groupedAccounts.map((group) => (
                  <div key={group.status} className="rounded-xl border border-border p-4">
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <AccountStatusBadge status={group.status} />
                        <p className="text-sm font-semibold capitalize">{formatStepLabel(group.status)}</p>
                      </div>
                      <p className="text-xs text-text-muted">{group.accounts.length} account{group.accounts.length === 1 ? "" : "s"}</p>
                    </div>

                    <div className="grid gap-3 xl:grid-cols-2">
                      {group.accounts.map((account) => (
                        <div key={`${account.email}-${account.line}`} className="rounded-xl border border-border bg-background/80 p-4">
                          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                            <div className="min-w-0">
                              <p className="truncate text-sm font-semibold">{account.email}</p>
                              <p className="text-[11px] text-text-muted">
                                Line {account.line}{account.workerId ? ` | Worker ${account.workerId}` : ""} | {formatClock(account.updatedAt)}
                              </p>
                            </div>
                            <AccountStatusBadge status={account.status} />
                          </div>

                          <div className="mt-3 rounded-lg border border-border/70 bg-sidebar/70 px-3 py-2">
                            <p className="text-[11px] uppercase tracking-wide text-text-muted">Current Step</p>
                            <p className="mt-1 text-sm font-medium capitalize">{formatStepLabel(account.currentStep)}</p>
                          </div>

                          {Array.isArray(account.detailedSteps) && account.detailedSteps.length > 0 && (
                            <div className="mt-3 rounded-lg border border-border/70 bg-sidebar/70 px-3 py-3">
                              <p className="text-[11px] uppercase tracking-wide text-text-muted">Detailed Steps</p>
                              <div className="mt-3 space-y-2">
                                {account.detailedSteps.map((step) => (
                                  <div key={step.id} className="flex gap-2 text-xs">
                                    <StepStatusDot status={step.status} />
                                    <div className="min-w-0 flex-1">
                                      <div className="flex items-center justify-between gap-2">
                                        <p className="font-medium text-text-main">{step.index}. {step.label}</p>
                                        <span className="shrink-0 capitalize text-text-muted">{formatStepLabel(step.status)}</span>
                                      </div>
                                      {step.message && (
                                        <p className="mt-0.5 text-text-muted">{step.message}</p>
                                      )}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          {account.error && (
                            <p className="mt-3 text-xs text-red-500">{account.error}</p>
                          )}

                          {account.manualSessionAvailable && account.workerId ? (
                            <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
                              <Button
                                size="sm"
                                variant={account.manualSessionOpened ? "secondary" : "primary"}
                                onClick={() => handleOpenManualSession(account.workerId)}
                              >
                                {account.manualSessionOpened ? "Re-open Manual Session" : "Open Manual Session"}
                              </Button>
                              <p className="text-[11px] text-text-muted">
                                Use this only for CAPTCHA, 2FA, or recovery prompts.
                              </p>
                            </div>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              <div className="rounded-xl border border-border bg-sidebar/70">
                <div className="border-b border-border px-4 py-3">
                  <p className="text-sm font-semibold">Live Activity Log</p>
                  <p className="text-xs text-text-muted">Worker steps update in near real time.</p>
                </div>
                <div className="max-h-[640px] space-y-3 overflow-y-auto p-4">
                  {activityItems.length === 0 && (
                    <div className="rounded-lg bg-background/70 px-3 py-4 text-sm text-text-muted">
                      Waiting for the first worker event...
                    </div>
                  )}
                  {activityItems.map((entry) => (
                    <div key={entry.id} className="rounded-lg border border-border/70 bg-background/80 px-3 py-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold">{entry.email}</p>
                          <p className="text-[11px] text-text-muted">
                            {entry.workerId ? `Worker ${entry.workerId}` : "Waiting"} | {formatStepLabel(entry.step)}
                          </p>
                        </div>
                        <span className="shrink-0 text-[11px] text-text-muted">{formatClock(entry.at)}</span>
                      </div>
                      <p className="mt-2 text-xs text-text-muted">{entry.message}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {jobRestoreNotice && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-900/20">
            <p className="text-sm text-amber-700 dark:text-amber-300">{jobRestoreNotice}</p>
          </div>
        )}

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 dark:border-red-800 dark:bg-red-900/20">
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
          </div>
        )}

        <div className="flex gap-2">
          {!activeJob && (
            <Button onClick={handleStartBulk} fullWidth disabled={importing || !bulkText.trim()}>
              {importing ? "Starting..." : "Start Bulk Login"}
            </Button>
          )}
          {activeJob && !finishedJob && (
            <Button onClick={handleCancelJob} fullWidth variant="secondary" disabled={!runningJob}>
              {runningJob ? "Cancel Running Job" : "Job Stopped"}
            </Button>
          )}
          {finishedJob && (
            <Button onClick={handleDoneRefresh} fullWidth>
              Done & Refresh Connections
            </Button>
          )}
          <Button onClick={activeJob ? resetState : onClose} variant="ghost" fullWidth>
            {activeJob ? "Clear" : "Cancel"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
