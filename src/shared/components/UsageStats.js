"use client";

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { FREE_PROVIDERS, AI_PROVIDERS } from "@/shared/constants/providers";

// Keep providers without serviceKinds (default LLM) or with "llm" in serviceKinds
function isLLMProvider(id) {
  const p = AI_PROVIDERS[id];
  if (!p?.serviceKinds) return true;
  return p.serviceKinds.includes("llm");
}
import Badge from "./Badge";
import Card from "./Card";
import OverviewCards from "@/app/(dashboard)/dashboard/usage/components/OverviewCards";
import UsageTable, { fmt, fmtTime } from "@/app/(dashboard)/dashboard/usage/components/UsageTable";
import ProviderTopology from "@/app/(dashboard)/dashboard/usage/components/ProviderTopology";
import UsageChart from "@/app/(dashboard)/dashboard/usage/components/UsageChart";

// Skeleton placeholders sized to match the final content so the layout does
// not shift (CLS) when data arrives. Keep dimensions in sync with the real
// components they replace.
const overviewSkeleton = (
  <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-4 sm:gap-4">
    {Array.from({ length: 4 }).map((_, i) => (
      <div key={i} className="h-24 w-full animate-pulse rounded-lg border border-border bg-bg-subtle/50" aria-hidden="true" />
    ))}
  </div>
);

const topologySkeleton = (
  <div className="grid min-w-0 grid-cols-1 gap-2 lg:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)]">
    <div className="h-[320px] w-full animate-pulse rounded-lg border border-border bg-bg-subtle/50 sm:h-[480px]" aria-hidden="true" />
    <div className="h-[320px] w-full animate-pulse rounded-lg border border-border bg-bg-subtle/50 sm:h-[480px]" aria-hidden="true" />
  </div>
);

const chartSkeleton = (
  <div className="h-[220px] w-full animate-pulse rounded-lg border border-border bg-bg-subtle/50" aria-hidden="true" />
);

const tableSkeleton = (
  <div className="h-64 w-full animate-pulse rounded-lg border border-border bg-bg-subtle/50" aria-hidden="true" />
);

