"use client";

import { useCallback, useEffect, useMemo, useState, useRef } from "react";
import { Badge, Button, Card, CardSkeleton, Input, Modal, Toggle, ConfirmModal } from "@/shared/components";
import { useNotificationStore } from "@/store/notificationStore";
import { filterProxyPools, getVisibleProxyPoolSelection, updateProxyPoolSelection } from "@/shared/utils/proxyPoolSelection";
import { countBatchResults, dedupeProxyEntries, runProxyPoolBatch } from "./batchOperations.js";
import RelayDeployModal from "./RelayDeployModal";
import { PUBLIC_PROXY_SOURCES } from "@/shared/constants/publicProxySources.js";
import { PoolFormModal, BatchImportModal, PublicImportModal, PoolRow, parseProxyLine, getStatusVariant, formatDateTime, normalizeFormData, VERCEL_TOKEN_HINT, CF_TOKEN_HINT } from "./proxyPoolsComponents";

export default function ProxyPoolsPage() {
  const [proxyPools, setProxyPools] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showFormModal, setShowFormModal] = useState(false);
  const [showBatchImportModal, setShowBatchImportModal] = useState(false);
  const [showVercelModal, setShowVercelModal] = useState(false);
  const [showCloudflareModal, setShowCloudflareModal] = useState(false);
  const [showDenoModal, setShowDenoModal] = useState(false);
  const [showNetlifyModal, setShowNetlifyModal] = useState(false);
  const [showRelayMenu, setShowRelayMenu] = useState(false);
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [showPublicImportModal, setShowPublicImportModal] = useState(false);
  const [publicImportForm, setPublicImportForm] = useState({
    source: "freeproxydb",
    count: PUBLIC_PROXY_SOURCES.freeproxydb.defaultCount,
    protocol: "http",
    country: "",
    anonymity: "",
    httpsOnly: false,
    maxSpeed: "",
    orderBy: "success",
  });
  const [publicImporting, setPublicImporting] = useState(false);
  const [editingProxyPool, setEditingProxyPool] = useState(null);
  const [formData, setFormData] = useState(() => normalizeFormData());
  const [batchImportText, setBatchImportText] = useState("");
  const [vercelForm, setVercelForm] = useState({ vercelToken: "", projectName: "vercel-relay" });
  const [cloudflareForm, setCloudflareForm] = useState({ accountId: "", apiToken: "", projectName: "cloudflare-relay" });
  const [denoForm, setDenoForm] = useState({ denoToken: "", orgDomain: "", projectName: "" });
  const [netlifyForm, setNetlifyForm] = useState({ netlifyToken: "", projectName: "netlify-relay" });
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const [deploying, setDeploying] = useState(false);
  const [testingId, setTestingId] = useState(null);
  const [selectedPoolIds, setSelectedIds] = useState([]);
  const [statusFilter, setStatusFilter] = useState("all");
  const selectionAnchorRef = useRef(null);
  const [healthChecking, setHealthChecking] = useState(false);
  const [healthProgress, setHealthProgress] = useState({ current: 0, total: 0 });
  const [bulkBusy, setBulkBusy] = useState(false);
  const [batchProgress, setBatchProgress] = useState({ label: "", current: 0, total: 0 });
  const [confirmState, setConfirmState] = useState(null);
  const relayMenuRef = useRef(null);
  const addMenuRef = useRef(null);
  const notify = useNotificationStore();

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (relayMenuRef.current && !relayMenuRef.current.contains(e.target)) {
        setShowRelayMenu(false);
      }
      if (addMenuRef.current && !addMenuRef.current.contains(e.target)) {
        setShowAddMenu(false);
      }
    };
    if (showRelayMenu || showAddMenu) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showRelayMenu, showAddMenu]);

  const fetchProxyPools = useCallback(async () => {
    try {
      const res = await fetch("/api/proxy-pools?includeUsage=true", { cache: "no-store" });
      const data = await res.json();
      if (res.ok) {
        setProxyPools(data.proxyPools || []);
      }
    } catch (error) {
      console.log("Error fetching proxy pools:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- bootstrap fetch.
    fetchProxyPools();
  }, [fetchProxyPools]);

  const resetForm = () => {
    setEditingProxyPool(null);
    setFormData(normalizeFormData());
  };

  const openCreateModal = () => {
    resetForm();
    setShowFormModal(true);
  };

  const openEditModal = (proxyPool) => {
    setEditingProxyPool(proxyPool);
    setFormData(normalizeFormData(proxyPool));
    setShowFormModal(true);
  };

  const closeFormModal = () => {
    setShowFormModal(false);
    resetForm();
  };

  const handleSave = async () => {
    const payload = {
      name: formData.name.trim(),
      proxyUrl: formData.proxyUrl.trim(),
      noProxy: formData.noProxy.trim(),
      isActive: formData.isActive === true,
      strictProxy: formData.strictProxy === true,
    };

    if (!payload.name || !payload.proxyUrl) return;

    setSaving(true);
    try {
      const isEdit = !!editingProxyPool;
      const res = await fetch(isEdit ? `/api/proxy-pools/${editingProxyPool.id}` : "/api/proxy-pools", {
        method: isEdit ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        await fetchProxyPools();
        closeFormModal();
        notify.success(editingProxyPool ? "Proxy pool updated" : "Proxy pool created");
      } else {
        const data = await res.json();
        notify.error(data.error || "Failed to save proxy pool");
      }
    } catch (error) {
      console.log("Error saving proxy pool:", error);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (proxyPool) => {
    setConfirmState({
      title: "Delete Proxy Pool",
      message: `Delete proxy pool "${proxyPool.name}"?`,
      onConfirm: async () => {
        setConfirmState(null);
        try {
          const res = await fetch(`/api/proxy-pools/${proxyPool.id}`, { method: "DELETE" });
          if (res.ok) {
            setProxyPools((prev) => prev.filter((item) => item.id !== proxyPool.id));
            notify.success("Proxy pool deleted");
            return;
          }

          const data = await res.json();
          if (res.status === 409) {
            notify.warning(`Cannot delete: ${data.boundConnectionCount || 0} connection(s) are still using this pool.`);
          } else {
            notify.error(data.error || "Failed to delete proxy pool");
          }
        } catch (error) {
          console.log("Error deleting proxy pool:", error);
          notify.error("Failed to delete proxy pool");
        }
      }
    });
  };

  const handleTest = async (proxyPoolId) => {
    setTestingId(proxyPoolId);
    try {
      const res = await fetch(`/api/proxy-pools/${proxyPoolId}/test`, { method: "POST" });
      const data = await res.json();

      if (!res.ok) {
        notify.error(data.error || "Failed to test proxy");
        return;
      }

      await fetchProxyPools();
      notify.success(data.ok ? "Proxy test passed" : "Proxy test failed");
    } catch (error) {
      console.log("Error testing proxy pool:", error);
      notify.error("Failed to test proxy");
    } finally {
      setTestingId(null);
    }
  };

  const handleToggleActive = async (pool) => {
    const next = !pool.isActive;
    setProxyPools((prev) => prev.map((p) => p.id === pool.id ? { ...p, isActive: next } : p));
    try {
      const res = await fetch(`/api/proxy-pools/${pool.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: next }),
      });
      if (!res.ok) {
        setProxyPools((prev) => prev.map((p) => p.id === pool.id ? { ...p, isActive: pool.isActive } : p));
        notify.error("Failed to update active state");
      }
    } catch (error) {
      console.log("Error toggling active:", error);
      setProxyPools((prev) => prev.map((p) => p.id === pool.id ? { ...p, isActive: pool.isActive } : p));
    }
  };

  const visiblePools = useMemo(() => filterProxyPools(proxyPools, statusFilter), [proxyPools, statusFilter]);
  const visiblePoolsRef = useRef([]);
  useEffect(() => { visiblePoolsRef.current = visiblePools; }, [visiblePools]);
  const selectedIds = getVisibleProxyPoolSelection(visiblePools, selectedPoolIds);
  const allSelected = visiblePools.length > 0 && selectedIds.length === visiblePools.length;
  const toggleSelect = (id, checked, shiftKey) => {
    const anchorId = selectionAnchorRef.current;
    setSelectedIds((prev) => updateProxyPoolSelection(visiblePools, prev, { id, checked, shiftKey, anchorId }));
    selectionAnchorRef.current = id;
  };
  const toggleSelectAll = () => {
    setSelectedIds(allSelected ? [] : visiblePools.map((p) => p.id));
    selectionAnchorRef.current = null;
  };
  const clearSelection = () => {
    setSelectedIds([]);
    selectionAnchorRef.current = null;
  };

  const bulkSetActive = async (isActive) => {
    const targets = selectedIds.length > 0 ? selectedIds : visiblePools.map((p) => p.id);
    if (targets.length === 0) return;
    setBulkBusy(true);
    setBatchProgress({ label: isActive ? "Activating" : "Deactivating", current: 0, total: targets.length });
    try {
      const results = await runProxyPoolBatch(targets, async (id) => {
        const res = await fetch(`/api/proxy-pools/${id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ isActive }),
        });
        return res.ok ? "ok" : "fail";
      }, (current) => setBatchProgress((prev) => ({ ...prev, current })));
      const { ok = 0, fail = 0 } = countBatchResults(results);
      const failed = fail;
      await fetchProxyPools();
      notify.success(`${isActive ? "Activated" : "Deactivated"} ${ok}${failed ? `, failed ${failed}` : ""}`);
    } finally {
      setBatchProgress({ label: "", current: 0, total: 0 });
      setBulkBusy(false);
    }
  };

  const bulkDelete = async () => {
    if (selectedIds.length === 0) return;
    setConfirmState({
      title: "Delete Proxy Pools",
      message: `Delete ${selectedIds.length} proxy pool(s)?`,
      onConfirm: async () => {
        setConfirmState(null);
        setBulkBusy(true);
        const targets = getVisibleProxyPoolSelection(visiblePoolsRef.current, selectedIds);
        setBatchProgress({ label: "Deleting", current: 0, total: targets.length });
        try {
          const results = await runProxyPoolBatch(targets, async (id) => {
            const res = await fetch(`/api/proxy-pools/${id}`, { method: "DELETE" });
            if (res.ok) return "ok";
            if (res.status === 409) return "blocked";
            return "fail";
          }, (current) => setBatchProgress((prev) => ({ ...prev, current })));
          const { ok = 0, blocked = 0, fail: failed = 0 } = countBatchResults(results);
          await fetchProxyPools();
          clearSelection();
          notify.success(`Deleted ${ok}${blocked ? `, ${blocked} bound` : ""}${failed ? `, ${failed} failed` : ""}`);
        } finally {
          setBatchProgress({ label: "", current: 0, total: 0 });
          setBulkBusy(false);
        }
      }
    });
  };

  const handleHealthCheck = async () => {
    const targets = selectedIds.length > 0
      ? visiblePools.filter((p) => selectedIds.includes(p.id))
      : visiblePools;
    if (targets.length === 0) return;
    setHealthChecking(true);
    setHealthProgress({ current: 0, total: targets.length });
    let alive = 0; const deadIds = [];
    let done = 0;
    const CONCURRENCY = 10;
    const queue = [...targets];

    const worker = async () => {
      while (queue.length > 0) {
        const pool = queue.shift();
        if (!pool) break;
        try {
          const res = await fetch(`/api/proxy-pools/${pool.id}/test`, { method: "POST" });
          const data = await res.json();
          if (res.ok && data.ok) alive += 1; else deadIds.push(pool.id);
        } catch {
          deadIds.push(pool.id);
        } finally {
          done += 1;
          setHealthProgress({ current: done, total: targets.length });
        }
      }
    };

    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, targets.length) }, worker));
    await fetchProxyPools();
    setHealthChecking(false);
    setHealthProgress({ current: 0, total: 0 });

    if (deadIds.length > 0) {
      setConfirmState({
        title: "Disable Dead Proxies",
        message: `Alive: ${alive}, Dead: ${deadIds.length}.\n\nDisable ${deadIds.length} dead proxies?`,
        onConfirm: async () => {
          setConfirmState(null);
          setBulkBusy(true);
          try {
            await Promise.all(deadIds.map(id =>
              fetch(`/api/proxy-pools/${id}`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ isActive: false }),
              }).catch(() => {})
            ));
            await fetchProxyPools();
            notify.success(`Disabled ${deadIds.length} dead proxies`);
          } finally {
            setBulkBusy(false);
          }
        }
      });
    } else {
      notify.success(`Health check done. Alive: ${alive}, Dead: ${deadIds.length}`);
    }
  };

  const openBatchImportModal = () => {
    setBatchImportText("");
    setShowBatchImportModal(true);
  };

  const closeBatchImportModal = () => {
    if (importing) return;
    setShowBatchImportModal(false);
  };

  const openPublicImportModal = () => {
    setPublicImportForm({
      source: "freeproxydb",
      count: PUBLIC_PROXY_SOURCES.freeproxydb.defaultCount,
      protocol: "http",
      country: "",
      anonymity: "",
      httpsOnly: false,
      maxSpeed: "",
      orderBy: "success",
    });
    setShowPublicImportModal(true);
  };

  const closePublicImportModal = () => {
    if (publicImporting) return;
    setShowPublicImportModal(false);
  };

  const handlePublicImportField = (field, value) => {
    setPublicImportForm((prev) => {
      if (field === "source") {
        const source = PUBLIC_PROXY_SOURCES[value] || prev.source;
        return {
          source: value,
          count: source.defaultCount,
          protocol: "http",
          country: source.supportsCountry ? prev.country : "",
          anonymity: "",
          httpsOnly: false,
          maxSpeed: source.supportsMaxSpeed ? prev.maxSpeed : "",
          orderBy: "success",
        };
      }
      return { ...prev, [field]: value };
    });
  };

  const handlePublicImport = async () => {
    setPublicImporting(true);
    try {
      const res = await fetch("/api/proxy-pools/import-public", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(publicImportForm),
      });
      const data = await res.json();
      if (res.ok) {
        await fetchProxyPools();
        setShowPublicImportModal(false);
        if (data.imported === 0 && data.reason) {
          notify.warning(data.reason);
        } else {
          notify.success(
            `Public import: created ${data.imported}, skipped ${data.duplicates} duplicates${data.failed ? `, failed ${data.failed}` : ""}`
          );
        }
      } else {
        notify.error(data.error || "Public import failed");
      }
    } catch (error) {
      console.log("Error importing public proxies:", error);
      notify.error("Public import failed");
    } finally {
      setPublicImporting(false);
    }
  };

  const openVercelModal = () => {
    setVercelForm({ vercelToken: "", projectName: "vercel-relay" });
    setShowVercelModal(true);
  };

  const closeVercelModal = () => {
    if (deploying) return;
    setShowVercelModal(false);
  };

  const openCloudflareModal = () => {
    setCloudflareForm({ accountId: "", apiToken: "", projectName: "cloudflare-relay" });
    setShowCloudflareModal(true);
  };

  const closeCloudflareModal = () => {
    if (deploying) return;
    setShowCloudflareModal(false);
  };

  const openDenoModal = () => {
    setDenoForm({ denoToken: "", orgDomain: "", projectName: "" });
    setShowDenoModal(true);
  };

  const closeDenoModal = () => {
    if (deploying) return;
    setShowDenoModal(false);
  };

  const openNetlifyModal = () => {
    setShowNetlifyModal(true);
  };

  const closeNetlifyModal = () => {
    if (deploying) return;
    setShowNetlifyModal(false);
  };

  const handleVercelDeploy = async () => {
    if (!vercelForm.vercelToken.trim()) return;
    setDeploying(true);
    try {
      const res = await fetch("/api/proxy-pools/vercel-deploy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(vercelForm),
      });
      const data = await res.json();
      if (res.ok) {
        await fetchProxyPools();
        closeVercelModal();
        notify.success(`Deployed: ${data.deployUrl}`);
      } else {
        notify.error(data.error || "Deploy failed");
      }
    } catch (error) {
      console.log("Error deploying Vercel relay:", error);
      notify.error("Deploy failed");
    } finally {
      setDeploying(false);
    }
  };

  const handleCloudflareDeploy = async () => {
    if (!cloudflareForm.accountId.trim() || !cloudflareForm.apiToken.trim()) return;
    setDeploying(true);
    try {
      const res = await fetch("/api/proxy-pools/cloudflare-deploy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cloudflareForm),
      });
      const data = await res.json();
      if (res.ok) {
        await fetchProxyPools();
        closeCloudflareModal();
        notify.success(`Deployed: ${data.deployUrl}`);
      } else {
        notify.error(data.error || "Deploy failed");
      }
    } catch (error) {
      console.log("Error deploying Cloudflare relay:", error);
      notify.error("Deploy failed");
    } finally {
      setDeploying(false);
    }
  };

  const handleNetlifyDeploy = async () => {
    if (!netlifyForm.netlifyToken.trim()) return;
    setDeploying(true);
    try {
      const res = await fetch("/api/proxy-pools/netlify-deploy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(netlifyForm),
      });
      const data = await res.json();
      if (res.ok) {
        await fetchProxyPools();
        closeNetlifyModal();
        notify.success(`Deployed: ${data.deployUrl}`);
      } else {
        notify.error(data.error || "Deploy failed");
      }
    } catch (error) {
      console.log("Error deploying Netlify relay:", error);
      notify.error("Deploy failed");
    } finally {
      setDeploying(false);
    }
  };
  const handleDenoDeploy = async () => {
    if (!denoForm.denoToken.trim()) return;
    setDeploying(true);
    try {
      const res = await fetch("/api/proxy-pools/deno-deploy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(denoForm),
      });
      const data = await res.json();
      if (res.ok) {
        await fetchProxyPools();
        closeDenoModal();
        notify.success(`Deployed: ${data.deployUrl}`);
      } else {
        notify.error(data.error || "Deploy failed");
      }
    } catch (error) {
      console.log("Error deploying Deno relay:", error);
      notify.error("Deploy failed");
    } finally {
      setDeploying(false);
    }
  };

  const handleBatchImport = async () => {
    const lines = batchImportText
      .split(/\r?\n/)
      .flatMap((line) => { const t = line.trim(); return t ? [t] : []; });

    if (lines.length === 0) {
      notify.warning("Please paste at least one proxy line.");
      return;
    }

    const parsedEntries = [];
    const invalidLines = [];

    lines.forEach((line, index) => {
      try {
        const parsed = parseProxyLine(line);
        if (parsed) {
          parsedEntries.push({
            ...parsed,
            lineNumber: index + 1,
          });
        }
      } catch (error) {
        invalidLines.push(`Line ${index + 1}: ${error.message}`);
      }
    });

    if (invalidLines.length > 0) {
      notify.error(`Invalid proxy format:\n${invalidLines.join("\n")}`);
      return;
    }

    setImporting(true);
    try {
      const existingKeys = new Set(
        proxyPools.map((pool) => `${(pool.proxyUrl || "").trim()}|||${(pool.noProxy || "").trim()}`)
      );

      let created = 0;
      let skipped = 0;
      let failed = 0;

      const { accepted: toCreate, skipped: duplicateCount } = dedupeProxyEntries(parsedEntries, existingKeys);
      skipped += duplicateCount;

      setBatchProgress({ label: "Importing", current: 0, total: toCreate.length });
      const results = await runProxyPoolBatch(toCreate, async (entry) => {
        const res = await fetch("/api/proxy-pools", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: entry.name,
            proxyUrl: entry.proxyUrl,
            noProxy: "",
            isActive: true,
          }),
        });
        return res.ok ? "ok" : "fail";
      }, (current) => setBatchProgress((prev) => ({ ...prev, current })));
      const counts = countBatchResults(results);
      created = counts.ok || 0;
      failed = counts.fail || 0;

      await fetchProxyPools();
      setShowBatchImportModal(false);
      notify.success(`Batch import completed: Created ${created}, Skipped ${skipped}, Failed ${failed}`);
    } catch (error) {
      console.log("Error batch importing proxies:", error);
      notify.error("Batch import failed");
    } finally {
      setBatchProgress({ label: "", current: 0, total: 0 });
      setImporting(false);
    }
  };

  const activeCount = useMemo(
    () => proxyPools.filter((pool) => pool.isActive === true).length,
    [proxyPools]
  );

  if (loading) {
    return (
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-1 sm:gap-6 sm:px-0">
        <CardSkeleton />
        <CardSkeleton />
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-1 sm:gap-6 sm:px-0">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold sm:text-2xl">Proxy Pools</h1>
        </div>

        <div className="grid grid-cols-1 gap-2 sm:flex sm:items-center">
          <div className="relative" ref={relayMenuRef}>
            <Button
              size="sm"
              variant="secondary"
              icon="rocket_launch"
              onClick={() => setShowRelayMenu(!showRelayMenu)}
            >
              Deploy Relay
              <span className="material-symbols-outlined ml-1 text-[18px]">
                {showRelayMenu ? "expand_less" : "expand_more"}
              </span>
            </Button>

            {showRelayMenu && (
              <div className="absolute left-0 top-full z-50 mt-1 w-48 rounded-xl border border-black/10 bg-white p-1 shadow-xl dark:border-white/10 dark:bg-zinc-900 sm:left-auto sm:right-0">
                <button type="button"
                  onClick={() => {
                    openCloudflareModal();
                    setShowRelayMenu(false);
                  }}
                  className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-text-main transition-colors hover:bg-black/5 dark:hover:bg-white/5"
                >
                  <span className="material-symbols-outlined text-[20px] text-orange-500">cloud</span>
                  Cloudflare Relay
                </button>
                <button type="button"
                  onClick={() => {
                    openVercelModal();
                    setShowRelayMenu(false);
                  }}
                  className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-text-main transition-colors hover:bg-black/5 dark:hover:bg-white/5"
                >
                  <span className="material-symbols-outlined text-[20px] text-blue-500">cloud_upload</span>
                  Vercel Relay
                </button>
                <button type="button"
                  onClick={() => {
                    openDenoModal();
                    setShowRelayMenu(false);
                  }}
                  className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-text-main transition-colors hover:bg-black/5 dark:hover:bg-white/5"
                >
                  <span className="material-symbols-outlined text-[20px] text-green-500">terminal</span>
                  Deno Relay
                </button>
                <button
                  onClick={() => {
                    openNetlifyModal();
                    setShowRelayMenu(false);
                  }}
                  className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-text-main transition-colors hover:bg-black/5 dark:hover:bg-white/5"
                >
                  <span className="material-symbols-outlined text-[20px] text-teal-500">deployed_code</span>
                  Netlify Relay
                </button>
              </div>
            )}
          </div>

          <Button size="sm" variant="secondary" icon="upload" onClick={openBatchImportModal}>
            Batch Import
          </Button>
          <div className="relative" ref={addMenuRef}>
            <Button
              size="sm"
              icon="add"
              onClick={() => setShowAddMenu(!showAddMenu)}
            >
              Add Proxy Pool
              <span className="material-symbols-outlined ml-1 text-[18px]">
                {showAddMenu ? "expand_less" : "expand_more"}
              </span>
            </Button>

            {showAddMenu && (
              <div className="absolute left-0 top-full z-50 mt-1 w-56 rounded-xl border border-black/10 bg-white p-1 shadow-xl dark:border-white/10 dark:bg-zinc-900 sm:left-auto sm:right-0">
                <button type="button"
                  onClick={() => {
                    openCreateModal();
                    setShowAddMenu(false);
                  }}
                  className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-text-main transition-colors hover:bg-black/5 dark:hover:bg-white/5"
                >
                  <span className="material-symbols-outlined text-[20px] text-primary">edit_note</span>
                  Manual Entry
                </button>
                <button type="button"
                  onClick={() => {
                    openPublicImportModal();
                    setShowAddMenu(false);
                  }}
                  className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-text-main transition-colors hover:bg-black/5 dark:hover:bg-white/5"
                >
                  <span className="material-symbols-outlined text-[20px] text-emerald-500">public</span>
                  Import from Public Lists
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      <Card>
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
            aria-label="Filter proxy pools by status"
            className="rounded border border-border bg-surface px-2 py-1 text-xs text-text-main"
          >
            <option value="all">All pools</option>
            <option value="enabled">Enabled only</option>
            <option value="disabled">Disabled only</option>
          </select>
          {visiblePools.length > 0 && (
            <label className="flex items-center gap-1.5 text-xs text-text-muted cursor-pointer">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={toggleSelectAll}
                className="size-4 rounded border-black/20 dark:border-white/20"
              />
              {allSelected ? "Unselect all" : "Select all"}
            </label>
          )}
          <Badge variant="default">Total: {proxyPools.length}</Badge>
          <Badge variant="success">Active: {activeCount}</Badge>
        </div>

        {(selectedIds.length > 0 || healthChecking || batchProgress.total > 0) && (
          <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2">
            <span className="material-symbols-outlined text-[18px] text-primary">checklist</span>
            <span className="text-xs font-medium text-primary">
              {batchProgress.total > 0
                ? `${batchProgress.label} ${batchProgress.current}/${batchProgress.total}`
                : selectedIds.length > 0 ? `${selectedIds.length} selected` : "All pools"}
            </span>
            {batchProgress.total > 0 && (
              <div className="w-full basis-full" role="progressbar" aria-valuemin="0" aria-valuemax={batchProgress.total} aria-valuenow={batchProgress.current} aria-label={`${batchProgress.label} progress`}>
                <div className="h-1.5 overflow-hidden rounded-full bg-primary/15">
                  <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${(batchProgress.current / batchProgress.total) * 100}%` }} />
                </div>
              </div>
            )}
            <div className="ml-auto flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                icon={healthChecking ? "progress_activity" : "health_and_safety"}
                onClick={handleHealthCheck}
                disabled={healthChecking || bulkBusy || proxyPools.length === 0}
              >
                {healthChecking ? `Checking ${healthProgress.current}/${healthProgress.total}` : "Health Check"}
              </Button>
              {selectedIds.length > 0 && (
                <>
                  <Button size="sm" variant="secondary" icon="toggle_on" onClick={() => bulkSetActive(true)} disabled={bulkBusy || healthChecking}>
                    Activate
                  </Button>
                  <Button size="sm" variant="secondary" icon="toggle_off" onClick={() => bulkSetActive(false)} disabled={bulkBusy || healthChecking}>
                    Deactivate
                  </Button>
                  <Button size="sm" variant="secondary" icon="delete" onClick={bulkDelete} disabled={bulkBusy || healthChecking}>
                    Delete
                  </Button>
                  <Button size="sm" variant="ghost" onClick={clearSelection} disabled={bulkBusy || healthChecking}>
                    Clear
                  </Button>
                </>
              )}
            </div>
          </div>
        )}

        {proxyPools.length === 0 ? (
          <div className="text-center py-10">
            <p className="text-text-main font-medium mb-1">No proxy pool entries yet</p>
            <p className="text-sm text-text-muted mb-4">
              Create a proxy pool entry, then assign it to connections.
            </p>
            <Button icon="add" onClick={openCreateModal}>Add Proxy Pool</Button>
          </div>
        ) : (
          <div className="flex flex-col divide-y divide-black/[0.04] dark:divide-white/[0.05]">
            {visiblePools.map((pool) => (
              <PoolRow
                key={pool.id}
                pool={pool}
                selected={selectedIds.includes(pool.id)}
                testing={testingId === pool.id}
                onSelect={(event) => toggleSelect(pool.id, event.target.checked, event.nativeEvent.shiftKey)}
                onToggle={() => handleToggleActive(pool)}
                onTest={() => handleTest(pool.id)}
                onEdit={() => openEditModal(pool)}
                onDelete={() => handleDelete(pool)}
              />
            ))}
          </div>
        )}
      </Card>

      <BatchImportModal
        isOpen={showBatchImportModal}
        text={batchImportText}
        importing={importing}
        onChange={setBatchImportText}
        onImport={handleBatchImport}
        onClose={closeBatchImportModal}
      />

      <PublicImportModal
        isOpen={showPublicImportModal}
        form={publicImportForm}
        importing={publicImporting}
        onChange={handlePublicImportField}
        onImport={handlePublicImport}
        onClose={closePublicImportModal}
      />

      <RelayDeployModal
        isOpen={showVercelModal}
        onClose={closeVercelModal}
        title="Deploy Vercel Relay"
        accent="blue"
        intro="Deploys an edge relay function to Vercel. All AI provider requests will be forwarded through Vercel's edge network, masking your real IP from providers."
        bullets={[
          "Your IP is replaced by Vercel's dynamic edge IPs (hundreds of IPs across 20+ global regions)",
          "Vercel serves millions of apps — providers can't block Vercel IPs without affecting legitimate traffic",
          "Free tier: 100GB bandwidth/month, 500K edge invocations",
          "Deploy multiple relays on different accounts for more IP diversity",
        ]}
        fields={[
          { label: "Vercel API Token", value: vercelForm.vercelToken, onChange: (e) => setVercelForm((prev) => ({ ...prev, vercelToken: e.target.value })), placeholder: "your-vercel-api-token", hint: VERCEL_TOKEN_HINT, type: "password" },
          { label: "Project Name", value: vercelForm.projectName, onChange: (e) => setVercelForm((prev) => ({ ...prev, projectName: e.target.value })), placeholder: "my-relay", hint: "Unique name for your Vercel project. Leave empty for auto-generated name." },
        ]}
        deployLabel="Deploy"
        onDeploy={handleVercelDeploy}
        deploying={deploying}
        deployDisabled={!vercelForm.vercelToken.trim()}
      />
      <RelayDeployModal
        isOpen={showCloudflareModal}
        onClose={closeCloudflareModal}
        title="Deploy Cloudflare Relay"
        accent="neutral"
        intro="Deploys a Worker to Cloudflare's global edge network. All AI provider requests are forwarded through Cloudflare's edge, masking your real IP."
        bullets={[
          "Free tier: 100,000 requests/day",
          "Workers run on Cloudflare's global network",
          "Deploy multiple workers for more IP diversity",
        ]}
        fields={[
          { label: "Cloudflare API Token", value: cloudflareForm.apiToken, onChange: (e) => setCloudflareForm((prev) => ({ ...prev, apiToken: e.target.value })), placeholder: "your-cloudflare-api-token", hint: "Token is used once for deployment and not stored.", type: "password" },
          { label: "Account ID", value: cloudflareForm.accountId, onChange: (e) => setCloudflareForm((prev) => ({ ...prev, accountId: e.target.value })), placeholder: "your-account-id", hint: "Found in the Cloudflare dashboard sidebar." },
          { label: "Worker Name", value: cloudflareForm.workerName, onChange: (e) => setCloudflareForm((prev) => ({ ...prev, workerName: e.target.value })), placeholder: "my-relay", hint: "Unique name for your Worker. Leave empty for auto-generated name." },
        ]}
        deployLabel="Deploy Relay"
        onDeploy={handleCloudflareDeploy}
        deploying={deploying}
        deployDisabled={!cloudflareForm.apiToken.trim() || !cloudflareForm.accountId.trim()}
      />
      <RelayDeployModal
        isOpen={showDenoModal}
        onClose={closeDenoModal}
        title="Deploy Deno Relay"
        accent="neutral"
        intro="Deploys a relay worker to Deno Deploy's global edge network. All AI provider requests are forwarded through Deno's edge, masking your real IP."
        bullets={[
          "Deno Deploy v2 runs on a high-performance global edge network",
          "Free tier: 1M requests & 100GiB outbound traffic per month",
          "No per-request CPU time limits (unlike Vercel/Cloudflare)",
          "Support up to 20 active apps & 50 custom domains",
          "Deploy multiple relays for maximum IP diversity",
        ]}
        tokenStepsTitle="How to generate API token:"
        tokenSteps={[
          <>Go to <b>console.deno.com</b></>,
          <>Select your <b>Organization</b> → <b>Settings</b> → <b>Organization Tokens</b></>,
          <>Create a <b>Organization Token</b> (prefix <b>ddo_</b>)</>,
        ]}
        fields={[
          { label: "Deno Deploy API Token", value: denoForm.denoToken, onChange: (e) => setDenoForm((prev) => ({ ...prev, denoToken: e.target.value })), placeholder: "ddo_xxxxxxxxxxxxxxxx", hint: "Token is used once for deployment, not stored. Found in Organization Settings.", type: "password" },
          { label: "Organization Domain", value: denoForm.orgDomain, onChange: (e) => setDenoForm((prev) => ({ ...prev, orgDomain: e.target.value })), placeholder: "your-org.deno.net", hint: "Organization's default domain. Your relay URL will be in the format: https://my-relay.your-org.deno.net" },
          { label: "App Name", value: denoForm.projectName, onChange: (e) => setDenoForm((prev) => ({ ...prev, projectName: e.target.value })), placeholder: "deno-relay", hint: "Unique app name. Leave empty for auto-generated name." },
        ]}
        deployLabel="Deploy Relay"
        onDeploy={handleDenoDeploy}
        deploying={deploying}
        deployDisabled={!denoForm.denoToken.trim() || !denoForm.orgDomain.trim()}
      />
      <RelayDeployModal
        isOpen={showNetlifyModal}
        onClose={closeNetlifyModal}
        title="Deploy Netlify Relay"
        accent="teal"
        intro="Deploys a serverless relay function to Netlify's global edge network. All AI provider requests are forwarded through Netlify's edge, masking your real IP."
        bullets={[
          "Runs on Netlify Functions with a 60-second execution limit and streaming support",
          "Free tier: 125,000 function invocations and 100GB bandwidth per month",
          "Relay URL format: https://your-site.netlify.app/.netlify/functions/relay",
          "Deploy multiple relays on different accounts for more IP diversity",
        ]}
        tokenStepsTitle="How to generate API token:"
        tokenSteps={[
          <>Go to <b>User Settings</b> → <b>Applications</b> → <b>Personal access tokens</b></>,
          <>Select <b>New access token</b> and generate a token</>,
          <>Copy the token — you won&apos;t see it again after leaving the page</>,
        ]}
        fields={[
          { label: "Netlify API Token", value: netlifyForm.netlifyToken, onChange: (e) => setNetlifyForm((prev) => ({ ...prev, netlifyToken: e.target.value })), placeholder: "nfp_xxxxxxxxxxxxxxxx", hint: <>Token is used once for deployment and not stored. <a href="https://app.netlify.com/user/applications#personal-access-tokens" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">Get token →</a></>, type: "password" },
          { label: "Site Name", value: netlifyForm.projectName, onChange: (e) => setNetlifyForm((prev) => ({ ...prev, projectName: e.target.value })), placeholder: "netlify-relay", hint: "Unique site name (lowercase letters, numbers, hyphens). Your relay URL will be https://site-name.netlify.app/.netlify/functions/relay" },
        ]}
        deployLabel="Deploy"
        onDeploy={handleNetlifyDeploy}
        deploying={deploying}
        deployDisabled={!netlifyForm.netlifyToken.trim()}
      />
      <PoolFormModal
        isOpen={showFormModal}
        editingProxyPool={editingProxyPool}
        formData={formData}
        saving={saving}
        onClose={closeFormModal}
        onSave={handleSave}
        onChange={(field, value) => setFormData((prev) => ({ ...prev, [field]: value }))}
      />

      {/* Confirm Modal */}
      <ConfirmModal
        isOpen={!!confirmState}
        onClose={() => setConfirmState(null)}
        onConfirm={confirmState?.onConfirm}
        title={confirmState?.title || "Confirm"}
        message={confirmState?.message}
        variant="danger"
      />
    </div>
  );
}
