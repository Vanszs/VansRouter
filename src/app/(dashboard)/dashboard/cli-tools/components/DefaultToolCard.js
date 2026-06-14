"use client";

import { useState } from "react";
import { Card, ModelSelectModal } from "@/shared/components";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";
import Image from "next/image";
import ApiKeySelect from "./ApiKeySelect";

const EMPTY_ACTIVE_PROVIDERS = [];

function ToolIcon({ tool, toolId }) {
  if (tool.image) {
    return (
      <Image
        src={tool.image}
        alt={tool.name}
        width={32}
        height={32}
        className="size-8 object-contain rounded-lg"
        sizes="32px"
        onError={(e) => { e.target.style.display = "none"; }}
      />
    );
  }
  if (tool.icon) {
    return <span className="material-symbols-outlined text-xl" style={{ color: tool.color }}>{tool.icon}</span>;
  }
  return (
    <Image
      src={`/providers/${toolId}.png`}
      alt={tool.name}
      width={32}
      height={32}
      className="size-8 object-contain rounded-lg"
      sizes="32px"
      onError={(e) => { e.target.style.display = "none"; }}
    />
  );
}

function ToolNotes({ notes, cloudEnabled, tunnelEnabled }) {
  if (!notes || notes.length === 0) return null;
  return (
    <div className="flex flex-col gap-2 mb-4">
      {notes.map((note) => {
        if (note.type === "cloudCheck" && (cloudEnabled || tunnelEnabled)) return null;
        const isWarning = note.type === "warning";
        const isError = note.type === "cloudCheck" && !cloudEnabled && !tunnelEnabled;
        let bgClass = "bg-blue-500/10 border-blue-500/30";
        let textClass = "text-blue-600 dark:text-blue-400";
        let iconClass = "text-blue-500";
        let icon = "info";
        if (isWarning) {
          bgClass = "bg-yellow-500/10 border-yellow-500/30";
          textClass = "text-yellow-600 dark:text-yellow-400";
          iconClass = "text-yellow-500";
          icon = "warning";
        } else if (isError) {
          bgClass = "bg-red-500/10 border-red-500/30";
          textClass = "text-red-600 dark:text-red-400";
          iconClass = "text-red-500";
          icon = "error";
        }
        return (
          <div key={`${note.type}-${note.text}`} className={`flex items-start gap-3 p-3 rounded-lg border ${bgClass}`}>
            <span className={`material-symbols-outlined text-lg ${iconClass}`}>{icon}</span>
            <p className={`text-sm ${textClass}`}>{note.text}</p>
          </div>
        );
      })}
    </div>
  );
}

