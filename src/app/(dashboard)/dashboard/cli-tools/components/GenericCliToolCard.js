"use client";

import { useState } from "react";
import Image from "next/image";
import { Card, Button, ModelSelectModal, ManualConfigModal } from "@/shared/components";
import BaseUrlSelect from "./BaseUrlSelect";
import ApiKeySelect from "./ApiKeySelect";
import useCliToolLifecycle from "./useCliToolLifecycle";
import { matchKnownEndpoint } from "./cliEndpointMatch";

const CONFIG_FILES = {
  pi: "~/.pi/agent/models.json",
  omp: "~/.omp/agent/models.yml",
  crush: "~/.config/crush/crush.json",
  forge: "~/.forge/config.toml",
  smelt: "~/.smelt/config.json",
  codewhale: "~/.codewhale/config.toml",
};

const isMultiModel = (toolId) => toolId === "pi";
const hasModelField = (toolId) => !isMultiModel(toolId) && toolId !== "omp";

const getConfigBaseUrl = (config) =>
  config?.baseUrl ||
  config?.openai?.base_url ||
  config?.providers?.["9router"]?.base_url ||
  config?.providers?.["9router"]?.baseUrl ||
  "";

const getConfiguredModels = (config) => {
  const list = config?.providers?.["9router"]?.models;
  if (!Array.isArray(list)) return [];
  return list.map((model) => (typeof model === "string" ? model : model?.id)).filter(Boolean);
};

