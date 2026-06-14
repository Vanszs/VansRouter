"use client";

import { useState, useEffect, useRef, useCallback, useMemo, useReducer } from "react";
import { Card, Button, ModelSelectModal, ManualConfigModal } from "@/shared/components";
import Image from "next/image";
import BaseUrlSelect from "./BaseUrlSelect";
import ApiKeySelect from "./ApiKeySelect";
import { matchKnownEndpoint } from "./cliEndpointMatch";

function CopilotCardBody({ tool, status, checking, baseUrl, apiKeys, activeProviders, cloudEnabled, tunnelEnabled, tunnelPublicUrl, tailscaleEnabled, tailscaleUrl, selectedApiKey, setSelectedApiKey, customBaseUrl, setCustomBaseUrl, selectedModels, setSelectedModels, getEffectiveBaseUrl, getDisplayUrl, message, applying, restoring, handleApply, handleReset, setModalOpen, setShowManualConfigModal }) {
  const removeModel = (id) => setSelectedModels((prev) => prev.filter((m) => m !== id));

  return (
    <div className="mt-4 pt-4 border-t border-border flex flex-col gap-4">
      {checking && (
        <div className="flex items-center gap-2 text-text-muted">
          <span className="material-symbols-outlined animate-spin">progress_activity</span>
          <span>Checking Copilot config...</span>
        </div>
      )}

      {!checking && (
        <>
          <div className="flex items-start gap-3 p-3 bg-blue-500/10 border border-blue-500/30 rounded-lg">
            <span className="material-symbols-outlined text-blue-500 text-lg">info</span>
            <div className="text-xs text-blue-700 dark:text-blue-300">
              <p className="font-medium">Writes to <code className="px-1 bg-black/5 dark:bg-white/10 rounded">chatLanguageModels.json</code></p>
              <p className="mt-0.5 opacity-80">Reload VS Code after applying for changes to take effect.</p>
            </div>
          </div>

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

            <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[8rem_auto_1fr] sm:items-start sm:gap-2">
              <span className="w-32 shrink-0 text-sm font-semibold text-text-main text-right pt-1">Models</span>
              <span className="material-symbols-outlined text-text-muted text-[14px] mt-1.5">arrow_forward</span>
              <div className="flex-1 flex flex-col gap-2">
                <div className="flex flex-wrap gap-1.5 min-h-[28px] px-2 py-1.5 bg-surface rounded border border-border">
                  {selectedModels.length === 0 ? (
                    <span className="text-xs text-text-muted">No models selected</span>
                  ) : (
                    selectedModels.map((model) => (
                      <span key={model} className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs bg-black/5 dark:bg-white/5 text-text-muted border border-transparent hover:border-border">
                        {model}
                        <button type="button" onClick={(e) => { e.stopPropagation(); removeModel(model); }} className="ml-0.5 hover:text-red-500">
                          <span className="material-symbols-outlined text-[12px]">close</span>
                        </button>
                      </span>
                    ))
                  )}
                </div>
                <div>
                  <button type="button" onClick={() => setModalOpen(true)} disabled={!activeProviders?.length} className={`px-2 py-1 rounded border text-xs transition-colors ${activeProviders?.length ? "bg-surface border-border text-text-main hover:border-primary cursor-pointer" : "opacity-50 cursor-not-allowed border-border"}`}>Add Model</button>
                </div>
              </div>
            </div>
          </div>

          {message && (
            <div className={`flex items-center gap-2 px-2 py-1.5 rounded text-xs ${message.type === "success" ? "bg-green-500/10 text-green-600" : "bg-red-500/10 text-red-600"}`}>
              <span className="material-symbols-outlined text-[14px]">{message.type === "success" ? "check_circle" : "error"}</span>
              <span>{message.text}</span>
            </div>
          )}

          <div className="grid grid-cols-1 gap-2 sm:flex sm:items-center">
            <Button variant="primary" size="sm" onClick={handleApply} disabled={selectedModels.length === 0} loading={applying}>
              <span className="material-symbols-outlined text-[14px] mr-1">save</span>Apply
            </Button>
            <Button variant="outline" size="sm" onClick={handleReset} disabled={!status?.has9Router} loading={restoring}>
              <span className="material-symbols-outlined text-[14px] mr-1">restore</span>Reset
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setShowManualConfigModal(true)} disabled={selectedModels.length === 0}>
              <span className="material-symbols-outlined text-[14px] mr-1">content_copy</span>Manual Config
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

export default function CopilotToolCard({ tool, isExpanded, onToggle, baseUrl, apiKeys, activeProviders, cloudEnabled, initialStatus, tunnelEnabled, tunnelPublicUrl, tailscaleEnabled, tailscaleUrl }) {
  const [state, dispatch] = useReducer((s, a) => {
    switch (a.type) {
      case "CHECK_START": return { ...s, checking: true };
      case "CHECK_DONE": return { ...s, status: a.data, checking: false };
      case "APPLY_START": return { ...s, applying: true, message: null };
      case "APPLY_DONE": return { ...s, applying: false, message: a.message };
      case "RESTORE_START": return { ...s, restoring: true, message: null };
      case "RESTORE_DONE": return { ...s, restoring: false, message: a.message };
      default: return s;
    }
  }, { status: initialStatus || null, checking: false, applying: false, restoring: false, message: null });
  const { status, checking, applying, restoring, message } = state;
  const [selectedApiKeyOverride, setSelectedApiKey] = useState(null);
  const selectedApiKey = selectedApiKeyOverride ?? (apiKeys?.length > 0 ? apiKeys[0].key : "");
  const [customBaseUrl, setCustomBaseUrl] = useState("");
  const [modelAliases, setModelAliases] = useState({});
  const [showManualConfigModal, setShowManualConfigModal] = useState(false);
  const [selectedModelsOverride, setSelectedModels] = useState(null);
  const derivedModels = useMemo(() => {
    if (status?.config && Array.isArray(status.config)) {
      const entry = status.config.find((e) => e.name === "9Router");
      if (entry?.models?.length > 0) return entry.models.map((m) => m.id);
    }
    return [];
  }, [status]);
  const selectedModels = selectedModelsOverride ?? derivedModels;
  const [modalOpen, setModalOpen] = useState(false);
  const selectedModelsRef = useRef([]);

  useEffect(() => {
    selectedModelsRef.current = selectedModels;
  }, [selectedModels]);

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
      const res = await fetch("/api/cli-tools/copilot-settings");
      const data = await res.json();
      dispatch({ type: "CHECK_DONE", data });
    } catch (error) {
      dispatch({ type: "CHECK_DONE", data: { error: error.message } });
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

  const saveModels = async (models) => {
    try {
      const keyToUse = (selectedApiKey && selectedApiKey.trim())
        ? selectedApiKey
        : (!cloudEnabled ? "sk_9router" : selectedApiKey);
      await fetch("/api/cli-tools/copilot-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ baseUrl: getEffectiveBaseUrl(), apiKey: keyToUse, models }),
      });
    } catch (error) {
      console.log("Error saving models:", error);
    }
  };

  const getConfigStatus = () => {
    if (!status) return null;
    if (!status.has9Router) return "not_configured";
    const url = status.currentUrl || "";
    return matchKnownEndpoint(url, { tunnelPublicUrl, tailscaleUrl }) ? "configured" : "other";
  };

  const configStatus = getConfigStatus();

  const getEffectiveBaseUrl = () => {
    const url = customBaseUrl || baseUrl;
    return url.endsWith("/v1") ? url : `${url}/v1`;
  };

  const getDisplayUrl = () => customBaseUrl || `${baseUrl}/v1`;

  const handleApply = async () => {
    dispatch({ type: "APPLY_START" });
    try {
      const keyToUse = (selectedApiKey && selectedApiKey.trim())
        ? selectedApiKey
        : (!cloudEnabled ? "sk_9router" : selectedApiKey);

      const res = await fetch("/api/cli-tools/copilot-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ baseUrl: getEffectiveBaseUrl(), apiKey: keyToUse, models: selectedModels }),
      });
      const data = await res.json();
      if (res.ok) {
        dispatch({ type: "APPLY_DONE", message: { type: "success", text: data.message || "Settings applied! Reload VS Code." } });
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
      const res = await fetch("/api/cli-tools/copilot-settings", { method: "DELETE" });
      const data = await res.json();
      if (res.ok) {
        dispatch({ type: "RESTORE_DONE", message: { type: "success", text: "Settings reset successfully!" } });
        setSelectedModels([]);
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
    const effectiveBaseUrl = getEffectiveBaseUrl();
    const modelsToShow = selectedModels.length > 0 ? selectedModels : ["provider/model-id"];

    return [{
      filename: "~/Library/Application Support/Code/User/chatLanguageModels.json",
      content: JSON.stringify([{
        name: "9Router",
        vendor: "azure",
        apiKey: keyToUse,
        models: modelsToShow.map((id) => ({
          id, name: id,
          url: `${effectiveBaseUrl}/chat/completions#models.ai.azure.com`,
          toolCalling: true, vision: false,
          maxInputTokens: 128000, maxOutputTokens: 16000,
        })),
      }], null, 2),
    }];
  };

  return (
    <Card padding="xs" className="overflow-hidden">
      <button type="button" className="flex w-full items-start justify-between gap-3 hover:cursor-pointer sm:items-center text-left" onClick={handleToggle} aria-expanded={isExpanded} aria-label="Toggle section">
        <div className="flex min-w-0 items-center gap-3">
          <div className="size-8 flex items-center justify-center shrink-0">
            <Image src="/providers/copilot.png" alt={tool.name} width={32} height={32} className="size-8 object-contain rounded-lg" sizes="32px" onError={(e) => { e.target.style.display = "none"; }} />
          </div>
          <div className="min-w-0">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <h3 className="font-medium text-sm">{tool.name}</h3>
              {configStatus === "configured" && <span className="px-1.5 py-0.5 text-[10px] font-medium bg-green-500/10 text-green-600 dark:text-green-400 rounded-full">Connected</span>}
              {configStatus === "not_configured" && <span className="px-1.5 py-0.5 text-[10px] font-medium bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 rounded-full">Not configured</span>}
              {configStatus === "other" && <span className="px-1.5 py-0.5 text-[10px] font-medium bg-blue-500/10 text-blue-600 dark:text-blue-400 rounded-full">Other</span>}
            </div>
            <p className="text-xs text-text-muted truncate">{tool.description}</p>
          </div>
        </div>
        <span className={`material-symbols-outlined text-text-muted text-[20px] transition-transform ${isExpanded ? "rotate-180" : ""}`}>expand_more</span>
      </button>

      {isExpanded && (
        <CopilotCardBody
          tool={tool} status={status} checking={checking} baseUrl={baseUrl} apiKeys={apiKeys}
          activeProviders={activeProviders} cloudEnabled={cloudEnabled}
          tunnelEnabled={tunnelEnabled} tunnelPublicUrl={tunnelPublicUrl}
          tailscaleEnabled={tailscaleEnabled} tailscaleUrl={tailscaleUrl}
          selectedApiKey={selectedApiKey} setSelectedApiKey={setSelectedApiKey}
          customBaseUrl={customBaseUrl} setCustomBaseUrl={setCustomBaseUrl}
          selectedModels={selectedModels} setSelectedModels={setSelectedModels}
          getEffectiveBaseUrl={getEffectiveBaseUrl} getDisplayUrl={getDisplayUrl}
          message={message} applying={applying} restoring={restoring}
          handleApply={handleApply} handleReset={handleReset}
          setModalOpen={setModalOpen} setShowManualConfigModal={setShowManualConfigModal}
        />
      )}

      <ModelSelectModal
        isOpen={modalOpen}
        onClose={() => {
          setModalOpen(false);
          saveModels(selectedModelsRef.current);
        }}
        onSelect={(model) => {
          if (!selectedModels.includes(model.value)) {
            setSelectedModels([...selectedModels, model.value]);
          }
        }}
        onDeselect={(model) => {
          setSelectedModels(selectedModels.filter(m => m !== model.value));
        }}
        selectedModel={null}
        activeProviders={activeProviders}
        modelAliases={modelAliases}
        addedModelValues={selectedModels}
        closeOnSelect={false}
        title="Add Model for GitHub Copilot"
      />

      <ManualConfigModal
        isOpen={showManualConfigModal}
        onClose={() => setShowManualConfigModal(false)}
        title="GitHub Copilot - Manual Configuration"
        configs={getManualConfigs()}
      />
    </Card>
  );
}
