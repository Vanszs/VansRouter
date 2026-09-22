"use client";

import { useState, useEffect, useRef } from "react";
import useCliToolLifecycle from "./useCliToolLifecycle";
import { Card, Button, ModelSelectModal, ManualConfigModal, Tooltip } from "@/shared/components";
import Image from "next/image";
import BaseUrlSelect from "./BaseUrlSelect";
import { rememberEndpoint } from "./cliEndpointPresets";
import ApiKeySelect from "./ApiKeySelect";
import { matchKnownEndpoint } from "./cliEndpointMatch";
import { stripModelContextMarker } from "open-sse/utils/modelMarkers.js";

const CLOUD_URL = process.env.NEXT_PUBLIC_CLOUD_URL;

// Auto-compact window presets (CLAUDE_CODE_AUTO_COMPACT_WINDOW, valid 100K–1M).
// UI shows the round number; the value written is nudged down 2K to stay safely
// under the upstream hard cap.
const CONTEXT_OPTIONS = [
  { label: "Default", value: "" },
  { label: "200K", value: "198000" },
  { label: "300K", value: "298000" },
  { label: "500K", value: "498000" },
  { label: "700K", value: "698000" },
];

function ClaudeExpandedSection({ applying, apiKeys, autoCompactWindow, ccFilterNaming, checkingClaude, cloudEnabled, claudeStatus, customBaseUrl, getDisplayUrl, handleApplySettings, handleCcFilterNamingToggle, handleOneMContextToggle, handleResetSettings, hasActiveProviders, message, modelMappings, onAutoCompactWindowChange, onModelMappingChange, oneMContext, openModelSelector, restoring, selectedApiKey, setCustomBaseUrl, setSelectedApiKey, setShowInstallGuide, setShowManualConfigModal, showInstallGuide, tailscaleEnabled, tailscaleUrl, tool, tunnelEnabled, tunnelPublicUrl }) {
  return (
        <div className="mt-4 pt-4 border-t border-border flex flex-col gap-4">
          {checkingClaude && (
            <div className="flex items-center gap-2 text-text-muted">
              <span className="material-symbols-outlined animate-spin">progress_activity</span>
              <span>Checking Claude CLI...</span>
            </div>
          )}

          {!checkingClaude && claudeStatus && !claudeStatus.installed && (
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-3 p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
                <div className="flex items-start gap-3">
                  <span className="material-symbols-outlined text-yellow-500">warning</span>
                  <div className="flex-1">
                    <p className="font-medium text-yellow-600 dark:text-yellow-400">Claude CLI not detected locally</p>
                    <p className="text-sm text-text-muted">Manual configuration is still available if VansAI is deployed on a remote server.</p>
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
                  <div className="space-y-3 text-sm">
                    <div>
                      <p className="text-text-muted mb-1">macOS / Linux / Windows:</p>
                      <code className="block px-3 py-2 bg-black/5 dark:bg-white/5 rounded font-mono text-xs">npm install -g @anthropic-ai/claude-code</code>
                    </div>
                    <p className="text-text-muted">After installation, run <code className="px-1 bg-black/5 dark:bg-white/5 rounded">claude</code> to verify.</p>
                  </div>
                </div>
              )}
            </div>
          )}

          {!checkingClaude && claudeStatus?.installed && (
            <>
              <div className="flex flex-col gap-2">
                {/* Endpoint (selector) */}
                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[8rem_auto_1fr] sm:items-center sm:gap-2">
                  <span className="text-xs font-semibold text-text-main sm:text-right sm:text-sm">Select Endpoint</span>
                  <span className="material-symbols-outlined hidden text-text-muted text-[14px] sm:inline">arrow_forward</span>
                  <BaseUrlSelect currentUrl={claudeStatus?.settings?.env?.ANTHROPIC_BASE_URL || ""} value={customBaseUrl || getDisplayUrl()}
                    onChange={setCustomBaseUrl}
                    requiresExternalUrl={tool.requiresExternalUrl}
                    tunnelEnabled={tunnelEnabled}
                    tunnelPublicUrl={tunnelPublicUrl}
                    tailscaleEnabled={tailscaleEnabled}
                    tailscaleUrl={tailscaleUrl}
                  />
                </div>

                {/* Current configured */}
                {claudeStatus?.settings?.env?.ANTHROPIC_BASE_URL && (
                  <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[8rem_auto_1fr_auto] sm:items-center sm:gap-2">
                    <span className="text-xs font-semibold text-text-main sm:text-right sm:text-sm">Current</span>
                    <span className="material-symbols-outlined hidden text-text-muted text-[14px] sm:inline">arrow_forward</span>
                    <span className="min-w-0 truncate rounded bg-surface/40 px-2 py-2 text-xs text-text-muted sm:py-1.5">
                      {claudeStatus.settings.env.ANTHROPIC_BASE_URL}
                    </span>
                  </div>
                )}

                {/* API Key */}
                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[8rem_auto_1fr_auto] sm:items-center sm:gap-2">
                  <span className="text-xs font-semibold text-text-main sm:text-right sm:text-sm">API Key</span>
                  <span className="material-symbols-outlined hidden text-text-muted text-[14px] sm:inline">arrow_forward</span>
                  <ApiKeySelect value={selectedApiKey} onChange={setSelectedApiKey} apiKeys={apiKeys} cloudEnabled={cloudEnabled} />
                </div>

                {/* Model Mappings */}
                {tool.defaultModels.map((model) => (
                  <div key={model.alias} className="grid grid-cols-1 gap-1.5 sm:grid-cols-[8rem_auto_1fr_auto] sm:items-center sm:gap-2">
                    <span className="text-xs font-semibold text-text-main sm:text-right sm:text-sm">{model.name}</span>
                    <span className="material-symbols-outlined hidden text-text-muted text-[14px] sm:inline">arrow_forward</span>
                    <div className="relative w-full min-w-0">
                      <input type="text" value={modelMappings[model.alias] || ""} onChange={(e) => onModelMappingChange(model.alias, e.target.value)} aria-label="Model ID" placeholder="provider/model-id" className="w-full min-w-0 pl-2 pr-7 py-2 bg-surface rounded border border-border text-xs focus:outline-none focus:ring-1 focus:ring-primary/50 sm:py-1.5" />
                      {modelMappings[model.alias] && <button type="button" onClick={() => onModelMappingChange(model.alias, "")} className="absolute right-1 top-1/2 -translate-y-1/2 p-0.5 text-text-muted hover:text-red-500 rounded transition-colors" title="Clear"><span className="material-symbols-outlined text-[14px]">close</span></button>}
                    </div>
                    <button type="button" onClick={() => openModelSelector(model.alias)} disabled={!hasActiveProviders} className={`w-full sm:w-auto rounded border px-2 py-2 text-xs transition-colors sm:py-1.5 whitespace-nowrap sm:shrink-0 ${hasActiveProviders ? "bg-surface border-border text-text-main hover:border-primary cursor-pointer" : "opacity-50 cursor-not-allowed border-border"}`}>Select Model</button>
                  </div>
                ))}

                {/* Auto-compact window */}
                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[8rem_auto_1fr_auto] sm:items-center sm:gap-2">
                  <span className="text-xs font-semibold text-text-main sm:text-right sm:text-sm">Auto-compact</span>
                  <span className="material-symbols-outlined hidden text-text-muted text-[14px] sm:inline">arrow_forward</span>
                  <select value={autoCompactWindow} onChange={(e) => onAutoCompactWindowChange(e.target.value)} className="w-full min-w-0 px-2 py-2 bg-surface rounded text-xs border border-border focus:outline-none focus:ring-1 focus:ring-primary/50 sm:py-1.5">
                    {CONTEXT_OPTIONS.map((opt) => (
                      <option key={opt.label} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </div>

                {/* 1M context */}
                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[8rem_auto_1fr_auto] sm:items-center sm:gap-2">
                  <span className="text-xs font-semibold text-text-main sm:text-right sm:text-sm">1M context</span>
                  <span className="material-symbols-outlined hidden text-text-muted text-[14px] sm:inline">arrow_forward</span>
                  <label className="flex items-center gap-1.5 cursor-pointer select-none">
                    <input type="checkbox" checked={oneMContext} onChange={handleOneMContextToggle} className="w-3.5 h-3.5 accent-primary cursor-pointer" />
                    <span className="text-xs text-text-muted">Append [1m] to the model name</span>
                    <Tooltip text="Claude Code otherwise assumes a 200K window, which clamps the auto-compact window above. Applied to every mapped model — only enable it for models that really accept 1M.">
                      <span className="material-symbols-outlined text-text-muted text-[14px] cursor-help">info</span>
                    </Tooltip>
                  </label>
                </div>

                {/* CC Filter Naming */}
                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[8rem_auto_1fr_auto] sm:items-center sm:gap-2">
                  <span className="text-xs font-semibold text-text-main sm:text-right sm:text-sm">Filter naming</span>
                  <span className="material-symbols-outlined hidden text-text-muted text-[14px] sm:inline">arrow_forward</span>
                  <label className="flex items-center gap-1.5 cursor-pointer select-none">
                    <input type="checkbox" checked={ccFilterNaming} onChange={handleCcFilterNamingToggle} className="w-3.5 h-3.5 accent-primary cursor-pointer" />
                    <span className="text-xs text-text-muted">Filter naming requests</span>
                    <Tooltip text="Intercepts Claude Code's topic-naming requests and returns a fake response locally, saving API tokens.">
                      <span className="material-symbols-outlined text-text-muted text-[14px] cursor-help">info</span>
                    </Tooltip>
                  </label>
                </div>
              </div>

              {message && (
                <div className={`flex items-center gap-2 px-2 py-1.5 rounded text-xs ${message.type === "success" ? "bg-green-500/10 text-green-600 dark:text-green-400 dark:bg-green-500/20" : "bg-red-500/10 text-red-600 dark:text-red-400 dark:bg-red-500/20"}`}>
                  <span className="material-symbols-outlined text-[14px]">{message.type === "success" ? "check_circle" : "error"}</span>
                  <span>{message.text}</span>
                </div>
              )}

              <div className="grid grid-cols-1 gap-2 sm:flex sm:items-center">
                <Button variant="primary" size="sm" onClick={handleApplySettings} disabled={!hasActiveProviders} loading={applying}>
                  <span className="material-symbols-outlined text-[14px] mr-1">save</span>Apply
                </Button>
                <Button variant="outline" size="sm" onClick={handleResetSettings} disabled={!claudeStatus?.hasVansRoute} loading={restoring}>
                  <span className="material-symbols-outlined text-[14px] mr-1">restore</span>Reset
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setShowManualConfigModal(true)}>
                  <span className="material-symbols-outlined text-[14px] mr-1">content_copy</span>Manual Config
                </Button>
              </div>
            </>
          )}
        </div>
  );
}


