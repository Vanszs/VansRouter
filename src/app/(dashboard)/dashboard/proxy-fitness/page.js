"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge, Button, Card, CardSkeleton, Input, ConfirmModal } from "@/shared/components";
import { useNotificationStore } from "@/store/notificationStore";

function recordsOf(fitness, pools, now = Date.now()) {
  const names = new Map((pools || []).map((p) => [p.id, p]));
  return Object.entries(fitness || {}).flatMap(([poolId, scopes]) => Object.entries(scopes || {}).flatMap(([scope, info]) => {
    const until = Number(info?.until || 0);
    if (until <= now) return [];
    const sep = String(scope).indexOf("::");
    const provider = sep < 0 ? String(scope) : String(scope).slice(0, sep);
    const model = sep < 0 ? "" : String(scope).slice(sep + 2);
    const pool = names.get(poolId);
    return [{ poolId, scope, provider, model: model === "*" ? "all models" : model, until, reason: info?.reason || "blocked", poolName: pool?.name || poolId.slice(0, 8), proxyUrl: pool?.proxyUrl || "" }];
  }));
}

export default function ProxyFitnessPage() {
  const [pools, setPools] = useState([]);
  const [fitness, setFitness] = useState({});
  const [loading, setLoading] = useState(true);
  const [provider, setProvider] = useState("all");
  const [search, setSearch] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const notify = useNotificationStore();
  const fetchAll = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const [p, f] = await Promise.all([fetch("/api/proxy-pools?includeUsage=true", { cache: "no-store" }), fetch("/api/proxy-pools/fitness", { cache: "no-store" })]);
      if (!p.ok || !f.ok) throw new Error("proxy fitness unavailable");
      setPools((await p.json()).proxyPools || []);
      setFitness((await f.json()).pools || {});
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchAll();
  }, [fetchAll]);
  const records = useMemo(() => recordsOf(fitness, pools).filter((r) => (provider === "all" || r.provider === provider) && `${r.proxyUrl} ${r.poolName} ${r.model}`.toLowerCase().includes(search.toLowerCase())), [fitness, pools, provider, search]);
  const providers = useMemo(() => [...new Set(recordsOf(fitness, pools).map((r) => r.provider))].sort(), [fitness, pools]);
  const clearAll = async () => {
    const res = await fetch("/api/proxy-pools/fitness/clear-all", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(provider === "all" ? {} : { provider }) }).catch(() => null);
    setConfirm(false);
    if (res?.ok) notify.success(provider === "all" ? "Proxy fitness cleared" : `Proxy fitness cleared for ${provider}`);
    else notify.error("Failed to clear proxy fitness");
    fetchAll();
  };
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-1 sm:gap-6 sm:px-0">
      {loading ? (
        <CardSkeleton />
      ) : loadError ? (
        <Card className="p-6 text-center">
          <p className="font-medium text-text-main">Failed to load proxy fitness</p>
          <p className="mt-1 text-sm text-text-muted">The dashboard APIs did not respond. Nothing is shown as healthy.</p>
          <Button className="mt-4" variant="secondary" size="sm" onClick={fetchAll} icon="refresh">Retry</Button>
        </Card>
      ) : (
        <>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-semibold sm:text-2xl">Proxy Fitness</h1>
                <Badge variant={records.length ? "error" : "default"}>
                  {records.length} active blocks
                </Badge>
              </div>
              <p className="text-sm text-text-muted mt-1">
                Smart rotation skips pools marked unfit for a provider/model.
              </p>
            </div>
            <div className="flex gap-2 sm:items-center">
              <Button variant="secondary" size="sm" onClick={fetchAll} icon="refresh">
                Refresh
              </Button>
              {records.length > 0 && (
                <Button variant="danger" size="sm" onClick={() => setConfirm(true)} icon="clear_all">
                  {provider === "all" ? "Clear All" : `Clear ${provider}`}
                </Button>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap items-center gap-3">
              <select
                value={provider}
                onChange={(e) => setProvider(e.target.value)}
                className="h-[42px] px-3.5 rounded-[10px] text-sm text-text-main bg-surface-2 border border-transparent focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500/40 transition-all min-w-[160px] cursor-pointer"
              >
                <option value="all">All providers</option>
                {providers.map((p) => (
                  <option key={p}>{p}</option>
                ))}
              </select>
              <div className="w-full sm:w-72">
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search IP / proxy / pool..."
                  icon="search"
                  className="w-full"
                />
              </div>
            </div>
          </div>

          <Card className="overflow-x-auto p-0">
            <table className="w-full min-w-[650px] text-sm">
              <thead>
                <tr className="border-b border-border-subtle text-left text-xs uppercase text-text-muted">
                  <th className="px-5 py-3">Provider</th>
                  <th className="px-5 py-3">Model</th>
                  <th className="px-5 py-3">Pool</th>
                  <th className="px-5 py-3">Reason</th>
                  <th className="px-5 py-3">Until</th>
                  <th className="px-5 py-3 text-right" />
                </tr>
              </thead>
              <tbody>
                {records.length ? (
                  records.map((r) => (
                    <tr
                      key={`${r.poolId}:${r.scope}`}
                      className="border-b border-border-subtle hover:bg-surface-2/40 transition-colors"
                    >
                      <td className="px-5 py-3.5 font-medium">{r.provider}</td>
                      <td className="px-5 py-3.5">
                        <code className="px-1.5 py-0.5 rounded bg-surface-3 text-xs font-mono">
                          {r.model}
                        </code>
                      </td>
                      <td className="px-5 py-3.5 text-text-muted">{r.poolName}</td>
                      <td className="px-5 py-3.5">
                        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium bg-red-500/10 text-red-500">
                          <span className="size-1.5 rounded-full bg-red-500" />
                          {r.reason}
                        </span>
                      </td>
                      <td className="px-5 py-3.5 text-text-muted">
                        {new Date(r.until).toLocaleString()}
                      </td>
                      <td className="px-5 py-3.5 text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={async () => {
                            const res = await fetch(`/api/proxy-pools/${r.poolId}/fitness/clear`, {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ scope: r.scope }),
                            }).catch(() => null);
                            if (res?.ok) notify.success("Block cleared");
                            else notify.error("Failed to clear block");
                            fetchAll();
                          }}
                        >
                          Clear
                        </Button>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={6} className="px-5 py-16 text-center text-text-muted">
                      <div className="flex flex-col items-center justify-center gap-2">
                        <span className="material-symbols-outlined text-[32px] text-text-muted/50">
                          verified_user
                        </span>
                        <p className="font-medium text-sm text-text-main">No active blocks</p>
                        <p className="text-xs text-text-muted">
                          All proxy pools are healthy and fit for routing.
                        </p>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </Card>
        </>
      )}
      <ConfirmModal
        isOpen={confirm}
        onClose={() => setConfirm(false)}
        onConfirm={clearAll}
        title={provider === "all" ? "Clear proxy fitness" : `Clear ${provider} fitness`}
        message={provider === "all" ? "Clear all active proxy fitness blocks?" : `Clear active blocks for ${provider}?`}
        confirmText={provider === "all" ? "Clear All" : "Clear"}
        cancelText="Cancel"
        variant="danger"
      />
    </div>
  );
}

