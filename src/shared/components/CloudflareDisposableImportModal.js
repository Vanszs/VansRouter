"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Badge from "./Badge";
import Button from "./Button";
import Input from "./Input";
import Modal from "./Modal";
import { readJsonResponse } from "@/shared/utils/httpResponse.js";

const ACTIVE_JOB_STATUSES = new Set(["queued", "running", "needs_manual"]);
const TERMINAL_JOB_STATUSES = new Set(["completed", "failed", "cancelled"]);
const DEFAULT_CONCURRENCY = 2;
const STORAGE_KEY = "cloudflare-disposable-active-job";

const ENGINE_OPTIONS = [
  { value: "cloakbrowser", label: "CloakBrowser (anti-detect)" },
  { value: "chromium", label: "Chromium (fast)" },
  { value: "camoufox", label: "Camoufox (stealth Firefox)" },
  { value: "patchright", label: "Patchright (Chromium stealth)" },
];

function formatClock(value) {
  if (!value) return "now";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "now";
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function formatStepLabel(value) {
  return String(value || "waiting").replaceAll("_", " ");
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

async function fetchJob(provider, jobId) {
  const res = await fetch(`/api/oauth/${provider}/bulk-import/${jobId}`, { cache: "no-store" });
  const data = await readJsonResponse(res, "Failed to fetch job");
  return { res, data };
}

async function fetchLatestJob(provider) {
  const res = await fetch(`/api/oauth/${provider}/bulk-import/latest?scope=recoverable`, { cache: "no-store" });
  if (res.status === 404 || !res.ok) return { res, data: { success: false, job: null } };
  const data = await readJsonResponse(res, "Failed to fetch latest job");
  return { res, data };
}

export default function CloudflareDisposableImportModal({ isOpen, onClose, onSuccess }) {
  const [mailProvider, setMailProvider] = useState("mailtm");
  const [mailApi, setMailApi] = useState("mail.tm");
  const [workerUrl, setWorkerUrl] = useState("");
  const [mailDomains, setMailDomains] = useState("");
  const [accountCount, setAccountCount] = useState("1");
  const [concurrency, setConcurrency] = useState("1");
  const [engine, setEngine] = useState("cloakbrowser");
  const [headless, setHeadless] = useState(false);
  const [proxyUrl, setProxyUrl] = useState("");
  const [loadingDomains, setLoadingDomains] = useState(false);
  const [activeJob, setActiveJob] = useState(null);
  const [error, setError] = useState(null);
  const [importing, setImporting] = useState(false);
  const [jobRestoreNotice, setJobRestoreNotice] = useState(null);
  const completedRefreshRef = useRef(new Set());

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

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => {
    if (!isOpen || activeJob || mailProvider !== "mailtm") return;
    if (loadingDomains) return;
    let cancelled = false;
    setLoadingDomains(true);
    fetch("https://api.mail.tm/domains")
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        const domains = (data["hydra:member"] || []).map((d) => d.domain).filter(Boolean);
        if (domains.length) setMailDomains(domains.join(", "));
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoadingDomains(false); });
    return () => { cancelled = true; };
  }, [isOpen, mailProvider, activeJob, loadingDomains]);

  const resetState = useCallback(() => {
    setActiveJob(null);
    setError(null);
    setImporting(false);
    setJobRestoreNotice(null);
    if (typeof window !== "undefined") localStorage.removeItem(STORAGE_KEY);
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    const restore = async () => {
      setError(null);
      setJobRestoreNotice(null);
      try {
        const storedJobId = typeof window !== "undefined" ? localStorage.getItem(STORAGE_KEY) : null;
        if (storedJobId) {
          const { res, data } = await fetchJob("cloudflare-ai", storedJobId);
          if (!cancelled && res.ok && data?.job && data.recoverable) {
            setActiveJob(data.job);
            setJobRestoreNotice("Restored active disposable email signup job.");
            return;
          }
        }
        const latest = await fetchLatestJob("cloudflare-ai");
        if (!cancelled && latest.res.ok && latest.data?.job) {
          setActiveJob(latest.data.job);
          setJobRestoreNotice("Restored latest recoverable job.");
          if (typeof window !== "undefined") localStorage.setItem(STORAGE_KEY, latest.data.job.jobId);
        }
      } catch {
        if (!cancelled) setJobRestoreNotice(null);
      }
    };
    void restore();
    return () => { cancelled = true; };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !activeJob?.jobId || finishedJob) return;
    const interval = setInterval(async () => {
      try {
        const { res, data } = await fetchJob("cloudflare-ai", activeJob.jobId);
        if (res.ok && data?.job) {
          setActiveJob((prev) => {
            if (prev && data.job.jobId === prev.jobId) {
              if (JSON.stringify(prev.summary || {}) === JSON.stringify(data.job.summary || {}) &&
                  JSON.stringify((prev.accounts || []).map((a) => `${a.line}:${a.status}`)) ===
                  JSON.stringify((data.job.accounts || []).map((a) => `${a.line}:${a.status}`)) &&
                  JSON.stringify((prev.accounts || []).map((a) => `${a.line}:${a.currentStep}`)) ===
                  JSON.stringify((data.job.accounts || []).map((a) => `${a.line}:${a.currentStep}`)) &&
                  (prev.activity || []).length === (data.job.activity || []).length &&
                  (prev.preview?.imageData || "").length === (data.job.preview?.imageData || "").length &&
                  prev.status === data.job.status) return prev;
            }
            return data.job;
          });
          if (typeof window !== "undefined") localStorage.setItem(STORAGE_KEY, data.job.jobId);
          if (TERMINAL_JOB_STATUSES.has(data.job.status) && !completedRefreshRef.current.has(data.job.jobId)) {
            completedRefreshRef.current.add(data.job.jobId);
            onSuccess?.();
          }
        }
      } catch {}
    }, 3000);
    return () => clearInterval(interval);
  }, [activeJob?.jobId, finishedJob, isOpen, onSuccess]);

  const handleStart = async () => {
    const count = Number.parseInt(accountCount, 10) || 1;
    const resolvedMailApi = mailProvider === "cf-email" ? workerUrl.trim() : mailApi.trim();
    const resolvedDomains = mailProvider === "cf-email"
      ? mailDomains.split(",").map((d) => d.trim()).filter(Boolean)
      : mailDomains.split(",").map((d) => d.trim()).filter(Boolean);

    if (!resolvedMailApi) { setError("Worker URL is required for CF Email Routing"); return; }
    if (!resolvedDomains.length) { setError("At least one mail domain is required"); return; }

    setImporting(true);
    setError(null);

    try {
      const postBody = {
        accounts: Array.from({ length: count }, (_, i) => `signup-${i + 1}`),
        concurrency: Number.parseInt(concurrency, 10) || DEFAULT_CONCURRENCY,
        engine,
        headless,
        signupMode: true,
        mailApi: resolvedMailApi,
        mailDomains: resolvedDomains,
        mailProvider,
      };
      if (proxyUrl.trim()) postBody.proxyUrl = proxyUrl.trim();

      const res = await fetch("/api/oauth/cloudflare-ai/bulk-import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(postBody),
      });
      const data = await readJsonResponse(res, "Failed to start signup job");
      if (!res.ok || data.error) throw new Error(data.error || "Failed to start signup job");

      setActiveJob(data.job || null);
      if (data.job?.jobId) {
        completedRefreshRef.current.delete(data.job.jobId);
        if (typeof window !== "undefined") localStorage.setItem(STORAGE_KEY, data.job.jobId);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setImporting(false);
    }
  };

  const handleCancel = async () => {
    if (!activeJob?.jobId) return;
    try {
      const res = await fetch(`/api/oauth/cloudflare-ai/bulk-import/${activeJob.jobId}/cancel`, { method: "POST" });
      const data = await readJsonResponse(res, "Failed to cancel job");
      if (!res.ok || data.error) throw new Error(data.error || "Cancel failed");
      if (data.job) setActiveJob(data.job);
    } catch (err) {
      setError(err.message);
    }
  };

  const handleDone = () => {
    resetState();
    onSuccess?.();
  };

  return (
    <Modal
      isOpen={isOpen}
      title="Disposable Email Signup (bluk-cf flow)"
      onClose={onClose}
      size="full"
      className="max-w-[min(96vw,1320px)]"
    >
      <div className="flex flex-col gap-4">
        {!activeJob && (
          <>
            <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 dark:border-blue-800 dark:bg-blue-900/20">
              <p className="text-sm text-blue-800 dark:text-blue-200">
                Generates disposable emails, signs up new Cloudflare accounts, creates Workers AI
                API tokens, and saves them. <strong>mail.tm</strong> (free, no API key) works
                out-of-box with rate limits. <strong>CF Email Routing</strong> uses your own domain
                via a Worker. <strong>Custom API</strong> requires{" "}
                <code className="rounded bg-blue-100 px-1 dark:bg-blue-800">POST /api/new_address</code>{" "}
                returning <code className="rounded bg-blue-100 px-1 dark:bg-blue-800">{"{address, jwt}"}</code>.
              </p>
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium">Mail Provider</label>
              <div className="flex items-center gap-1 rounded-lg border border-border bg-surface p-1">
                {[
                  { id: "mailtm", label: "mail.tm (free)" },
                  { id: "cf-email", label: "CF Email Routing" },
                  { id: "custom", label: "Custom API" },
                ].map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setMailProvider(opt.id)}
                    className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                      mailProvider === opt.id
                        ? "bg-primary text-white"
                        : "text-text-muted hover:text-text-main hover:bg-background"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {mailProvider === "cf-email" ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <Input
                  label="Worker URL"
                  required
                  value={workerUrl}
                  onChange={(e) => setWorkerUrl(e.target.value)}
                  placeholder="https://email-inbox.username.workers.dev"
                />
                <Input
                  label="Domain"
                  required
                  value={mailDomains}
                  onChange={(e) => setMailDomains(e.target.value)}
                  placeholder="yourdomain.com"
                />
              </div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2">
                <Input
                  label="Mail API"
                  required
                  value={mailApi}
                  onChange={(e) => setMailApi(e.target.value)}
                  placeholder={mailProvider === "mailtm" ? "mail.tm" : "https://your-api.com/api/new_address"}
                />
                <Input
                  label="Mail Domains"
                  required
                  value={mailDomains}
                  onChange={(e) => setMailDomains(e.target.value)}
                  placeholder="web-library.net (pisah pake koma)"
                />
              </div>
            )}

            <div className="grid gap-4 sm:grid-cols-3">
              <Input
                label="Number of Accounts"
                type="number"
                min="1"
                max="50"
                value={accountCount}
                onChange={(e) => setAccountCount(e.target.value)}
              />
              <div>
                <label className="mb-2 block text-sm font-medium">Concurrent Workers</label>
                <Input
                  type="number"
                  min="1"
                  max="8"
                  value={concurrency}
                  onChange={(e) => setConcurrency(e.target.value)}
                  placeholder="2"
                />
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium">Browser Engine</label>
                <select
                  value={engine}
                  onChange={(e) => setEngine(e.target.value)}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                >
                  {ENGINE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium">Browser Mode</label>
              <label className="flex cursor-pointer items-center gap-2 text-sm text-text-main">
                <input
                  type="checkbox"
                  checked={headless}
                  onChange={(e) => setHeadless(e.target.checked)}
                  className="h-4 w-4 rounded border-border"
                />
                Run headless (no visible browser window)
              </label>
              <p className="mt-1 text-xs text-text-muted">
                Headless is faster. Turn off if Cloudflare Turnstile requires manual interaction.
              </p>
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium">Custom Proxy URL (optional)</label>
              <Input
                value={proxyUrl}
                onChange={(e) => setProxyUrl(e.target.value)}
                placeholder="http://user:pass@host:port"
              />
              <p className="mt-1 text-xs text-text-muted">
                Route browser traffic through a proxy. Recommended for avoiding rate limits.
              </p>
            </div>
          </>
        )}

        {activeJob && (
          <div className="space-y-4">
            <div className="flex flex-col gap-3 rounded-xl border border-border p-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h3 className="font-semibold">Cloudflare Disposable Email Signup Job</h3>
                <p className="text-xs text-text-muted">
                  Job ID: <span className="font-mono">{activeJob.jobId}</span>
                </p>
                <p className="text-xs text-text-muted">
                  Status: <span className="font-medium">{activeJob.status}</span> | Workers: {activeJob.concurrency}
                </p>
              </div>
              <div className="flex gap-2">
                {runningJob && (
                  <Button size="sm" variant="secondary" onClick={handleCancel}>
                    Cancel Job
                  </Button>
                )}
                {finishedJob && (
                  <Button size="sm" onClick={handleDone}>
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
                Some accounts need manual assist. Open the worker session to complete signup or
                Turnstile challenge in the browser.
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
                        alt="Live worker preview"
                        className="h-[340px] w-full object-contain transition-opacity duration-150"
                        loading="eager"
                        decoding="async"
                      />
                    ) : (
                      <div className="flex h-[340px] flex-col items-center justify-center gap-3 px-6 text-center text-slate-200">
                        <span className="material-symbols-outlined text-5xl text-primary/80">browser_updated</span>
                        <div>
                          <p className="text-base font-medium">Preview will appear when a worker opens the browser</p>
                          <p className="mt-1 text-sm text-slate-400">The job keeps running even when no screenshot is available.</p>
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
                          {account.currentStep && (
                            <div className="mt-3 rounded-lg border border-border/70 bg-sidebar/70 px-3 py-2">
                              <p className="text-[11px] uppercase tracking-wide text-text-muted">Current Step</p>
                              <p className="mt-1 text-sm font-medium capitalize">{formatStepLabel(account.currentStep)}</p>
                            </div>
                          )}
                          {account.error && (
                            <p className="mt-3 text-xs text-red-500">{account.error}</p>
                          )}
                          {account.manualSessionAvailable && account.workerId && (
                            <div className="mt-3">
                              <Button
                                size="sm"
                                variant="warning"
                                onClick={async () => {
                                  try {
                                    await fetch(`/api/oauth/cloudflare-ai/bulk-import/${activeJob.jobId}/manual/${account.workerId}`, { method: "POST" });
                                  } catch {}
                                }}
                              >
                                Open Manual Session
                              </Button>
                            </div>
                          )}
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
                            {entry.workerId ? `Worker ${entry.workerId}` : ""} | {formatStepLabel(entry.step)}
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
            <Button onClick={handleStart} fullWidth disabled={importing || (mailProvider === "cf-email" ? !workerUrl.trim() : !mailApi.trim()) || !mailDomains.trim()}>
              {importing ? "Starting..." : "Start Signup Job"}
            </Button>
          )}
          {activeJob && !finishedJob && (
            <Button onClick={handleCancel} fullWidth variant="secondary" disabled={!runningJob}>
              {runningJob ? "Cancel Running Job" : "Job Stopped"}
            </Button>
          )}
          {finishedJob && (
            <Button onClick={handleDone} fullWidth>
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