export default function ClaudeToolCard({
  tool,
  isExpanded,
  onToggle,
  activeProviders,
  modelMappings,
  onModelMappingChange,
  baseUrl,
  hasActiveProviders,
  apiKeys,
  cloudEnabled,
  initialStatus,
  tunnelEnabled,
  tunnelPublicUrl,
  tailscaleEnabled,
  tailscaleUrl,
}) {
  const {
    status: claudeStatus, checking: checkingClaude, applying, restoring, message, dispatch,
    customBaseUrl, getDisplayUrl, getEffectiveBaseUrl, handleToggle, modelAliases,
    selectedApiKey, setCustomBaseUrl, setSelectedApiKey,
  } = useCliToolLifecycle({
    apiKeys, baseUrl, cloudEnabled, initialStatus, isExpanded, onToggle,
    statusEndpoint: "/api/cli-tools/claude-settings",
    getInitialApiKey: (status, keys) => {
      const token = status?.settings?.env?.ANTHROPIC_AUTH_TOKEN;
      return token && keys?.some((key) => key.key === token) ? token : keys?.[0]?.key || "";
    },
  });
  const [showInstallGuide, setShowInstallGuide] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [currentEditingAlias, setCurrentEditingAlias] = useState(null);
  const [showManualConfigModal, setShowManualConfigModal] = useState(false);
  const [ccFilterNaming, setCcFilterNaming] = useState(false);
  const [autoCompactWindowOverride, setAutoCompactWindowOverride] = useState(null);
  const hasInitializedModels = useRef(false);

  // Derived, not synced into state: the select follows the settings file until the
  // user picks a value, so a status refresh cannot overwrite a pending choice.
  const autoCompactWindow = autoCompactWindowOverride ?? claudeStatus?.settings?.env?.CLAUDE_CODE_AUTO_COMPACT_WINDOW ?? "";
  const oneMContext = tool.defaultModels.some((model) => modelMappings[model.alias]?.endsWith("[1m]"));

  const getConfigStatus = () => {
    if (!claudeStatus?.installed) return null;
    const currentUrl = claudeStatus.settings?.env?.ANTHROPIC_BASE_URL;
    if (!currentUrl) return "not_configured";
    if (matchKnownEndpoint(currentUrl, { tunnelPublicUrl, tailscaleUrl, cloudUrl: cloudEnabled ? CLOUD_URL : null })) return "configured";
    return "other";
  };

  const configStatus = getConfigStatus();

  useEffect(() => {
    fetch("/api/settings").then(r => r.json()).then(data => {
      setCcFilterNaming(!!data.ccFilterNaming);
    }).catch(() => {});
  }, []);

  const handleCcFilterNamingToggle = async (e) => {
    const value = e.target.checked;
    setCcFilterNaming(value);
    await fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ccFilterNaming: value }),
    }).catch(() => {});
  };

  // Claude Code only string-matches the marker against the model name, so it
  // applies to any id — the user decides which models are worth declaring as 1M.
  // Stripping first keeps repeated toggles from stacking `[1m][1m]`.
  const handleOneMContextToggle = (e) => {
    const enabled = e.target.checked;
    tool.defaultModels.forEach((model) => {
      const current = modelMappings[model.alias];
      if (!current) return;
      const { model: bare } = stripModelContextMarker(current);
      onModelMappingChange(model.alias, enabled ? `${bare}[1m]` : bare);
    });
  };
  useEffect(() => {
    if (claudeStatus?.installed && !hasInitializedModels.current) {
      hasInitializedModels.current = true;
      const env = claudeStatus.settings?.env || {};

      tool.defaultModels.forEach((model) => {
        if (model.envKey) {
          const value = env[model.envKey] || model.defaultValue || "";
          // Only sync initial values from file once
          if (value) {
            onModelMappingChange(model.alias, value);
          }
        }
      });
    }
  }, [claudeStatus, tool.defaultModels, onModelMappingChange]);
  const handleApplySettings = async () => {
    dispatch({ type: "APPLY_START" });
    try {
      const env = { ANTHROPIC_BASE_URL: getEffectiveBaseUrl() };

      // Get key from dropdown, fallback to first key or sk_VansRoute for localhost
      const keyToUse = selectedApiKey?.trim()
        || (apiKeys?.length > 0 ? apiKeys[0].key : null)
        || (!cloudEnabled ? "sk_VansRoute" : null);

      if (keyToUse) {
        env.ANTHROPIC_AUTH_TOKEN = keyToUse;
      }

      tool.defaultModels.forEach((model) => {
        const targetModel = modelMappings[model.alias];
        // Written verbatim — the input may hold a marker typed by hand, and the
        // toggle already decided the marker when it was flipped.
        if (targetModel && model.envKey) env[model.envKey] = targetModel;
      });
      if (autoCompactWindow) {
        env.CLAUDE_CODE_AUTO_COMPACT_WINDOW = autoCompactWindow;
      }
      const res = await fetch("/api/cli-tools/claude-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ env, autoCompactWindow }),
      });
      const data = await res.json();
      if (res.ok) {
        dispatch({ type: "APPLY_DONE", message: { type: "success", text: "Settings applied successfully!" } });
        dispatch({ type: "CHECK_DONE", data: { ...claudeStatus, hasBackup: true, settings: { ...claudeStatus?.settings, env } } });
      } else {
        dispatch({ type: "APPLY_DONE", message: { type: "error", text: data.error || "Failed to apply settings" } });
      }
    } catch (error) {
      dispatch({ type: "APPLY_DONE", message: { type: "error", text: error.message } });
    }
  };

  const handleResetSettings = async () => {
    dispatch({ type: "RESTORE_START" });
    try {
      const res = await fetch("/api/cli-tools/claude-settings", { method: "DELETE" });
      const data = await res.json();
      if (res.ok) {
        dispatch({ type: "RESTORE_DONE", message: { type: "success", text: "Settings reset successfully!" } });
        tool.defaultModels.forEach((model) => onModelMappingChange(model.alias, model.defaultValue || ""));
        setSelectedApiKey("");
        setAutoCompactWindowOverride("");
      } else {
        dispatch({ type: "RESTORE_DONE", message: { type: "error", text: data.error || "Failed to reset settings" } });
      }
    } catch (error) {
      dispatch({ type: "RESTORE_DONE", message: { type: "error", text: error.message } });
    }
  };

  const openModelSelector = (alias) => {
    setCurrentEditingAlias(alias);
    setModalOpen(true);
  };

  const handleModelSelect = (model) => {
    if (currentEditingAlias) onModelMappingChange(currentEditingAlias, model.value);
  };

  // Generate settings.json content for manual copy
  const getManualConfigs = () => {
    const keyToUse = (selectedApiKey && selectedApiKey.trim())
      ? selectedApiKey
      : (!cloudEnabled ? "sk_VansRoute" : "<API_KEY_FROM_DASHBOARD>");
    const env = { ANTHROPIC_BASE_URL: getEffectiveBaseUrl(), ANTHROPIC_AUTH_TOKEN: keyToUse };
    tool.defaultModels.forEach((model) => {
      const targetModel = modelMappings[model.alias];
      if (targetModel && model.envKey) env[model.envKey] = targetModel;
    });
    if (autoCompactWindow) {
      env.CLAUDE_CODE_AUTO_COMPACT_WINDOW = autoCompactWindow;
    }

    return [
      {
        filename: "~/.claude/settings.json",
        content: JSON.stringify({ hasCompletedOnboarding: true, env }, null, 2),
      },
    ];
  };

  return (
    <Card padding="xs" className="overflow-hidden">
      <button type="button" className="flex w-full items-start justify-between gap-3 hover:cursor-pointer sm:items-center text-left" onClick={handleToggle} aria-expanded={isExpanded} aria-label="Toggle section">
        <div className="flex min-w-0 items-center gap-3">
          <div className="size-8 flex items-center justify-center shrink-0">
            <Image src="/providers/claude.webp" alt={tool.name} width={32} height={32} className="size-8 object-contain rounded-lg" sizes="32px" onError={(e) => { e.target.style.display = "none"; }} />
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

      {isExpanded && <ClaudeExpandedSection
        applying={applying}
        apiKeys={apiKeys}
        autoCompactWindow={autoCompactWindow}
        ccFilterNaming={ccFilterNaming}
        checkingClaude={checkingClaude}
        cloudEnabled={cloudEnabled}
        claudeStatus={claudeStatus}
        customBaseUrl={customBaseUrl}
        getDisplayUrl={getDisplayUrl}
        handleApplySettings={handleApplySettings}
        handleCcFilterNamingToggle={handleCcFilterNamingToggle}
        handleOneMContextToggle={handleOneMContextToggle}
        handleResetSettings={handleResetSettings}
        hasActiveProviders={hasActiveProviders}
        message={message}
        modelMappings={modelMappings}
        onAutoCompactWindowChange={setAutoCompactWindowOverride}
        onModelMappingChange={onModelMappingChange}
        oneMContext={oneMContext}
        openModelSelector={openModelSelector}
        restoring={restoring}
        selectedApiKey={selectedApiKey}
        setCustomBaseUrl={setCustomBaseUrl}
        setSelectedApiKey={setSelectedApiKey}
        setShowInstallGuide={setShowInstallGuide}
        setShowManualConfigModal={setShowManualConfigModal}
        showInstallGuide={showInstallGuide}
        tailscaleEnabled={tailscaleEnabled}
        tailscaleUrl={tailscaleUrl}
        tool={tool}
        tunnelEnabled={tunnelEnabled}
        tunnelPublicUrl={tunnelPublicUrl}
      />}

      <ModelSelectModal isOpen={modalOpen} onClose={() => setModalOpen(false)} onSelect={handleModelSelect} selectedModel={currentEditingAlias ? modelMappings[currentEditingAlias] : null} activeProviders={activeProviders} modelAliases={modelAliases} title={`Select model for ${currentEditingAlias}`} />

      <ManualConfigModal
        isOpen={showManualConfigModal}
        onClose={() => setShowManualConfigModal(false)}
        title="Claude CLI - Manual Configuration"
        configs={getManualConfigs()}
      />
    </Card>
  );
}
