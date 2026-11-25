"use client";

import { useState, useEffect } from "react";
import Card from "@/shared/components/Card";
import Button from "@/shared/components/Button";
import Drawer from "@/shared/components/Drawer";
import Pagination from "@/shared/components/Pagination";
import { cn } from "@/shared/utils/cn";
import { AI_PROVIDERS, getProviderByAlias } from "@/shared/constants/providers";
import { getInputTokens, getOutputTokens, getCachedTokens, getCacheCreationTokens } from "./tokenDisplay";

let providerNameCache = null;
let providerNodesCache = null;

async function fetchProviderNames() {
  if (providerNameCache && providerNodesCache) {
    return { providerNameCache, providerNodesCache };
  }

  const nodesRes = await fetch("/api/provider-nodes");
  const nodesData = await nodesRes.json();
  const nodes = nodesData.nodes || [];
  providerNodesCache = {};

  for (const node of nodes) {
    providerNodesCache[node.id] = node.name;
  }

  providerNameCache = {
    ...AI_PROVIDERS,
    ...providerNodesCache
  };

  return { providerNameCache, providerNodesCache };
}

function getProviderName(providerId, cache) {
  if (!providerId) return providerId;
  if (!cache) return providerId;

  const cached = cache[providerId];

  if (typeof cached === 'string') {
    return cached;
  }

  if (cached?.name) {
    return cached.name;
  }

  const providerConfig = getProviderByAlias(providerId) || AI_PROVIDERS[providerId];
  return providerConfig?.name || providerId;
}

function CollapsibleSection({ title, children, defaultOpen = false, icon = null }) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div className="border border-black/5 dark:border-white/5 rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between p-3 bg-black/[0.02] dark:bg-white/[0.02] hover:bg-black/[0.04] dark:hover:bg-white/[0.04] transition-colors"
      >
        <div className="flex items-center gap-2">
          {icon && <span className="material-symbols-outlined text-[18px] text-text-muted">{icon}</span>}
          <span className="font-semibold text-sm text-text-main">{title}</span>
        </div>
        <span className={cn(
          "material-symbols-outlined text-[20px] text-text-muted transition-transform duration-200",
          isOpen ? "rotate-90" : ""
        )}>
          chevron_right
        </span>
      </button>

      {isOpen && (
        <div className="p-4 border-t border-black/5 dark:border-white/5">
          {children}
        </div>
      )}
    </div>
  );
}

function maskKey(fullKey) {
  if (!fullKey) return "";
  return fullKey.length > 8 ? `${fullKey.slice(0, 8)}...` : fullKey;
}

// truncateField (requestDetailsRepo.js) replaces an over-cap field with this marker.
function isTruncated(field) {
  return field && typeof field === "object" && field._truncated === true;
}

function TruncatedNotice({ marker }) {
  return (
    <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 font-mono text-xs text-amber-700 dark:text-amber-300">
      <div className="flex items-center gap-1.5 font-sans font-semibold">
        <span className="material-symbols-outlined text-[16px]">content_cut</span>
        Payload truncated
      </div>
      <div className="mt-1">
        Original size: {((marker._originalSize || 0) / 1024).toFixed(1)} KB
      </div>
      {marker._preview && (
        <pre className="mt-2 max-h-[120px] max-w-full overflow-auto whitespace-pre-wrap break-all opacity-80">
          {marker._preview}
        </pre>
      )}
    </div>
  );
}