function timeAgo(timestamp) {
  const diff = Math.floor((Date.now() - new Date(timestamp)) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

// Auto-update time display every second without re-rendering parent
function TimeAgo({ timestamp }) {
  const [, setTick] = useState(0);
  
  useEffect(() => {
    const timer = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(timer);
  }, []);
  
  return <>{timeAgo(timestamp)}</>;
}

const EMPTY_REQUESTS = [];

function RecentRequests({ requests = EMPTY_REQUESTS }) {
  return (
    <Card className="flex min-w-0 flex-col overflow-hidden" padding="sm" style={{ height: 480 }}>
      {/* Header */}
      <div className="px-1 py-2 border-b border-border shrink-0">
        <span className="text-xs font-semibold text-text-muted uppercase tracking-wide">Recent Requests</span>
      </div>

      {!requests.length ? (
        <div className="flex-1 flex items-center justify-center text-text-muted text-sm">No requests yet.</div>
      ) : (
        <div className="flex-1 overflow-y-auto">
          <table className="w-full min-w-[300px] border-collapse text-xs">
            <thead className="sticky top-0 bg-bg z-10">
              <tr className="border-b border-border">
                <th className="py-1.5 text-left font-semibold text-text-muted w-2"><span className="sr-only">Status</span></th>
                <th className="py-1.5 text-left font-semibold text-text-muted">Model</th>
                <th className="py-1.5 text-right font-semibold text-text-muted whitespace-nowrap">In / Out</th>
                <th className="py-1.5 text-right font-semibold text-text-muted">When</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {requests.map((r, i) => {
                const ok = !r.status || r.status === "ok" || r.status === "success";
                return (
                  <tr key={`${r.timestamp}-${r.model}-${i}`} className="hover:bg-bg-subtle transition-colors">
                    <td className="py-1.5">
                      <span className={`block w-1.5 h-1.5 rounded-full ${ok ? "bg-success" : "bg-error"}`} aria-label={ok ? "Success" : "Error"} />
                    </td>
                    <td className="py-1.5 font-mono truncate max-w-[120px]" title={r.model}>{r.model}</td>
                    <td className="py-1.5 text-right whitespace-nowrap">
                      <span className="text-primary">{fmt(r.promptTokens)}↑</span>
                      {" "}
                      <span className="text-success">{fmt(r.completionTokens)}↓</span>
                    </td>
                    <td className="py-1.5 text-right text-text-muted whitespace-nowrap"><TimeAgo timestamp={r.timestamp} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function sortData(dataMap, pendingMap = {}, sortBy, sortOrder) {
  return Object.entries(dataMap || {})
    .map(([key, data]) => {
      const totalTokens = (data.promptTokens || 0) + (data.completionTokens || 0);
      const totalCost = data.cost || 0;
      const inputCost = totalTokens > 0 ? (data.promptTokens || 0) * (totalCost / totalTokens) : 0;
      const outputCost = totalTokens > 0 ? (data.completionTokens || 0) * (totalCost / totalTokens) : 0;
      return { ...data, key, totalTokens, totalCost, inputCost, outputCost, pending: pendingMap[key] || 0 };
    })
    .sort((a, b) => {
      let valA = a[sortBy];
      let valB = b[sortBy];
      if (typeof valA === "string") valA = valA.toLowerCase();
      if (typeof valB === "string") valB = valB.toLowerCase();
      if (valA < valB) return sortOrder === "asc" ? -1 : 1;
      if (valA > valB) return sortOrder === "asc" ? 1 : -1;
      return 0;
    });
}

function getGroupKey(item, keyField) {
  switch (keyField) {
    case "rawModel": return item.rawModel || "Unknown Model";
    case "accountName": return item.accountName || `Account ${item.connectionId?.slice(0, 8)}...` || "Unknown Account";
    case "keyName": return item.keyName || "Unknown Key";
    case "endpoint": return item.endpoint || "Unknown Endpoint";
    default: return item[keyField] || "Unknown";
  }
}

function groupDataByKey(data, keyField) {
  if (!Array.isArray(data)) return [];
  const groups = {};
  data.forEach((item) => {
    const gk = getGroupKey(item, keyField);
    if (!groups[gk]) {
      groups[gk] = {
        groupKey: gk,
        summary: { requests: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0, cost: 0, inputCost: 0, outputCost: 0, lastUsed: null, pending: 0 },
        items: [],
      };
    }
    const s = groups[gk].summary;
    s.requests += item.requests || 0;
    s.promptTokens += item.promptTokens || 0;
    s.completionTokens += item.completionTokens || 0;
    s.totalTokens += item.totalTokens || 0;
    s.cost += item.cost || 0;
    s.inputCost += item.inputCost || 0;
    s.outputCost += item.outputCost || 0;
    s.pending += item.pending || 0;
    if (item.lastUsed && (!s.lastUsed || new Date(item.lastUsed) > new Date(s.lastUsed))) {
      s.lastUsed = item.lastUsed;
    }
    groups[gk].items.push(item);
  });
  return Object.values(groups);
}

const MODEL_COLUMNS = [
  { field: "rawModel", label: "Model" },
  { field: "provider", label: "Provider" },
  { field: "requests", label: "Requests", align: "right" },
  { field: "lastUsed", label: "Last Used", align: "right" },
];

const ACCOUNT_COLUMNS = [
  { field: "rawModel", label: "Model" },
  { field: "provider", label: "Provider" },
  { field: "accountName", label: "Account" },
  { field: "requests", label: "Requests", align: "right" },
  { field: "lastUsed", label: "Last Used", align: "right" },
];

const API_KEY_COLUMNS = [
  { field: "keyName", label: "API Key Name" },
  { field: "rawModel", label: "Model" },
  { field: "provider", label: "Provider" },
  { field: "requests", label: "Requests", align: "right" },
  { field: "lastUsed", label: "Last Used", align: "right" },
];

const ENDPOINT_COLUMNS = [
  { field: "endpoint", label: "Endpoint" },
  { field: "rawModel", label: "Model" },
  { field: "provider", label: "Provider" },
  { field: "requests", label: "Requests", align: "right" },
  { field: "lastUsed", label: "Last Used", align: "right" },
];

const TABLE_OPTIONS = [
  { value: "model", label: "Usage by Model" },
  { value: "account", label: "Usage by Account" },
  { value: "apiKey", label: "Usage by API Key" },
  { value: "endpoint", label: "Usage by Endpoint" },
];

const PERIODS = [
  { value: "today", label: "Today" },
  { value: "24h", label: "24h" },
  { value: "7d", label: "7D" },
  { value: "30d", label: "30D" },
  { value: "60d", label: "60D" },
];

function PeriodSelector({ period, setPeriod, fetching }) {
  return (
        <div className="flex w-full items-center gap-2 sm:w-auto sm:self-end">
          <div className="grid flex-1 grid-cols-5 items-center gap-1 rounded-lg border border-border bg-bg-subtle p-1 sm:flex sm:flex-none">
            {PERIODS.map((p) => (
              <button type="button"
                key={p.value}
                onClick={() => setPeriod(p.value)}
                disabled={fetching}
                className={`rounded-md px-3 py-1 text-sm font-medium transition-colors ${period === p.value ? "bg-primary text-white shadow-sm" : "text-text-muted hover:bg-bg-hover hover:text-text"}`}
              >
                {p.label}
              </button>
            ))}
          </div>
          {fetching && (
            <span className="material-symbols-outlined text-[16px] text-text-muted animate-spin">progress_activity</span>
          )}
        </div>
  );
}


export default function UsageStats({ period: periodProp, setPeriod: setPeriodProp, hidePeriodSelector = false } = {}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const sortBy = searchParams.get("sortBy") || "rawModel";
  const sortOrder = searchParams.get("sortOrder") || "asc";
  const [stats, setStats] = useState(null);
  const [loadState, setLoadState] = useState({ loading: true, fetching: false });
  const loading = loadState.loading;
  const fetching = loadState.fetching;
  const [tableView, setTableView] = useState("model");
  const [viewMode, setViewMode] = useState("costs");
  const [providers, setProviders] = useState([]);
  const [periodLocal, setPeriodLocal] = useState("today");
  const isInitialLoad = useRef(true);
  const hasLoadedStats = useRef(false);
  const period = periodProp ?? periodLocal;
  const setPeriod = setPeriodProp ?? setPeriodLocal;
  // Fetch connected providers once, deduplicate by provider type
  // Always include noAuth free providers (e.g. opencode) regardless of connections
  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      fetch("/api/providers", { signal: controller.signal }).then((r) => r.ok ? r.json() : null),
      fetch("/api/provider-nodes", { signal: controller.signal }).then((r) => r.ok ? r.json() : null),
    ])
      .then(([d, nodesData]) => {
        if (controller.signal.aborted) return;
        // Build node name lookup for custom providers
        const nodeNameMap = {};
        for (const node of (nodesData?.nodes || [])) {
          nodeNameMap[node.id] = node.name;
        }
        const seen = new Set();
        const unique = (d?.connections || []).reduce((acc, c) => {
          if (c.isActive === false || !isLLMProvider(c.provider) || seen.has(c.provider)) return acc;
          seen.add(c.provider);
          acc.push({ ...c, nodeName: nodeNameMap[c.provider] || null });
          return acc;
        }, []);
        const noAuthProviders = Object.values(FREE_PROVIDERS).reduce((acc, p) => {
          if (p.noAuth && !seen.has(p.id) && isLLMProvider(p.id)) acc.push({ provider: p.id, name: p.name });
          return acc;
        }, []);
        setProviders([...unique, ...noAuthProviders]);
      })
      .catch(() => {});
    return () => controller.abort();
  }, []);
  // Fetch filtered stats via REST when period changes
  useEffect(() => {
    // First load: show full spinner; subsequent: show subtle fetching indicator
    if (isInitialLoad.current) {
      isInitialLoad.current = false;
      setLoadState({ loading: true, fetching: false });
    } else {
      setLoadState({ loading: false, fetching: true });
    }

    const controller = new AbortController();
    fetch(`/api/usage/stats?period=${period}`, { signal: controller.signal })
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (controller.signal.aborted) return;
        if (data) {
          hasLoadedStats.current = true;
          setStats((prev) => ({ ...prev, ...data }));
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!controller.signal.aborted) setLoadState({ loading: false, fetching: false });
      });
    return () => controller.abort();
  }, [period]);
  // SSE connection - real-time updates for activeRequests + recentRequests only
  useEffect(() => {
    const es = new EventSource("/api/usage/stream");

    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        // Always merge only real-time fields, never overwrite full stats from REST
        setStats((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            activeRequests: data.activeRequests,
            recentRequests: data.recentRequests,
            errorProvider: data.errorProvider,
            pending: data.pending,
          };
        });
        if (hasLoadedStats.current) setLoadState(prev => ({ ...prev, loading: false }));
      } catch (err) {
        console.error("[SSE CLIENT] parse error:", err);
      }
    };

    es.onerror = () => setLoadState(prev => ({ ...prev, loading: false }));

    return () => es.close();
  }, []);

  const toggleSort = useCallback((tableType, field) => {
    const params = new URLSearchParams(searchParams.toString());
    if (params.get("sortBy") === field) {
      params.set("sortOrder", params.get("sortOrder") === "asc" ? "desc" : "asc");
    } else {
      params.set("sortBy", field);
      params.set("sortOrder", "asc");
    }
    router.replace(`?${params.toString()}`, { scroll: false });
  }, [searchParams, router]);

  // Compute active table data
  const activeTableConfig = useMemo(() => {
    if (!stats) return null;
    switch (tableView) {
      case "model": {
        const pendingMap = stats.pending?.byModel || {};
        return {
          columns: MODEL_COLUMNS,
          groupedData: groupDataByKey(sortData(stats.byModel, pendingMap, sortBy, sortOrder), "rawModel"),
          storageKey: "usage-stats:expanded-models",
          emptyMessage: "No usage recorded yet.",
          renderSummaryCells: (group) => (
            <>
              <td className="px-6 py-3 text-text-muted">—</td>
              <td className="px-6 py-3 text-right">{fmt(group.summary.requests)}</td>
              <td className="px-6 py-3 text-right text-text-muted whitespace-nowrap">{fmtTime(group.summary.lastUsed)}</td>
            </>
          ),
          renderDetailCells: (item) => (
            <>
              <td className={`px-6 py-3 font-medium transition-colors ${item.pending > 0 ? "text-primary" : ""}`}>{item.rawModel}</td>
              <td className="px-6 py-3"><Badge variant={item.pending > 0 ? "primary" : "neutral"} size="sm">{item.provider}</Badge></td>
              <td className="px-6 py-3 text-right">{fmt(item.requests)}</td>
              <td className="px-6 py-3 text-right text-text-muted whitespace-nowrap">{fmtTime(item.lastUsed)}</td>
            </>
          ),
        };
      }
      case "account": {
        const pendingMap = {};
        if (stats?.pending?.byAccount) {
          Object.entries(stats.byAccount || {}).forEach(([accountKey, data]) => {
            const connPending = stats.pending.byAccount[data.connectionId];
            if (connPending) {
              const modelKey = data.provider ? `${data.rawModel} (${data.provider})` : data.rawModel;
              pendingMap[accountKey] = connPending[modelKey] || 0;
            }
          });
        }
        return {
          columns: ACCOUNT_COLUMNS,
          groupedData: groupDataByKey(sortData(stats.byAccount, pendingMap, sortBy, sortOrder), "accountName"),
          storageKey: "usage-stats:expanded-accounts",
          emptyMessage: "No account-specific usage recorded yet.",
          renderSummaryCells: (group) => (
            <>
              <td className="px-6 py-3 text-text-muted">—</td>
              <td className="px-6 py-3 text-text-muted">—</td>
              <td className="px-6 py-3 text-right">{fmt(group.summary.requests)}</td>
              <td className="px-6 py-3 text-right text-text-muted whitespace-nowrap">{fmtTime(group.summary.lastUsed)}</td>
            </>
          ),
          renderDetailCells: (item) => (
            <>
              <td className={`px-6 py-3 font-medium transition-colors ${item.pending > 0 ? "text-primary" : ""}`}>{item.accountName || `Account ${item.connectionId?.slice(0, 8)}...`}</td>
              <td className={`px-6 py-3 font-medium transition-colors ${item.pending > 0 ? "text-primary" : ""}`}>{item.rawModel}</td>
              <td className="px-6 py-3"><Badge variant={item.pending > 0 ? "primary" : "neutral"} size="sm">{item.provider}</Badge></td>
              <td className="px-6 py-3 text-right">{fmt(item.requests)}</td>
              <td className="px-6 py-3 text-right text-text-muted whitespace-nowrap">{fmtTime(item.lastUsed)}</td>
            </>
          ),
        };
      }
      case "apiKey": {
        return {
          columns: API_KEY_COLUMNS,
          groupedData: groupDataByKey(sortData(stats.byApiKey, {}, sortBy, sortOrder), "keyName"),
          storageKey: "usage-stats:expanded-apikeys",
          emptyMessage: "No API key usage recorded yet.",
          renderSummaryCells: (group) => (
            <>
              <td className="px-6 py-3 text-text-muted">—</td>
              <td className="px-6 py-3 text-text-muted">—</td>
              <td className="px-6 py-3 text-right">{fmt(group.summary.requests)}</td>
              <td className="px-6 py-3 text-right text-text-muted whitespace-nowrap">{fmtTime(group.summary.lastUsed)}</td>
            </>
          ),
          renderDetailCells: (item) => (
            <>
              <td className="px-6 py-3 font-medium">{item.keyName}</td>
              <td className="px-6 py-3">{item.rawModel}</td>
              <td className="px-6 py-3"><Badge variant="neutral" size="sm">{item.provider}</Badge></td>
              <td className="px-6 py-3 text-right">{fmt(item.requests)}</td>
              <td className="px-6 py-3 text-right text-text-muted whitespace-nowrap">{fmtTime(item.lastUsed)}</td>
            </>
          ),
        };
      }
      case "endpoint":
      default: {
        return {
          columns: ENDPOINT_COLUMNS,
          groupedData: groupDataByKey(sortData(stats.byEndpoint, {}, sortBy, sortOrder), "endpoint"),
          storageKey: "usage-stats:expanded-endpoints",
          emptyMessage: "No endpoint usage recorded yet.",
          renderSummaryCells: (group) => (
            <>
              <td className="px-6 py-3 text-text-muted">—</td>
              <td className="px-6 py-3 text-text-muted">—</td>
              <td className="px-6 py-3 text-right">{fmt(group.summary.requests)}</td>
              <td className="px-6 py-3 text-right text-text-muted whitespace-nowrap">{fmtTime(group.summary.lastUsed)}</td>
            </>
          ),
          renderDetailCells: (item) => (
            <>
              <td className="px-6 py-3 font-medium font-mono text-sm">{item.endpoint}</td>
              <td className="px-6 py-3">{item.rawModel}</td>
              <td className="px-6 py-3"><Badge variant="neutral" size="sm">{item.provider}</Badge></td>
              <td className="px-6 py-3 text-right">{fmt(item.requests)}</td>
              <td className="px-6 py-3 text-right text-text-muted whitespace-nowrap">{fmtTime(item.lastUsed)}</td>
            </>
          ),
        };
      }
    }
  }, [stats, tableView, sortBy, sortOrder]);

  if (!stats && !loading) return <div className="text-text-muted">Failed to load usage statistics.</div>;

  return (
    <div className="flex min-w-0 flex-col gap-6">
      {/* Period selector (hidden when controlled by parent) */}
      {!hidePeriodSelector && <PeriodSelector period={period} setPeriod={setPeriod} fetching={fetching} />}

      {/* Overview cards */}
      {loading ? overviewSkeleton : <OverviewCards stats={stats} />}

      {/* Provider topology + Recent Requests */}
      {loading ? topologySkeleton : (
        <div className="grid min-w-0 grid-cols-1 items-stretch gap-2 lg:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)]">
          <ProviderTopology
            providers={providers}
            activeRequests={stats.activeRequests || []}
            lastProvider={stats.recentRequests?.[0]?.provider || ""}
            errorProvider={stats.errorProvider || ""}
          />
          <RecentRequests requests={stats.recentRequests || []} />
        </div>
      )}

      {/* Token / Cost chart - sync period */}
      {loading ? chartSkeleton : <UsageChart period={period} />}

      {/* Table with dropdown selector */}
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <select
            value={tableView}
            onChange={(e) => setTableView(e.target.value)}
            className="w-full rounded-lg border border-border bg-surface px-3 py-1.5 text-sm font-medium text-text-main focus:outline-none focus:ring-2 focus:ring-primary/50 sm:w-auto"
            style={{ colorScheme: 'auto' }}
          >
            {TABLE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
          <div className="grid grid-cols-2 items-center gap-1 rounded-lg border border-border bg-bg-subtle p-1 sm:flex">
            <button type="button"
              onClick={() => setViewMode("costs")}
              className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${viewMode === "costs" ? "bg-primary text-white shadow-sm" : "text-text-muted hover:text-text hover:bg-bg-hover"}`}
            >
              Costs
            </button>
            <button type="button"
              onClick={() => setViewMode("tokens")}
              className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${viewMode === "tokens" ? "bg-primary text-white shadow-sm" : "text-text-muted hover:text-text hover:bg-bg-hover"}`}
            >
              Tokens
            </button>
          </div>
        </div>
        {loading ? tableSkeleton : activeTableConfig && (
          <UsageTable
            title=""
            columns={activeTableConfig.columns}
            groupedData={activeTableConfig.groupedData}
            tableType={tableView}
            sortBy={sortBy}
            sortOrder={sortOrder}
            onToggleSort={toggleSort}
            viewMode={viewMode}
            storageKey={activeTableConfig.storageKey}
            renderSummaryCells={activeTableConfig.renderSummaryCells}
            renderDetailCells={activeTableConfig.renderDetailCells}
            emptyMessage={activeTableConfig.emptyMessage}
          />
        )}
      </div>
    </div>
  );
}