export default function GenericCliToolCard({ tool, isExpanded, onToggle, baseUrl, apiKeys, activeProviders, cloudEnabled, initialStatus, tunnelEnabled, tunnelPublicUrl, tailscaleEnabled, tailscaleUrl }) {
  const statusEndpoint = `/api/cli-tools/${tool.id}-settings`;
  const { status, checking, applying, restoring, message, dispatch, checkStatus, customBaseUrl, getDisplayUrl, getEffectiveBaseUrl, handleToggle, modelAliases, selectedApiKey, setCustomBaseUrl, setSelectedApiKey } = useCliToolLifecycle({ apiKeys, baseUrl, cloudEnabled, initialStatus, isExpanded, onToggle, statusEndpoint });
  const [modelOverride, setModelOverride] = useState(null);
  const [modelsOverride, setModelsOverride] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [showInstallGuide, setShowInstallGuide] = useState(false);
  const [showManualConfigModal, setShowManualConfigModal] = useState(false);

  const configFile = CONFIG_FILES[tool.id];
  const currentBaseUrl = getConfigBaseUrl(status?.config);
  const selectedModel = modelOverride ?? status?.config?.model ?? status?.config?.openai?.model ?? getConfiguredModels(status?.config)[0] ?? "";
  const selectedModels = modelsOverride ?? getConfiguredModels(status?.config);
  const modelMissing = (hasModelField(tool.id) && !selectedModel) || (isMultiModel(tool.id) && selectedModels.length === 0);

  const configStatus = !status?.installed
    ? null
    : !status.has9Router
      ? "not_configured"
      : matchKnownEndpoint(currentBaseUrl, { tunnelPublicUrl, tailscaleUrl })
        ? "configured"
        : "other";

  const getKeyToUse = () => (selectedApiKey && selectedApiKey.trim()) ? selectedApiKey : (!cloudEnabled ? "sk_9router" : "");

  const handleApply = async () => {
    dispatch({ type: "APPLY_START" });
    try {
      const payload = { baseUrl: getEffectiveBaseUrl(), apiKey: getKeyToUse() };
      if (isMultiModel(tool.id)) payload.models = selectedModels;
      else if (hasModelField(tool.id)) payload.model = selectedModel;

      const res = await fetch(statusEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (res.ok) {
        dispatch({ type: "APPLY_DONE", message: { type: "success", text: data.message || "Settings applied successfully!" } });
        setModelOverride(null);
        setModelsOverride(null);
        checkStatus();
      } else {
        dispatch({ type: "APPLY_DONE", message: { type: "error", text: data.error?.message || "Failed to apply settings" } });
      }
    } catch (error) {
      dispatch({ type: "APPLY_DONE", message: { type: "error", text: error.message } });
    }
  };

  const handleReset = async () => {
    dispatch({ type: "RESTORE_START" });
    try {
      const res = await fetch(statusEndpoint, { method: "DELETE" });
      const data = await res.json();
      if (res.ok) {
        dispatch({ type: "RESTORE_DONE", message: { type: "success", text: data.message || "Settings reset successfully!" } });
        setModelOverride(null);
        setModelsOverride(null);
        checkStatus();
      } else {
        dispatch({ type: "RESTORE_DONE", message: { type: "error", text: data.error?.message || "Failed to reset settings" } });
      }
    } catch (error) {
      dispatch({ type: "RESTORE_DONE", message: { type: "error", text: error.message } });
    }
  };

  const getManualConfigs = () => {
    const keyToUse = (selectedApiKey && selectedApiKey.trim()) ? selectedApiKey : (!cloudEnabled ? "sk_9router" : "<API_KEY_FROM_DASHBOARD>");
    const url = getEffectiveBaseUrl();
    const model = selectedModel || "provider/model-id";

    if (isMultiModel(tool.id)) {
      const models = (selectedModels.length > 0 ? selectedModels : [model]).map((id) => ({ id, name: id, contextWindow: 128000, maxTokens: 16384 }));
      return [{ filename: configFile, content: JSON.stringify({ providers: { "9router": { baseUrl: url, apiKey: keyToUse, api: "openai-completions", models } } }, null, 2) }];
    }

    switch (tool.id) {
      case "omp":
        return [{ filename: configFile, content: `providers:\n  9router:\n    baseUrl: ${url}\n    apiKey: ${keyToUse}\n    api: openai-completions\n    authHeader: true\n    disableStrictTools: true\n    discovery:\n      type: proxy` }];
      case "crush":
        return [{ filename: configFile, content: JSON.stringify({ providers: { "9router": { type: "openai-compat", base_url: url, api_key: keyToUse, models: [{ id: model, name: model, context_window: 128000 }] } } }, null, 2) }];
      case "forge":
        return [{ filename: configFile, content: `# Forge config — managed by 9Router\n\n[openai]\napi_key = "${keyToUse}"\nbase_url = "${url}"\nmodel = "${model}"` }];
      case "smelt":
        return [{ filename: configFile, content: JSON.stringify({ baseUrl: url, apiKey: keyToUse, model, _managedBy: "9router" }, null, 2) }];
      case "codewhale":
        return [{ filename: configFile, content: `# CodeWhale config — managed by 9Router\n\n[openai]\nbase_url = "${url}"\napi_key = "${keyToUse}"\nmodel = "${model}"` }];
      default:
        return [];
    }
  };

  return (
    <Card padding="xs" className="overflow-hidden">
      <button type="button" className="flex w-full items-start justify-between gap-3 hover:cursor-pointer sm:items-center text-left" onClick={handleToggle} aria-expanded={isExpanded} aria-label="Toggle section">
        <div className="flex min-w-0 items-center gap-3">
          <div className="size-8 flex items-center justify-center shrink-0">
            <Image src={tool.image} alt={tool.name} width={32} height={32} className="size-8 object-contain rounded-lg" sizes="32px" onError={(e) => { e.target.style.display = "none"; }} />
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
        <div className="mt-4 pt-4 border-t border-border flex flex-col gap-4">
          {checking && (
            <div className="flex items-center gap-2 text-text-muted">
              <span className="material-symbols-outlined animate-spin">progress_activity</span>
              <span>Checking {tool.name}...</span>
            </div>
          )}

          {!checking && status && !status.installed && (
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-3 p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
                <div className="flex items-start gap-3">
                  <span className="material-symbols-outlined text-yellow-500">warning</span>
                  <div className="flex-1">
                    <p className="font-medium text-yellow-600 dark:text-yellow-400">{tool.name} not detected locally</p>
                    <p className="text-sm text-text-muted">Manual configuration is still available if VansRoute is deployed on a remote server.</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 pl-9">
                  <Button variant="secondary" size="sm" onClick={() => setShowManualConfigModal(true)} className="!bg-yellow-500/20 !border-yellow-500/40 !text-yellow-700 dark:!text-yellow-300 hover:!bg-yellow-500/30">
                    <span className="material-symbols-outlined text-[18px] mr-1">content_copy</span>
                    Manual Config
                  </Button>
                  {tool.docsUrl && (
                    <Button variant="outline" size="sm" onClick={() => setShowInstallGuide(!showInstallGuide)}>
                      <span className="material-symbols-outlined text-[18px] mr-1">{showInstallGuide ? "expand_less" : "help"}</span>
                      {showInstallGuide ? "Hide" : "How to Install"}
                    </Button>
                  )}
                </div>
              </div>
              {showInstallGuide && tool.docsUrl && (
                <div className="p-4 bg-surface border border-border rounded-lg">
                  <h4 className="font-medium mb-3">Installation Guide</h4>
                  <p className="text-sm text-text-muted">
                    Install {tool.name} following the official instructions at{" "}
                    <a className="text-primary underline" href={tool.docsUrl} target="_blank" rel="noreferrer">{tool.docsUrl}</a>.
                  </p>
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
                  <BaseUrlSelect currentUrl={currentBaseUrl} value={customBaseUrl || getDisplayUrl()} onChange={setCustomBaseUrl}
                    requiresExternalUrl={tool.requiresExternalUrl}
                    tunnelEnabled={tunnelEnabled}
                    tunnelPublicUrl={tunnelPublicUrl}
                    tailscaleEnabled={tailscaleEnabled}
                    tailscaleUrl={tailscaleUrl}
                  />
                </div>

                {currentBaseUrl && (
                  <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[8rem_auto_1fr_auto] sm:items-center sm:gap-2">
                    <span className="text-xs font-semibold text-text-main sm:text-right sm:text-sm">Current</span>
                    <span className="material-symbols-outlined hidden text-text-muted text-[14px] sm:inline">arrow_forward</span>
                    <span className="min-w-0 truncate rounded bg-surface/40 px-2 py-2 text-xs text-text-muted sm:py-1.5">
                      {currentBaseUrl}
                    </span>
                  </div>
                )}

                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[8rem_auto_1fr_auto] sm:items-center sm:gap-2">
                  <span className="text-xs font-semibold text-text-main sm:text-right sm:text-sm">API Key</span>
                  <span className="material-symbols-outlined hidden text-text-muted text-[14px] sm:inline">arrow_forward</span>
                  <ApiKeySelect value={selectedApiKey} onChange={setSelectedApiKey} apiKeys={apiKeys} cloudEnabled={cloudEnabled} />
                </div>

                {isMultiModel(tool.id) && (
                  <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[8rem_auto_1fr] sm:items-start sm:gap-2">
                    <span className="text-xs font-semibold text-text-main sm:text-right sm:text-sm mt-1">Models</span>
                    <span className="material-symbols-outlined hidden text-text-muted text-[14px] sm:inline mt-1.5">arrow_forward</span>
                    <div className="flex flex-col gap-2">
                      <div className="flex flex-wrap gap-1.5 min-h-[36px] p-2 bg-surface rounded border border-border">
                        {selectedModels.length === 0 ? (
                          <span className="text-xs text-text-muted italic">No models selected yet.</span>
                        ) : (
                          selectedModels.map((modelId) => (
                            <span key={modelId} className="inline-flex items-center gap-1.5 px-2 py-1 rounded bg-bg-secondary text-xs text-text-main border border-border">
                              <span>{modelId}</span>
                              <button type="button" onClick={() => setModelsOverride(selectedModels.filter((entry) => entry !== modelId))} aria-label={`Remove ${modelId}`} className="text-text-muted hover:text-red-500 rounded p-0.5">
                                <span className="material-symbols-outlined text-[12px]">close</span>
                              </button>
                            </span>
                          ))
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Button type="button" size="sm" variant="secondary" onClick={() => setModalOpen(true)} disabled={!activeProviders?.length}>
                          <span className="material-symbols-outlined text-[14px] mr-1">add</span>
                          Add Model
                        </Button>
                        {selectedModels.length > 0 && (
                          <button type="button" onClick={() => setModelsOverride([])} className="text-xs text-text-muted hover:text-red-500 ml-auto">Clear all</button>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {hasModelField(tool.id) && (
                  <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[8rem_auto_1fr_auto] sm:items-center sm:gap-2">
                    <span className="text-xs font-semibold text-text-main sm:text-right sm:text-sm">Model</span>
                    <span className="material-symbols-outlined hidden text-text-muted text-[14px] sm:inline">arrow_forward</span>
                    <div className="relative w-full min-w-0">
                      <input type="text" value={selectedModel} onChange={(e) => setModelOverride(e.target.value)} aria-label="Model ID" placeholder="provider/model-id" className="w-full min-w-0 pl-2 pr-7 py-2 bg-surface rounded border border-border text-xs focus:outline-none focus:ring-1 focus:ring-primary/50 sm:py-1.5" />
                      {selectedModel && <button type="button" onClick={() => setModelOverride("")} className="absolute right-1 top-1/2 -translate-y-1/2 p-0.5 text-text-muted hover:text-red-500 rounded transition-colors" title="Clear"><span className="material-symbols-outlined text-[14px]">close</span></button>}
                    </div>
                    <button type="button" onClick={() => setModalOpen(true)} disabled={!activeProviders?.length} className={`w-full sm:w-auto rounded border px-2 py-2 text-xs transition-colors sm:py-1.5 whitespace-nowrap sm:shrink-0 ${activeProviders?.length ? "bg-surface border-border text-text-main hover:border-primary cursor-pointer" : "opacity-50 cursor-not-allowed border-border"}`}>Select Model</button>
                  </div>
                )}
              </div>

              {message && (
                <div className={`flex items-center gap-2 px-2 py-1.5 rounded text-xs ${message.type === "success" ? "bg-green-500/10 text-green-600 dark:text-green-400 dark:bg-green-500/20" : "bg-red-500/10 text-red-600 dark:text-red-400 dark:bg-red-500/20"}`}>
                  <span className="material-symbols-outlined text-[14px]">{message.type === "success" ? "check_circle" : "error"}</span>
                  <span>{message.text}</span>
                </div>
              )}

              <div className="grid grid-cols-1 gap-2 sm:flex sm:items-center">
                <Button variant="primary" size="sm" onClick={handleApply} disabled={modelMissing || (!selectedApiKey && cloudEnabled && apiKeys.length > 0)} loading={applying}>
                  <span className="material-symbols-outlined text-[14px] mr-1">save</span>Apply
                </Button>
                <Button variant="outline" size="sm" onClick={handleReset} disabled={restoring || !status.has9Router} loading={restoring}>
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
        onSelect={(model) => {
          if (isMultiModel(tool.id)) setModelsOverride(selectedModels.includes(model.value) ? selectedModels : [...selectedModels, model.value]);
          else setModelOverride(model.value);
          setModalOpen(false);
        }}
        selectedModel={isMultiModel(tool.id) ? "" : selectedModel}
        activeProviders={activeProviders}
        modelAliases={modelAliases}
        title={`Select Model for ${tool.name}`}
      />

      <ManualConfigModal
        isOpen={showManualConfigModal}
        onClose={() => setShowManualConfigModal(false)}
        title={`${tool.name} - Manual Configuration`}
        configs={getManualConfigs()}
      />
    </Card>
  );
}
