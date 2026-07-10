"use client";

import { useMemo, useState, useEffect, useCallback, useRef } from "react";
import Image from "next/image";

const EMPTY_PROVIDERS = [];
const EMPTY_REQUESTS = [];
import {
  ReactFlow,
  Handle,
  Position,
  Controls,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { AI_PROVIDERS } from "@/shared/constants/providers";

// Force-stop FE animation if a provider stays active longer than this
const FE_ACTIVE_TIMEOUT_MS = 60000;
const FE_ACTIVE_TICK_MS = 1000;
const FIT_VIEW_OPTS = { padding: 0.2, duration: 200 };

function getProviderConfig(providerId) {
  return AI_PROVIDERS[providerId] || { color: "#6b7280", name: providerId };
}

// Use local provider images from /public/providers/
function getProviderImageUrl(providerId) {
  return `/providers/${providerId}.webp${providerId === "autoclaw" ? "?v=2" : ""}`;
}

// Custom provider node - rectangle with image + name
function ProviderNode({ data }) {
  const { label, color, imageUrl, textIcon, active } = data;
  const [imgError, setImgError] = useState(false);
  return (
    <div
      className="flex items-center gap-2.5 px-4 py-2.5 rounded-lg border-2 transition-all duration-300 bg-bg"
      style={{
        borderColor: active ? color : "var(--color-border)",
        boxShadow: active ? `0 0 16px ${color}40` : "none",
        minWidth: "150px",
      }}
    >
      <Handle type="target" position={Position.Top} id="top" className="!bg-transparent !border-0 !w-0 !h-0" />
      <Handle type="target" position={Position.Bottom} id="bottom" className="!bg-transparent !border-0 !w-0 !h-0" />
      <Handle type="target" position={Position.Left} id="left" className="!bg-transparent !border-0 !w-0 !h-0" />
      <Handle type="target" position={Position.Right} id="right" className="!bg-transparent !border-0 !w-0 !h-0" />

      {/* Provider icon */}
      <div
        className="w-8 h-8 rounded-md flex items-center justify-center shrink-0"
        style={{ backgroundColor: `${color}15` }}
      >
        {!imgError ? (
          <Image src={imageUrl} alt={label} className="w-6 h-6 rounded-sm object-contain" width={24} height={24} onError={() => setImgError(true)} unoptimized />
        ) : (
          <span className="text-sm font-bold" style={{ color }}>{textIcon}</span>
        )}
      </div>

      {/* Provider name */}
      <span
        className="text-base font-medium truncate"
        style={{ color: active ? color : "var(--color-text)" }}
      >
        {label}
      </span>

      {/* Active indicator */}
      {active && (
        <span className="relative flex h-2 w-2 shrink-0">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75" style={{ backgroundColor: color }} />
          <span className="relative inline-flex rounded-full h-2 w-2" style={{ backgroundColor: color }} />
        </span>
      )}
    </div>
  );
}


// Center 9Router node
function RouterNode({ data }) {
  return (
    <div className="flex items-center justify-center px-5 py-3 rounded-xl border-2 border-primary bg-primary/5 shadow-md min-w-[130px]">
      <Handle type="source" position={Position.Top} id="top" className="!bg-transparent !border-0 !w-0 !h-0" />
      <Handle type="source" position={Position.Bottom} id="bottom" className="!bg-transparent !border-0 !w-0 !h-0" />
      <Handle type="source" position={Position.Left} id="left" className="!bg-transparent !border-0 !w-0 !h-0" />
      <Handle type="source" position={Position.Right} id="right" className="!bg-transparent !border-0 !w-0 !h-0" />

      <Image src="/favicon.svg" alt="VansAI" className="w-6 h-6 mr-2" width={24} height={24} />
      <span className="text-sm font-bold text-primary">VansAI</span>
      {data.activeCount > 0 && (
        <span className="ml-2 px-1.5 py-0.5 rounded-full bg-primary text-white text-xs font-bold">
          {data.activeCount}
        </span>
      )}
    </div>
  );
}


const nodeTypes = { provider: ProviderNode, router: RouterNode };

// Place N nodes evenly along an ellipse around the router center.
function buildLayout(providers, activeSet, lastSet, errorSet) {
  const nodeW = 180;
  const nodeH = 30;
  const routerW = 120;
  const routerH = 44;
  const nodeGap = 24;

  const count = providers.length;

  // Compute rx so arc spacing between nodes >= nodeW + nodeGap
  const minRx = ((nodeW + nodeGap) * count) / (2 * Math.PI);
  const rx = Math.max(320, minRx);
  const ry = Math.max(200, rx * 0.55); // ellipse ratio ~0.55
  if (count === 0) {
    return {
      nodes: [{ id: "router", type: "router", position: { x: 0, y: 0 }, data: { activeCount: 0 }, draggable: false }],
      edges: [],
    };
  }

  const nodes = [];
  const edges = [];

  nodes.push({
    id: "router",
    type: "router",
    position: { x: -routerW / 2, y: -routerH / 2 },
    data: { activeCount: activeSet.size },
    draggable: false,
  });

  const edgeStyle = (active, last, error, color) => {
    if (error) return { stroke: "#ef4444", strokeWidth: 2.5, opacity: 0.9 };
    if (active) return { stroke: "#22c55e", strokeWidth: 2.5, opacity: 0.9 };
    if (last) return { stroke: "#f59e0b", strokeWidth: 2, opacity: 0.7 };
    return { stroke: "var(--color-border)", strokeWidth: 1, opacity: 0.3 };
  };

  providers.forEach((p, i) => {
    const config = getProviderConfig(p.provider);
    const active = activeSet.has(p.provider?.toLowerCase());
    const last = !active && lastSet.has(p.provider?.toLowerCase());
    const error = !active && errorSet.has(p.provider?.toLowerCase());
    const nodeId = `provider-${p.provider}`;
    const data = {
      label: (config.name !== p.provider ? config.name : null) || p.nodeName || p.name || p.provider,
      color: config.color || "#6b7280",
      imageUrl: getProviderImageUrl(p.provider),
      textIcon: config.textIcon || (p.provider || "?").slice(0, 2).toUpperCase(),
      active,
    };

    // Distribute evenly starting from top (−π/2), clockwise
    const angle = -Math.PI / 2 + (2 * Math.PI * i) / count;
    const cx = rx * Math.cos(angle);
    const cy = ry * Math.sin(angle);

    // Pick router handle closest to the node direction
    let sourceHandle, targetHandle;
    if (Math.abs(angle + Math.PI / 2) < Math.PI / 4 || Math.abs(angle - 3 * Math.PI / 2) < Math.PI / 4) {
      sourceHandle = "top"; targetHandle = "bottom";
    } else if (Math.abs(angle - Math.PI / 2) < Math.PI / 4) {
      sourceHandle = "bottom"; targetHandle = "top";
    } else if (cx > 0) {
      sourceHandle = "right"; targetHandle = "left";
    } else {
      sourceHandle = "left"; targetHandle = "right";
    }

    nodes.push({
      id: nodeId,
      type: "provider",
      position: { x: cx - nodeW / 2, y: cy - nodeH / 2 },
      data,
      draggable: false,
    });

    edges.push({
      id: `e-${nodeId}`,
      source: "router",
      sourceHandle,
      target: nodeId,
      targetHandle,
      animated: active,
      style: edgeStyle(active, last, error, config.color),
    });
  });

  return { nodes, edges };
}

export default function ProviderTopology({ providers = EMPTY_PROVIDERS, activeRequests = EMPTY_REQUESTS, lastProvider = "", errorProvider = "" }) {
  // Serialize to stable string keys so useMemo only re-runs when values actually change
  const activeKey = useMemo(
    () => activeRequests.flatMap((r) => { const p = r.provider?.toLowerCase(); return p ? [p] : []; }).sort().join(","),
    [activeRequests]
  );
  const lastKey = lastProvider?.toLowerCase() || "";
  const errorKey = errorProvider?.toLowerCase() || "";

  const rawActiveSet = useMemo(() => new Set(activeKey ? activeKey.split(",") : []), [activeKey]);
  const lastSet = useMemo(() => new Set(lastKey ? [lastKey] : []), [lastKey]);
  const errorSet = useMemo(() => new Set(errorKey ? [errorKey] : []), [errorKey]);

  // Track firstSeen per active provider; drop provider if running too long (BE stuck)
  const [firstSeen, setFirstSeen] = useState({});
  const [activeSet, setActiveSet] = useState(new Set());
  const [tick, setTick] = useState(0);

  // Tracks when each provider became active so we can drop providers that
  // are stuck (e.g. backend never marked them done). State (not ref) so
  // downstream useEffects can react to changes.
  useEffect(() => {
    const now = Date.now();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- updater pattern avoids stale state; cascading renders are intentional here.
    setFirstSeen((prev) => {
      const next = { ...prev };
      for (const p of rawActiveSet) {
        if (!next[p]) next[p] = now;
      }
      for (const p of Object.keys(next)) {
        if (!rawActiveSet.has(p)) delete next[p];
      }
      return next;
    });
  }, [rawActiveSet]);

  useEffect(() => {
    if (rawActiveSet.size === 0) return;
    const id = setInterval(() => setTick((t) => t + 1), FE_ACTIVE_TICK_MS);
    return () => clearInterval(id);
  }, [rawActiveSet]);

  // Compute filtered activeSet in an effect so Date.now() is not called
  // during render. tick + firstSeen + rawActiveSet all trigger recompute.
  useEffect(() => {
    void tick; // re-run on tick
    const now = Date.now();
    const filtered = new Set();
    for (const p of rawActiveSet) {
      const ts = firstSeen[p];
      if (!ts || now - ts < FE_ACTIVE_TIMEOUT_MS) filtered.add(p);
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Date.now() is not allowed during render; computed in effect so render stays pure.
    setActiveSet(filtered);
  }, [rawActiveSet, tick, firstSeen]);

  const { nodes, edges } = useMemo(
    () => buildLayout(providers, activeSet, lastSet, errorSet),
    [providers, activeSet, lastSet, errorSet]
  );

  // Stable key — only remount when provider list changes
  const providersKey = useMemo(
    () => providers.map((p) => p.provider).sort().join(","),
    [providers]
  );

  const rfInstance = useRef(null);
  const containerRef = useRef(null);
  const onInit = useCallback((instance) => {
    rfInstance.current = instance;
    setTimeout(() => instance.fitView(FIT_VIEW_OPTS), 50);
  }, []);

  // Re-fit on container resize
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      if (rfInstance.current) rfInstance.current.fitView(FIT_VIEW_OPTS);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Re-fit when node count/layout changes
  useEffect(() => {
    if (rfInstance.current) {
      const id = setTimeout(() => rfInstance.current.fitView(FIT_VIEW_OPTS), 50);
      return () => clearTimeout(id);
    }
  }, [nodes.length]);

  return (
    <div ref={containerRef} className="h-[320px] w-full min-w-0 rounded-lg border border-border bg-bg-subtle/30 sm:h-[480px]">
      {providers.length === 0 ? (
        <div className="h-full flex items-center justify-center text-text-muted text-sm">
          No providers connected
        </div>
      ) : (
        <ReactFlow
          key={providersKey}
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={FIT_VIEW_OPTS}
          minZoom={0.1}
          maxZoom={2}
          onInit={onInit}
          proOptions={{ hideAttribution: true }}
          panOnDrag
          zoomOnScroll
          zoomOnPinch
          zoomOnDoubleClick
          preventScrolling={false}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
        >
          <Controls showInteractive={false} className="react-flow-controls-custom" />
        </ReactFlow>
      )}
    </div>
  );
}