function RequestFilters({ filterProvider, setFilterProvider, filterStart, setFilterStart, filterEnd, setFilterEnd, providers, cn, handleApplyFilters, handleClearFilters }) {
  return (
      <Card padding="md">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="flex min-w-0 flex-col gap-2">
            <label htmlFor="provider-filter" className="text-sm font-medium text-text-main">Provider</label>
            <select
              id="provider-filter"
              value={filterProvider}
              onChange={(e) => setFilterProvider(e.target.value)}
              className={cn("h-9 px-3 rounded-lg border border-black/10 dark:border-white/10 bg-surface text-sm text-text-main focus:outline-none focus:ring-2 focus:ring-primary/20 w-full min-w-0 cursor-pointer")}
              style={{ colorScheme: 'auto' }}
            >
              <option value="">All Providers</option>
              {providers.map((provider) => (
                <option key={provider.id} value={provider.id}>{provider.name}</option>
              ))}
            </select>
          </div>
          <div className="flex min-w-0 flex-col gap-2">
            <label htmlFor="start-date-filter" className="text-sm font-medium text-text-main">Start Date</label>
            <input id="start-date-filter" type="datetime-local" value={filterStart}
              onChange={(e) => setFilterStart(e.target.value)}
              className={cn("h-9 px-3 rounded-lg border border-black/10 dark:border-white/10 bg-surface w-full min-w-0 text-sm text-text-main focus:outline-none focus:ring-2 focus:ring-primary/20")}
            />
          </div>
          <div className="flex min-w-0 flex-col gap-2">
            <label htmlFor="end-date-filter" className="text-sm font-medium text-text-main">End Date</label>
            <input id="end-date-filter" type="datetime-local" value={filterEnd}
              onChange={(e) => setFilterEnd(e.target.value)}
              className={cn("h-9 px-3 rounded-lg border border-black/10 dark:border-white/10 bg-surface w-full min-w-0 text-sm text-text-main focus:outline-none focus:ring-2 focus:ring-primary/20")}
            />
          </div>
          <div className="flex min-w-0 flex-col gap-2 sm:col-span-2 lg:col-span-1">
            <span className="hidden text-sm font-medium text-text-main opacity-0 lg:block" aria-hidden="true">Actions</span>
            <div className="flex gap-2">
              <Button onClick={handleApplyFilters} className="flex-1">Search</Button>
              <Button variant="ghost" onClick={handleClearFilters}
                disabled={!filterProvider && !filterStart && !filterEnd}
                className="flex-1">Clear</Button>
            </div>
          </div>
        </div>
      </Card>
  );
}


function RequestRow({ detail, index, handleViewDetail, providerNameCache }) {
  return (
                  <tr
                    key={`${detail.id}-${index}`}
                    className="border-b border-black/5 dark:border-white/5 last:border-b-0 hover:bg-black/[0.02] dark:hover:bg-white/[0.02] transition-colors"
                  >
                    <td className="whitespace-nowrap p-4 text-sm text-text-main">
                      {new Date(detail.timestamp).toLocaleString()}
                    </td>
                    <td className="max-w-[260px] truncate p-4 font-mono text-sm text-text-main">
                      {detail.model}
                    </td>
                    <td className="max-w-[180px] truncate p-4 text-sm text-text-main">
                       <span className="font-medium">
                         {getProviderName(detail.provider, providerNameCache)}
                       </span>
                     </td>
                    <td className="p-4 text-sm text-text-main text-right font-mono">
                      {getInputTokens(detail.tokens).toLocaleString()}
                    </td>
                    <td className="p-4 text-sm text-text-main text-right font-mono">
                      {getCachedTokens(detail.tokens) > 0 ? getCachedTokens(detail.tokens).toLocaleString() : "—"}
                    </td>
                    <td className="p-4 text-sm text-text-main text-right font-mono">
                      {getCacheCreationTokens(detail.tokens) > 0 ? getCacheCreationTokens(detail.tokens).toLocaleString() : "—"}
                    </td>
                    <td className="p-4 text-sm text-text-main text-right font-mono">
                      {getOutputTokens(detail.tokens).toLocaleString()}
                    </td>
                    <td className="p-4 text-sm text-text-muted">
                      <div className="flex flex-col gap-0.5">
                        <div>TTFT: <span className="font-mono">{detail.latency?.ttft || 0}ms</span></div>
                        <div>Total: <span className="font-mono">{detail.latency?.total || 0}ms</span></div>
                      </div>
                    </td>
                    <td className="p-4 text-center">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleViewDetail(detail)}
                      >
                        Detail
                      </Button>
                    </td>
                  </tr>
  );
}