export default function DefaultToolCard({ toolId, tool, isExpanded, onToggle, baseUrl, apiKeys, activeProviders = EMPTY_ACTIVE_PROVIDERS, cloudEnabled = false, tunnelEnabled = false }) {
  const [copiedField, setCopiedField] = useState(null);
  const [showModelModal, setShowModelModal] = useState(false);
  const [modelValue, setModelValue] = useState("");
  
  // Initialize state directly with computed value - no need for useEffect
  const [selectedApiKey, setSelectedApiKey] = useState(() => 
    apiKeys?.length > 0 ? apiKeys[0].key : ""
  );

  const replaceVars = (text) => {
    const keyToUse = (selectedApiKey && selectedApiKey.trim()) 
      ? selectedApiKey 
      : (!cloudEnabled ? "sk_9router" : "your-api-key");
    
    // Add /v1 suffix only if not already present (DRY - avoid duplicate)
    const normalizedBaseUrl = baseUrl || "http://localhost:20128";
    const baseUrlWithV1 = normalizedBaseUrl.endsWith("/v1") 
      ? normalizedBaseUrl 
      : `${normalizedBaseUrl}/v1`;
    
    return text
      .replace(/\{\{baseUrl\}\}/g, baseUrlWithV1)
      .replace(/\{\{apiKey\}\}/g, keyToUse)
      .replace(/\{\{model\}\}/g, modelValue || "provider/model-id");
  };

  const { copy: copyToClipboard } = useCopyToClipboard();

  const handleCopy = async (text, field) => {
    await copyToClipboard(replaceVars(text), `toolcard-${field}`);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  };

  const handleSelectModel = (model) => {
    setModelValue(model.value);
  };

  const hasActiveProviders = activeProviders.length > 0;

  const renderApiKeySelector = () => (
    <div className="mt-2 flex flex-col sm:flex-row sm:items-center gap-2">
      <ApiKeySelect value={selectedApiKey} onChange={setSelectedApiKey} apiKeys={apiKeys} cloudEnabled={cloudEnabled} className="flex-1" />
    </div>
  );

  const renderModelSelector = () => {
    return (
      <div className="mt-2 flex flex-col sm:flex-row sm:items-center gap-2">
        <input
          type="text"
          value={modelValue}
          onChange={(e) => setModelValue(e.target.value)}
          placeholder="provider/model-id"
          aria-label="Model ID"
          className="w-full sm:w-auto flex-1 px-3 py-2 bg-bg-secondary rounded-lg text-sm border border-border focus:outline-none focus:ring-1 focus:ring-primary/50"
        />
        <button type="button"
          onClick={() => setShowModelModal(true)}
          disabled={!hasActiveProviders}
          className={`shrink-0 px-3 py-2 rounded-lg border text-sm transition-colors ${
            hasActiveProviders
              ? "bg-bg-secondary border-border text-text-main hover:border-primary cursor-pointer"
              : "opacity-50 cursor-not-allowed border-border"
          }`}
        >
          Select Model
        </button>
        {modelValue && (
          <>
            <button type="button"
              onClick={() => handleCopy(modelValue, "model")}
              className="shrink-0 px-3 py-2 bg-bg-secondary hover:bg-bg-tertiary rounded-lg border border-border transition-colors"
            >
              <span className="material-symbols-outlined text-lg">
                {copiedField === "model" ? "check" : "content_copy"}
              </span>
            </button>
            <button type="button"
              onClick={() => setModelValue("")}
              className="p-2 text-text-muted hover:text-red-500 rounded transition-colors"
              title="Clear"
            >
              <span className="material-symbols-outlined text-lg">close</span>
            </button>
          </>
        )}
      </div>
    );
  };

  const canShowGuide = () => {
    if (tool.requiresExternalUrl && !cloudEnabled && !tunnelEnabled) return false;
    if (tool.requiresCloud && !cloudEnabled) return false;
    return true;
  };

  const guideStepsContent = !tool.guideSteps ? <p className="text-text-muted text-sm">Coming soon...</p> : (
    <div className="flex flex-col gap-4">
      <ToolNotes notes={tool.notes} cloudEnabled={cloudEnabled} tunnelEnabled={tunnelEnabled} />
      {canShowGuide() && tool.guideSteps.map((item) => (
        <div key={item.step} className="flex items-start gap-4">
          <div 
            className="size-8 rounded-full flex items-center justify-center shrink-0 text-sm font-semibold text-white"
            style={{ backgroundColor: tool.color }}
          >
            {item.step}
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-medium text-text">{item.title}</p>
            {item.desc && <p className="text-sm text-text-muted mt-0.5">{item.desc}</p>}
            {item.type === "apiKeySelector" && renderApiKeySelector()}
            {item.type === "modelSelector" && renderModelSelector()}
            {item.value && (
              <div className="mt-2 flex flex-col sm:flex-row sm:items-center gap-2">
                <code className="w-full sm:w-auto flex-1 px-3 py-2 bg-bg-secondary rounded-lg text-sm font-mono border border-border truncate">
                  {replaceVars(item.value)}
                </code>
                {item.copyable && (
                  <button type="button"
                    onClick={() => handleCopy(item.value, `${item.step}-${item.title}`)}
                    className="shrink-0 px-3 py-2 bg-bg-secondary hover:bg-bg-tertiary rounded-lg border border-border transition-colors"
                  >
                    <span className="material-symbols-outlined text-lg">
                      {copiedField === `${item.step}-${item.title}` ? "check" : "content_copy"}
                    </span>
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      ))}

      {canShowGuide() && tool.codeBlock && (
        <div className="mt-2">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-text-muted uppercase tracking-wide">{tool.codeBlock.language}</span>
            <button type="button"
              onClick={() => handleCopy(tool.codeBlock.code, "codeblock")}
              className="flex items-center gap-1 px-2 py-1 text-xs bg-bg-secondary hover:bg-bg-tertiary rounded border border-border transition-colors"
            >
              <span className="material-symbols-outlined text-sm">
                {copiedField === "codeblock" ? "check" : "content_copy"}
              </span>
              {copiedField === "codeblock" ? "Copied!" : "Copy"}
            </button>
          </div>
          <pre className="p-4 bg-bg-secondary rounded-lg border border-border overflow-x-auto">
            <code className="text-sm font-mono whitespace-pre">{replaceVars(tool.codeBlock.code)}</code>
          </pre>
        </div>
      )}
    </div>
  );

  return (
    <Card padding="xs" className="overflow-hidden overflow-x-hidden">
      <button type="button" className="flex w-full items-center justify-between hover:cursor-pointer text-left" onClick={onToggle} aria-expanded={isExpanded} aria-label="Toggle section">
        <div className="flex items-center gap-3">
          <div className="size-8 rounded-lg flex items-center justify-center shrink-0">
            <ToolIcon tool={tool} toolId={toolId} />
          </div>
          <div className="min-w-0">
            <h3 className="font-medium text-sm">{tool.name}</h3>
            <p className="text-xs text-text-muted truncate">{tool.description}</p>
          </div>
        </div>
        <span className={`material-symbols-outlined text-text-muted text-[20px] transition-transform ${isExpanded ? "rotate-180" : ""}`}>expand_more</span>
      </button>

      {isExpanded && (
        <div className="mt-6 pt-6 border-t border-border">
          {guideStepsContent}
        </div>
      )}

      <ModelSelectModal
        isOpen={showModelModal}
        onClose={() => setShowModelModal(false)}
        onSelect={handleSelectModel}
        selectedModel={modelValue}
        activeProviders={activeProviders}
        title="Select Model"
      />
    </Card>
  );
}

