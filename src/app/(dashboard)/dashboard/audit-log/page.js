"use client";

import { useState, useEffect, useCallback } from "react";

export default function AuditLogPage() {
  const [logs, setLogs] = useState([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(0);
  const [loading, setLoading] = useState(true);
  const [actionFilter, setActionFilter] = useState("");
  const [actorFilter, setActorFilter] = useState("");
  const [actions, setActions] = useState([]);
  const limit = 50;

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: String(limit) });
      if (actionFilter) params.set("action", actionFilter);
      if (actorFilter) params.set("actor", actorFilter);
      const res = await fetch(`/api/audit-logs?${params}`);
      if (res.ok) {
        const data = await res.json();
        setLogs(data.data || []);
        setTotal(data.total || 0);
        setPages(data.pages || 0);
      }
    } catch (err) {
      console.error("Failed to fetch audit logs:", err);
    } finally {
      setLoading(false);
    }
  }, [page, actionFilter, actorFilter]);

  useEffect(() => {
    fetch("/api/audit-logs?actions=list")
      .then((r) => r.json())
      .then((d) => setActions(d.actions || []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  const formatDate = (ts) => {
    try {
      return new Date(ts).toLocaleString();
    } catch {
      return ts;
    }
  };

  return (
    <div className="flex min-w-0 flex-col gap-6 px-1 sm:px-0">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-xl font-semibold text-white">Audit Log</h1>
        <div className="flex gap-2">
          <select
            className="rounded bg-zinc-800 px-3 py-1.5 text-sm text-zinc-300 border border-zinc-700"
            value={actionFilter}
            onChange={(e) => { setActionFilter(e.target.value); setPage(1); }}
          >
            <option value="">All actions</option>
            {actions.map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
          <input
            type="text"
            placeholder="Filter by actor…"
            className="rounded bg-zinc-800 px-3 py-1.5 text-sm text-zinc-300 border border-zinc-700"
            value={actorFilter}
            onChange={(e) => { setActorFilter(e.target.value); setPage(1); }}
          />
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-zinc-800 bg-zinc-900/60">
        <table className="w-full text-sm text-left text-zinc-300">
          <thead className="text-xs uppercase bg-zinc-800/50 text-zinc-400">
            <tr>
              <th className="px-4 py-3">Time</th>
              <th className="px-4 py-3">Action</th>
              <th className="px-4 py-3">Actor</th>
              <th className="px-4 py-3">Target</th>
              <th className="px-4 py-3">Details</th>
              <th className="px-4 py-3">IP</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-zinc-500">Loading…</td></tr>
            ) : logs.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-zinc-500">No audit log entries found.</td></tr>
            ) : (
              logs.map((log) => (
                <tr key={log.id} className="border-t border-zinc-800 hover:bg-zinc-800/40">
                  <td className="px-4 py-2 whitespace-nowrap text-xs text-zinc-400">{formatDate(log.timestamp)}</td>
                  <td className="px-4 py-2">
                    <span className="rounded bg-blue-900/40 px-2 py-0.5 text-xs text-blue-300">{log.action}</span>
                  </td>
                  <td className="px-4 py-2 text-xs text-zinc-400">{log.actor || "—"}</td>
                  <td className="px-4 py-2 text-xs text-zinc-400 max-w-[200px] truncate">{log.target || "—"}</td>
                  <td className="px-4 py-2 text-xs text-zinc-500 max-w-[300px] truncate">
                    {log.details ? JSON.stringify(log.details) : "—"}
                  </td>
                  <td className="px-4 py-2 text-xs text-zinc-500">{log.ip || "—"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {pages > 1 && (
        <div className="flex items-center justify-between text-sm text-zinc-400">
          <span>{total} total entries</span>
          <div className="flex gap-1">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="rounded bg-zinc-800 px-3 py-1 hover:bg-zinc-700 disabled:opacity-40"
            >
              ← Prev
            </button>
            <span className="px-3 py-1">Page {page} / {pages}</span>
            <button
              onClick={() => setPage((p) => Math.min(pages, p + 1))}
              disabled={page >= pages}
              className="rounded bg-zinc-800 px-3 py-1 hover:bg-zinc-700 disabled:opacity-40"
            >
              Next →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