export default function RequestDetailsTab() {
  const [details, setDetails] = useState([]);
  const [totalItems, setTotalItems] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [loading, setLoading] = useState(false);
  const [selectedDetail, setSelectedDetail] = useState(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [providers, setProviders] = useState([]);
  const [providerNameCache, setProviderNameCache] = useState(null);
  // Filter input state (not applied until Search clicked)
  const [filterProvider, setFilterProvider] = useState("");
  const [filterStart, setFilterStart] = useState(() => {
    if (typeof window === "undefined") return "";
    const d = new Date();
    d.setDate(d.getDate() - 7);
    return d.toISOString().slice(0, 16);
  });
  const [filterEnd, setFilterEnd] = useState("");
  // Applied filter state (triggers fetch)
  const [appliedProvider, setAppliedProvider] = useState("");
  const [appliedStart, setAppliedStart] = useState(() => {
    if (typeof window === "undefined") return "";
    const d = new Date();
    d.setDate(d.getDate() - 7);
    return d.toISOString().slice(0, 16);
  });
  const [appliedEnd, setAppliedEnd] = useState("");
  // Guard: don't fetch until default filter is ready
  const [isFilterReady, setIsFilterReady] = useState(true);

  // Fetch providers once
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/usage/providers", { signal: controller.signal })
      .then(r => r.json())
      .then(async d => {
        if (controller.signal.aborted) return;
        setProviders(d.providers || []);
        const cache = await fetchProviderNames();
        if (!controller.signal.aborted) setProviderNameCache(cache.providerNameCache);
      })
      .catch(() => {});
    return () => controller.abort();
  }, []);

  // Fetch details — guarded by isFilterReady to prevent unfiltered initial request
  useEffect(() => {
    if (!isFilterReady) return;
    if (!appliedStart) return;

    const controller = new AbortController();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch with abort controller; setLoading(true) is intentional at the start of the request.
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (appliedProvider) params.append("provider", appliedProvider);
    params.append("startDate", appliedStart);
    if (appliedEnd) params.append("endDate", appliedEnd);

    fetch(`/api/usage/request-details?${params}`, { signal: controller.signal })
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then(data => {
        if (controller.signal.aborted) return;
        setDetails(Array.isArray(data.details) ? data.details : []);
        setTotalItems(data.pagination?.totalItems ?? 0);
        setTotalPages(data.pagination?.totalPages ?? 0);
      })
      .catch(err => {
        if (!controller.signal.aborted) console.error("request-details fetch failed:", err);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [isFilterReady, page, pageSize, appliedProvider, appliedStart, appliedEnd]);

  const handleApplyFilters = () => {
    setPage(1);
    setAppliedProvider(filterProvider);
    setAppliedStart(filterStart);
    setAppliedEnd(filterEnd);
  };

  const handleClearFilters = () => {
    const weekAgo = (() => { const d = new Date(); d.setDate(d.getDate() - 7); return d.toISOString().slice(0, 16); })();
    setFilterProvider(""); setFilterStart(weekAgo); setFilterEnd("");
    setPage(1);
    setAppliedProvider(""); setAppliedStart(weekAgo); setAppliedEnd("");
  };

  const handlePageChange = (newPage) => setPage(newPage);
  const handlePageSizeChange = (newSize) => { setPageSize(newSize); setPage(1); };
  const handleViewDetail = (detail) => {
    setSelectedDetail(detail);
    setIsDrawerOpen(true);
    // Fetch full detail (list strips heavy request/response bodies)
    fetch(`/api/usage/request-details/${encodeURIComponent(detail.id)}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data?.detail) setSelectedDetail(data.detail); })
      .catch(() => {});
  };

  const pagination = { page, pageSize, totalItems, totalPages, hasNext: page < totalPages, hasPrev: page > 1 };

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <RequestFilters filterProvider={filterProvider} setFilterProvider={setFilterProvider} filterStart={filterStart} setFilterStart={setFilterStart} filterEnd={filterEnd} setFilterEnd={setFilterEnd} providers={providers} cn={cn} handleApplyFilters={handleApplyFilters} handleClearFilters={handleClearFilters} />

      <Card padding="none">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[880px]">
            <thead>
              <tr className="border-b border-black/5 dark:border-white/5">
                <th className="text-left p-4 text-sm font-semibold text-text-main">Timestamp</th>
                <th className="text-left p-4 text-sm font-semibold text-text-main">Model</th>
                <th className="text-left p-4 text-sm font-semibold text-text-main">Provider</th>
                <th className="text-right p-4 text-sm font-semibold text-text-main">Input Tokens</th>
                <th className="text-right p-4 text-sm font-semibold text-text-main">Cached</th>
                <th className="text-right p-4 text-sm font-semibold text-text-main">Cache Write</th>
                <th className="text-right p-4 text-sm font-semibold text-text-main">Output Tokens</th>
                <th className="text-left p-4 text-sm font-semibold text-text-main">Latency</th>
                <th className="text-center p-4 text-sm font-semibold text-text-main">Action</th>
              </tr>
            </thead>
            <tbody>
              {loading || !isFilterReady ? (
                <tr>
                  <td colSpan="9" className="p-8 text-center text-text-muted">
                    <div className="flex items-center justify-center gap-2">
                      <span className="material-symbols-outlined animate-spin text-[20px]">progress_activity</span>
                      Loading...
                    </div>
                  </td>
                </tr>
              ) : details.length === 0 ? (
                <tr>
                  <td colSpan="9" className="p-8 text-center text-text-muted">
                    No request details found
                  </td>
                </tr>
              ) : (
                details.map((detail, index) => (
                  <RequestRow key={index} detail={detail} index={index} handleViewDetail={handleViewDetail} providerNameCache={providerNameCache} />
                ))
              )}
            </tbody>
          </table>
        </div>

        {!loading && details.length > 0 && (
          <div className="border-t border-black/5 dark:border-white/5">
            <Pagination
              currentPage={pagination.page}
              pageSize={pagination.pageSize}
              totalItems={pagination.totalItems}
              onPageChange={handlePageChange}
              onPageSizeChange={handlePageSizeChange}
            />
          </div>
        )}
      </Card>

      <Drawer
        isOpen={isDrawerOpen}
        onClose={() => setIsDrawerOpen(false)}
        title="Request Details"
        width="lg"
      >
        {selectedDetail && (
          <div className="space-y-6">
            <div className="grid min-w-0 grid-cols-1 gap-4 text-sm sm:grid-cols-2">
              <div>
                <span className="text-text-muted">ID:</span>{" "}
                <span className="break-all font-mono text-text-main">{selectedDetail.id}</span>
              </div>
              <div>
                <span className="text-text-muted">Timestamp:</span>{" "}
                <span className="text-text-main">{new Date(selectedDetail.timestamp).toLocaleString()}</span>
              </div>
              <div>
                 <span className="text-text-muted">Provider:</span>{" "}
                 <span className="text-text-main font-medium">{getProviderName(selectedDetail.provider, providerNameCache)}</span>
               </div>
              <div>
                <span className="text-text-muted">Model:</span>{" "}
                <span className="text-text-main font-mono">{selectedDetail.model}</span>
              </div>
              <div>
                <span className="text-text-muted">API Key Name:</span>{" "}
                <span className="text-text-main">
                  {selectedDetail.apiKeyName || "-"}
                </span>
              </div>
              <div>
                <span className="text-text-muted">API Key:</span>{" "}
                <span className="text-text-main font-mono">
                  {selectedDetail.apiKeyName && selectedDetail.apiKey ? maskKey(selectedDetail.apiKey) : "-"}
                </span>
              </div>
              <div>
                <span className="text-text-muted">Status:</span>{" "}
                <span className={cn(
                  "font-medium",
                  selectedDetail.status === "success" ? "text-green-600" : "text-red-600"
                )}>
                  {selectedDetail.status}
                </span>
              </div>
              <div>
                <span className="text-text-muted">Latency:</span>{" "}
                <span className="text-text-main font-mono">
                  TTFT {selectedDetail.latency?.ttft || 0}ms / Total {selectedDetail.latency?.total || 0}ms
                </span>
              </div>
              <div>
                <span className="text-text-muted">Input Tokens:</span>{" "}
                <span className="text-text-main font-mono">
                  {getInputTokens(selectedDetail.tokens).toLocaleString()}
                </span>
              </div>
              <div>
                <span className="text-text-muted">Output Tokens:</span>{" "}
                <span className="text-text-main font-mono">
                  {getOutputTokens(selectedDetail.tokens).toLocaleString()}
                </span>
              </div>
            </div>

            {selectedDetail.pxpipe && (
              <div className="rounded-lg border border-black/5 dark:border-white/5 p-4">
                <div className="flex items-center gap-2 mb-2">
                  <span className="material-symbols-outlined text-[18px] text-text-muted">image</span>
                  <span className="font-semibold text-sm text-text-main">PXPIPE</span>
                  <span className={cn(
                    "text-xs px-2 py-0.5 rounded",
                    selectedDetail.pxpipe.applied
                      ? "bg-green-500/15 text-green-600"
                      : "bg-amber-500/15 text-amber-600"
                  )}>
                    {selectedDetail.pxpipe.applied ? "Activated" : "Skipped"}
                  </span>
                </div>
                {selectedDetail.pxpipe.applied ? (
                  <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
                    <div>
                      <span className="text-text-muted block text-xs">Original (est.)</span>
                      <span className="font-mono">{(selectedDetail.pxpipe.tokensBeforeEst || 0).toLocaleString()} tokens</span>
                    </div>
                    <div>
                      <span className="text-text-muted block text-xs">Compressed (est.)</span>
                      <span className="font-mono">{(selectedDetail.pxpipe.tokensAfterEst || 0).toLocaleString()} tokens</span>
                    </div>
                    <div>
                      <span className="text-text-muted block text-xs">Saved</span>
                      <span className="font-mono text-green-600">{selectedDetail.pxpipe.savedPct || 0}%</span>
                    </div>
                    <div>
                      <span className="text-text-muted block text-xs">Images</span>
                      <span className="font-mono">{selectedDetail.pxpipe.imageCount || 0} ({selectedDetail.pxpipe.durationMs || 0}ms)</span>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-text-muted">
                    Reason: <span className="font-mono">{selectedDetail.pxpipe.reason}</span>
                    {selectedDetail.pxpipe.detail ? ` — ${selectedDetail.pxpipe.detail}` : ""}
                  </p>
                )}
              </div>
            )}

            <div className="space-y-4">
              <CollapsibleSection title="1. Client Request (Input)" defaultOpen={true} icon="input">
                {isTruncated(selectedDetail.request) ? (
                  <TruncatedNotice marker={selectedDetail.request} />
                ) : (
                  <pre className="max-h-[300px] max-w-full overflow-auto rounded-lg border border-black/5 bg-black/5 p-3 font-mono text-xs text-text-main dark:border-white/5 dark:bg-white/5 sm:p-4">
                    {JSON.stringify(selectedDetail.request, null, 2)}
                  </pre>
                )}
              </CollapsibleSection>

              {selectedDetail.providerRequest && (
                <CollapsibleSection title="2. Provider Request (Translated)" icon="translate">
                  {isTruncated(selectedDetail.providerRequest) ? (
                    <TruncatedNotice marker={selectedDetail.providerRequest} />
                  ) : (
                    <pre className="max-h-[300px] max-w-full overflow-auto rounded-lg border border-black/5 bg-black/5 p-3 font-mono text-xs text-text-main dark:border-white/5 dark:bg-white/5 sm:p-4">
                      {JSON.stringify(selectedDetail.providerRequest, null, 2)}
                    </pre>
                  )}
                </CollapsibleSection>
              )}

              {selectedDetail.providerResponse && (
                <CollapsibleSection title="3. Provider Response (Raw)" icon="data_object">
                  {isTruncated(selectedDetail.providerResponse) ? (
                    <TruncatedNotice marker={selectedDetail.providerResponse} />
                  ) : (
                    <pre className="max-h-[300px] max-w-full overflow-auto rounded-lg border border-black/5 bg-black/5 p-3 font-mono text-xs text-text-main dark:border-white/5 dark:bg-white/5 sm:p-4">
                      {typeof selectedDetail.providerResponse === 'object'
                        ? JSON.stringify(selectedDetail.providerResponse, null, 2)
                        : selectedDetail.providerResponse
                      }
                    </pre>
                  )}
                </CollapsibleSection>
              )}

              <CollapsibleSection title="4. Client Response (Final)" defaultOpen={true} icon="output">
                {isTruncated(selectedDetail.response) ? (
                  <TruncatedNotice marker={selectedDetail.response} />
                ) : (
                  <>
                    {selectedDetail.response?.thinking && (
                      <div className="mb-4">
                        <h4 className="font-semibold text-text-main mb-2 flex items-center gap-2 text-xs uppercase tracking-wide opacity-70">
                          <span className="material-symbols-outlined text-[16px]">psychology</span>
                          Thinking Process
                        </h4>
                        <pre className="max-h-[200px] max-w-full overflow-auto rounded-lg border border-amber-200 bg-amber-50 p-3 font-mono text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100 sm:p-4">
                          {selectedDetail.response.thinking}
                        </pre>
                      </div>
                    )}

                    <h4 className="font-semibold text-text-main mb-2 text-xs uppercase tracking-wide opacity-70">
                      Content
                    </h4>
                    <pre className="max-h-[300px] max-w-full overflow-auto rounded-lg border border-black/5 bg-black/5 p-3 font-mono text-xs text-text-main dark:border-white/5 dark:bg-white/5 sm:p-4">
                      {selectedDetail.response?.content || "[No content]"}
                    </pre>
                  </>
                )}
              </CollapsibleSection>
            </div>
          </div>
        )}
      </Drawer>
    </div>
  );
}
