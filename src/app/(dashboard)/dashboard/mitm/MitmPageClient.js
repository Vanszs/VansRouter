"use client";

import { useState, useEffect, useReducer } from "react";
import { MITM_TOOLS } from "@/shared/constants/cliTools";
import { getModelsByProviderId } from "@/shared/constants/models";
import { isOpenAICompatibleProvider, isAnthropicCompatibleProvider } from "@/shared/constants/providers";
import { MitmServerCard, MitmToolCard } from "@/app/(dashboard)/dashboard/cli-tools/components";

function dataReducer(state, action) {
  switch (action.type) {
    case "SET_CONNECTIONS": return { ...state, connections: action.value };
    case "SET_API_KEYS": return { ...state, apiKeys: action.value };
    case "SET_ALIASES": return { ...state, modelAliases: action.value };
    case "SET_CLOUD": return { ...state, cloudEnabled: action.value };
    case "SET_MITM_STATUS": return { ...state, mitmStatus: action.value };
    default: return state;
  }
}

export default function MitmPageClient() {
  const [data, dispatch] = useReducer(dataReducer, {
    connections: [],
    apiKeys: [],
    modelAliases: {},
    cloudEnabled: false,
    mitmStatus: { running: false, certExists: false, dnsStatus: {}, hasCachedPassword: false },
  });
  const { connections, apiKeys, modelAliases, cloudEnabled, mitmStatus } = data;
  const [expandedTool, setExpandedTool] = useState(null);

  /* eslint-disable react-hooks/immutability --
     One-time bootstrap fetch on mount. The fetch* functions are declared
     further down; captured by closure at runtime. */
  useEffect(() => {
    fetchConnections();
    fetchApiKeys();
    fetchAliases();
    fetchCloudSettings();
  }, []);

  const fetchConnections = async () => {
    try {
      const res = await fetch("/api/providers");
      if (res.ok) {
        const d = await res.json();
        dispatch({ type: "SET_CONNECTIONS", value: d.connections || [] });
      }
    } catch { /* ignore */ }
  };

  const fetchApiKeys = async () => {
    try {
      const res = await fetch("/api/keys");
      if (res.ok) {
        const d = await res.json();
        dispatch({ type: "SET_API_KEYS", value: d.keys || [] });
      }
    } catch { /* ignore */ }
  };

  const fetchAliases = async () => {
    try {
      const res = await fetch("/api/models/alias");
      if (res.ok) {
        const d = await res.json();
        dispatch({ type: "SET_ALIASES", value: d.aliases || {} });
      }
    } catch { /* ignore */ }
  };

  const fetchCloudSettings = async () => {
    try {
      const res = await fetch("/api/settings");
      if (res.ok) {
        const d = await res.json();
        dispatch({ type: "SET_CLOUD", value: d.cloudEnabled || false });
      }
    } catch { /* ignore */ }
  };

  const getActiveProviders = () => connections.filter(c => c.isActive !== false);

  const hasActiveProviders = () => {
    const active = getActiveProviders();
    return active.some(conn =>
      getModelsByProviderId(conn.provider).length > 0 ||
      isOpenAICompatibleProvider(conn.provider) ||
      isAnthropicCompatibleProvider(conn.provider)
    );
  };

  const mitmTools = Object.entries(MITM_TOOLS);

  return (
    <div className="flex w-full flex-col gap-6">
      <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-yellow-500/10 border border-yellow-500/30">
        <span className="material-symbols-outlined text-[16px] text-yellow-500 mt-0.5 shrink-0">warning</span>
        <p className="text-xs text-red-600 dark:text-yellow-400 leading-relaxed">
          ⚠️ MITM intercepts HTTPS traffic of IDE tools (Antigravity, GitHub Copilot, Kiro) via local CA to redirect requests to your providers. May violate ToS → account ban. Use at your own risk.
        </p>
      </div>

      {/* MITM Server Card */}
      <MitmServerCard
        apiKeys={apiKeys}
        cloudEnabled={cloudEnabled}
        onStatusChange={(v) => dispatch({ type: "SET_MITM_STATUS", value: v })}
      />

      {/* Tool Cards */}
      <div className="grid gap-3 sm:gap-4">
        {mitmTools.map(([toolId, tool]) => (
          <MitmToolCard
            key={toolId}
            tool={tool}
            status={{ isExpanded: expandedTool === toolId, hasCachedPassword: mitmStatus.hasCachedPassword || false, needsSudoPassword: mitmStatus.needsSudoPassword !== false, isWin: mitmStatus.isWin === true }}
            onToggle={() => setExpandedTool(expandedTool === toolId ? null : toolId)}
            serverRunning={mitmStatus.running}
            dnsActive={mitmStatus.dnsStatus?.[toolId] || false}
            apiKeys={apiKeys}
            activeProviders={getActiveProviders()}
            hasActiveProviders={hasActiveProviders()}
            modelAliases={modelAliases}
            cloudEnabled={cloudEnabled}
            onDnsChange={(d) => dispatch({ type: "SET_MITM_STATUS", value: { ...mitmStatus, dnsStatus: d.dnsStatus ?? mitmStatus.dnsStatus } })}
          />
        ))}
      </div>
    </div>
  );
}
