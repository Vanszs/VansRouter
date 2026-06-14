"use client";

import { useState, useEffect, useRef, useCallback, useReducer } from "react";
import { Card, Button, ModelSelectModal, ManualConfigModal } from "@/shared/components";
import Image from "next/image";
import BaseUrlSelect from "./BaseUrlSelect";
import ApiKeySelect from "./ApiKeySelect";
import { matchKnownEndpoint } from "./cliEndpointMatch";

function toolCardReducer(state, action) {
  switch (action.type) {
    case "CHECK_START": return { ...state, checking: true };
    case "CHECK_DONE": return { ...state, status: action.data, checking: false };
    case "APPLY_START": return { ...state, applying: true, message: null };
    case "APPLY_DONE": return { ...state, applying: false, message: action.message };
    case "RESTORE_START": return { ...state, restoring: true, message: null };
    case "RESTORE_DONE": return { ...state, restoring: false, message: action.message };
    default: return state;
  }
}

export default function KiloToolCard({ tool, isExpanded, onToggle, baseUrl, apiKeys, activeProviders, cloudEnabled, initialStatus, tunnelEnabled, tunnelPublicUrl, tailscaleEnabled, tailscaleUrl }) {
  const [state, dispatch] = useReducer(toolCardReducer, {
    status: initialStatus || null,
    checking: false,
    applying: false,
    restoring: false,
    message: null,
  });
  const { status, checking, applying, restoring, message } = state;
  const [showInstallGuide, setShowInstallGuide] = useState(false);
  const [selectedApiKeyOverride, setSelectedApiKey] = useState(null);
  const selectedApiKey = selectedApiKeyOverride ?? (apiKeys?.length > 0 ? apiKeys[0].key : "");
  const [selectedModel, setSelectedModel] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [modelAliases, setModelAliases] = useState({});
  const [showManualConfigModal, setShowManualConfigModal] = useState(false);
  const [customBaseUrl, setCustomBaseUrl] = useState("");

  const fetchModelAliases = useCallback(async () => {
    try {
      const res = await fetch("/api/models/alias");
      const data = await res.json();
      if (res.ok) setModelAliases(data.aliases || {});
    } catch (error) {
      console.log("Error fetching model aliases:", error);
    }
  }, []);

  const checkStatus = useCallback(async () => {
    dispatch({ type: "CHECK_START" });
    try {
      const res = await fetch("/api/cli-tools/kilo-settings");
      const data = await res.json();
      dispatch({ type: "CHECK_DONE", data });
    } catch (error) {
      dispatch({ type: "CHECK_DONE", data: { installed: false, error: error.message } });
    }
  }, []);

  const statusFetchedRef = useRef(!!initialStatus);
  const aliasesFetchedRef = useRef(false);

  const initializeCard = useCallback(async () => {
    if (!statusFetchedRef.current) {
      statusFetchedRef.current = true;
      await checkStatus();
    }
    if (!aliasesFetchedRef.current) {
      aliasesFetchedRef.current = true;
      await fetchModelAliases();
    }
  }, [checkStatus, fetchModelAliases]);

  const handleToggle = useCallback(() => {
    if (!isExpanded) initializeCard();
    onToggle();
  }, [isExpanded, initializeCard, onToggle]);

  useEffect(() => { initializeCard(); }, [initializeCard]);

  const getConfigStatus = () => {
    if (!status?.installed) return null;
    return status.has9Router ? "configured" : "not_configured";
  };

  const configStatus = getConfigStatus();

  const getEffectiveBaseUrl = () => {
    const url = customBaseUrl || `${baseUrl}/v1`;
    return url.endsWith("/v1") ? url : `${url}/v1`;
  };

  const getDisplayUrl = () => customBaseUrl || `${baseUrl}/v1`;

  const handleApply = async () => {
    dispatch({ type: "APPLY_START" });
    try {
      const keyToUse = (selectedApiKey && selectedApiKey.trim())
        ? selectedApiKey
        : (!cloudEnabled ? "sk_9router" : selectedApiKey);

      const res = await fetch("/api/cli-tools/kilo-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ baseUrl: getEffectiveBaseUrl(), apiKey: keyToUse, model: selectedModel }),
      });
      const data = await res.json();
      if (res.ok) {
        dispatch({ type: "APPLY_DONE", message: { type: "success", text: "Settings applied successfully!" } });
        checkStatus();
      } else {
        dispatch({ type: "APPLY_DONE", message: { type: "error", text: data.error || "Failed to apply settings" } });
      }
    } catch (error) {
      dispatch({ type: "APPLY_DONE", message: { type: "error", text: error.message } });
    }
  };

  const handleReset = async () => {
    dispatch({ type: "RESTORE_START" });
    try {
      const res = await fetch("/api/cli-tools/kilo-settings", { method: "DELETE" });
      const data = await res.json();
      if (res.ok) {
        dispatch({ type: "RESTORE_DONE", message: { type: "success", text: "Settings reset successfully!" } });
        setSelectedModel("");
        checkStatus();
      } else {
        dispatch({ type: "RESTORE_DONE", message: { type: "error", text: data.error || "Failed to reset settings" } });
      }
    } catch (error) {
      dispatch({ type: "RESTORE_DONE", message: { type: "error", text: error.message } });
    }
  };

  const getManualConfigs = () => {
    const keyToUse = (selectedApiKey && selectedApiKey.trim())
      ? selectedApiKey
      : (!cloudEnabled ? "sk_9router" : "<API_KEY_FROM_DASHBOARD>");

    return [{
      filename: "~/.local/share/kilo/auth.json",
      content: JSON.stringify({
        "openai-compatible": {
          type: "api-key",
          apiKey: keyToUse,
          baseUrl: getEffectiveBaseUrl(),
          model: selectedModel || "provider/model-id",
        },
      }, null, 2),
    }];
  };

  return (
    <Card padding="xs" className="overflow-hidden">
      <button type="button" className="flex w-full items-start justify-between gap-3 hover:cursor-pointer sm:items-center text-left" onClick={handleToggle} aria-expanded={expanded} aria-label="Toggle section">
        <div className="flex min-w-0 items-center gap-3">
          <div className="size-8 flex items-center justify-center shrink-0">
            <Image src="/providers/kilocode.png" alt={tool.name} width={32} height={32} className="size-8 object-contain rounded-lg" sizes="32px" onError={(e) => { e.target.style.display = "none"; }} />
          </div>
          <div className="min-w-0">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <h3 className="font-medium text-sm">{tool.name}</h3>
              {configStatus === "configured" && <span className="px-1.5 py-0.5 text-[10px] font-medium bg-green-500/10 text-green-600 dark:text-green-400 rounded-full">Connected</span>}
              {configStatus === "not_configured" && <span className="px-1.5 py-0.5 text-[10px] font-medium bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 rounded-full">Not configured</span>}
            </div>
            <p className="text-xs text-text-muted truncate">{tool.description}</p>
          </div>
        </div>
        <span className={`material-symbols-outlined text-text-muted text-[20px] transition-transform ${isExpanded ? "rotate-180" : ""}`}>expand_more</span>
      </button>

      {isExpanded && (
        <div className="mt-4 pt-4 border-t border-border flex flex-col gap-4">
          {checking && (
            <div className="flex items-center gap-2 text-text-muted">
              <span className="material-symbols-outlined animate-spin">progress_activity</span>
              <span>Checking Kilo Code...</span>
            </div>
          )}

          {!checking && status && !status.installed && (
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-3 p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
                <div className="flex items-start gap-3">
                  <span className="material-symbols-outlined text-yellow-500">warning</span>
                  <div className="flex-1">
                    <p className="font-medium text-yellow-600 dark:text-yellow-400">Kilo Code not detected locally</p>
                    <p className="text-sm text-text-muted">Manual configuration is still available if 9router is deployed on a remote server.</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 pl-9">
                  <Button variant="secondary" size="sm" onClick={() => setShowManualConfigModal(true)} className="!bg-yellow-500/20 !border-yellow-500/40 !text-yellow-700 dark:!text-yellow-300 hover:!bg-yellow-500/30">
                    <span className="material-symbols-outlined text-[18px] mr-1">content_copy</span>
                    Manual Config
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setShowInstallGuide(!showInstallGuide)}>
                    <span className="material-symbols-outlined text-[18px] mr-1">{showInstallGuide ? "expand_less" : "help"}</span>
                    {showInstallGuide ? "Hide" : "How to Install"}
                  </Button>
                </div>
              </div>
              {showInstallGuide && (
                <div className="p-4 bg-surface border border-border rounded-lg">
                  <h4 className="font-medium mb-3">Installation Guide</h4>
                  <p className="text-sm text-text-muted">Install Kilo Code from <a className="text-primary underline" href="https://kilocode.ai" target="_blank" rel="noreferrer">kilocode.ai</a> or VS Code extension marketplace.</p>
                </div>
              )}
            </div>
          )}

          {!checking && status?.installed && (
            <>
              <div className="flex flex-col gap-2">
                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[8rem_auto_1fr] sm:items-center sm:gap-2">
                  <span className="text-xs font-semibold text-text-main sm:text-right sm:text-sm">Select Endpoint</span>
                  <span className="material-symbols-outlined hidden text-text-muted text-[14px] sm:inline">arrow_forward</span>
                  <BaseUrlSelect
                    value={customBaseUrl || getDisplayUrl()}
                    onChange={setCustomBaseUrl}
                    requiresExternalUrl={tool.requiresExternalUrl}
                    tunnelEnabled={tunnelEnabled}
                    tunnelPublicUrl={tunnelPublicUrl}
                    tailscaleEnabled={tailscaleEnabled}
                    tailscaleUrl={tailscaleUrl}
                  />
                </div>

                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[8rem_auto_1fr_auto] sm:items-center sm:gap-2">
                  <span className="text-xs font-semibold text-text-main sm:text-right sm:text-sm">API Key</span>
                  <span className="material-symbols-outlined hidden text-text-muted text-[14px] sm:inline">arrow_forward</span>
                  <ApiKeySelect value={selectedApiKey} onChange={setSelectedApiKey} apiKeys={apiKeys} cloudEnabled={cloudEnabled} />
                </div>

                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[8rem_auto_1fr_auto] sm:items-center sm:gap-2">
                  <span className="text-xs font-semibold text-text-main sm:text-right sm:text-sm">Model</span>
                  <span className="material-symbols-outlined hidden text-text-muted text-[14px] sm:inline">arrow_forward</span>
                  <div className="relative w-full min-w-0">
                    <input type="text" value={selectedModel} onChange={(e) => setSelectedModel(e.target.value)} aria-label="Model ID" placeholder="provider/model-id" className="w-full min-w-0 pl-2 pr-7 py-2 bg-surface rounded border border-border text-xs focus:outline-none focus:ring-1 focus:ring-primary/50 sm:py-1.5" />
                    {selectedModel && <button type="button" onClick={() => setSelectedModel("")} className="absolute right-1 top-1/2 -translate-y-1/2 p-0.5 text-text-muted hover:text-red-500 rounded transition-colors" title="Clear"><span className="material-symbols-outlined text-[14px]">close</span></button>}
                  </div>
                  <button type="button" onClick={() => setModalOpen(true)} disabled={!activeProviders?.length} className={`w-full sm:w-auto rounded border px-2 py-2 text-xs transition-colors sm:py-1.5 whitespace-nowrap sm:shrink-0 ${activeProviders?.length ? "bg-surface border-border text-text-main hover:border-primary cursor-pointer" : "opacity-50 cursor-not-allowed border-border"}`}>Select Model</button>
                </div>
              </div>

              {message && (
                <div className={`flex items-center gap-2 px-2 py-1.5 rounded text-xs ${message.type === "success" ? "bg-green-500/10 text-green-600" : "bg-red-500/10 text-red-600"}`}>
                  <span className="material-symbols-outlined text-[14px]">{message.type === "success" ? "check_circle" : "error"}</span>
                  <span>{message.text}</span>
                </div>
              )}

              <div className="grid grid-cols-1 gap-2 sm:flex sm:items-center">
                <Button variant="primary" size="sm" onClick={handleApply} disabled={(!selectedApiKey && (cloudEnabled && apiKeys.length > 0)) || !selectedModel} loading={applying}>
                  <span className="material-symbols-outlined text-[14px] mr-1">save</span>Apply
                </Button>
                <Button variant="outline" size="sm" onClick={handleReset} disabled={restoring} loading={restoring}>
                  <span className="material-symbols-outlined text-[14px] mr-1">restore</span>Reset
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setShowManualConfigModal(true)}>
                  <span className="material-symbols-outlined text-[14px] mr-1">content_copy</span>Manual Config
                </Button>
              </div>
            </>
          )}
        </div>
      )}

      <ModelSelectModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        onSelect={(model) => { setSelectedModel(model.value); setModalOpen(false); }}
        selectedModel={selectedModel}
        activeProviders={activeProviders}
        modelAliases={modelAliases}
        title="Select Model for Kilo Code"
      />

      <ManualConfigModal
        isOpen={showManualConfigModal}
        onClose={() => setShowManualConfigModal(false)}
        title="Kilo Code - Manual Configuration"
        configs={getManualConfigs()}
      />
    </Card>
  );
}
