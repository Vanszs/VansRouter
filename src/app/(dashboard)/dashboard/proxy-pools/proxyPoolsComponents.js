"use client";

import { Badge, Button, Input, Modal, Toggle } from "@/shared/components";
import { PUBLIC_PROXY_SOURCES } from "@/shared/constants/publicProxySources.js";

export function parseProxyLine(line) {
  const trimmed = line.trim();
  if (!trimmed) return null;
  if (trimmed.includes("://")) {
    const parsed = new URL(trimmed);
    const hostLabel = parsed.port ? `${parsed.hostname}:${parsed.port}` : parsed.hostname;
    return { proxyUrl: parsed.toString(), name: `Imported ${hostLabel}` };
  }
  const parts = trimmed.split(":");
  if (parts.length === 4) {
    const [host, port, username, password] = parts;
    if (!host || !port || !username || !password) throw new Error("Invalid host:port:user:pass format");
    const proxyUrl = `http://${encodeURIComponent(username)}:${encodeURIComponent(password)}@${host}:${port}`;
    const parsed = new URL(proxyUrl);
    return { proxyUrl: parsed.toString(), name: `Imported ${host}:${port}` };
  }
  throw new Error("Unsupported format");
}

export function getStatusVariant(status) {
  if (status === "active") return "success";
  if (status === "error") return "error";
  return "default";
}

export function formatDateTime(value) {
  if (!value) return "Never";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Never";
  return date.toLocaleString();
}

export function normalizeFormData(data = {}) {
  return {
    name: data.name || "",
    proxyUrl: data.proxyUrl || "",
    noProxy: data.noProxy || "",
    isActive: data.isActive !== false,
    strictProxy: data.strictProxy === true,
  };
}

export const VERCEL_TOKEN_HINT = <>Token is used once for deployment and not stored. <a href="https://vercel.com/account/tokens" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">Get token →</a></>;
export const CF_TOKEN_HINT = <>Requires &quot;Workers Scripts: Edit&quot; permission. <a href="https://dash.cloudflare.com/profile/api-tokens" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">Get token →</a></>;

export function PoolFormModal({ isOpen, editingProxyPool, formData, saving, onClose, onSave, onChange }) {
  return (
    <Modal isOpen={isOpen} title={editingProxyPool ? "Edit Proxy Pool" : "Add Proxy Pool"} onClose={onClose}>
      <div className="flex flex-col gap-4">
        <Input label="Name" value={formData.name} onChange={(e) => onChange("name", e.target.value)} placeholder="Office Proxy" />
        <Input label="Proxy URL" value={formData.proxyUrl} onChange={(e) => onChange("proxyUrl", e.target.value)} placeholder="http://127.0.0.1:7897" />
        <Input label="No Proxy" value={formData.noProxy} onChange={(e) => onChange("noProxy", e.target.value)} placeholder="localhost,127.0.0.1,.internal" hint="Comma-separated hosts/domains to bypass proxy" />
        <ToggleField label="Active" description="Inactive pools are ignored by runtime resolution." checked={formData.isActive} onChange={() => onChange("isActive", !formData.isActive)} disabled={saving} />
        <ToggleField label="Strict Proxy" description="Fail request if proxy is unreachable instead of falling back to direct." checked={formData.strictProxy} onChange={() => onChange("strictProxy", !formData.strictProxy)} disabled={saving} />
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <Button fullWidth onClick={onSave} disabled={!formData.name.trim() || !formData.proxyUrl.trim() || saving}>{saving ? "Saving..." : "Save"}</Button>
          <Button fullWidth variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
        </div>
      </div>
    </Modal>
  );
}

function ToggleField({ label, description, checked, onChange, disabled }) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border/50 p-3 sm:flex-row sm:items-center sm:justify-between">
      <div><p className="font-medium text-sm">{label}</p><p className="text-xs text-text-muted">{description}</p></div>
      <Toggle checked={checked === true} onChange={onChange} disabled={disabled} />
    </div>
  );
}

export function BatchImportModal({ isOpen, text, importing, onChange, onImport, onClose }) {
  return (
    <Modal isOpen={isOpen} title="Batch Import Proxies" onClose={onClose}>
      <div className="flex flex-col gap-4">
        <div>
          <label htmlFor="proxy-batch-import" className="text-sm font-medium text-text-main mb-1 block">Paste Proxy List (One per line)</label>
          <textarea id="proxy-batch-import" value={text} onChange={(e) => onChange(e.target.value)} placeholder={"http://user:pass@127.0.0.1:7897\n127.0.0.1:7897:user:pass"} className="w-full min-h-[180px] py-2 px-3 text-sm text-text-main bg-white dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-md focus:ring-1 focus:ring-primary/30 focus:border-primary/50 focus:outline-none transition-all" />
          <p className="text-xs text-text-muted mt-1">Supported formats: protocol://user:pass@host:port, host:port:user:pass</p>
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <Button fullWidth onClick={onImport} disabled={!text.trim() || importing}>{importing ? "Importing..." : "Import"}</Button>
          <Button fullWidth variant="ghost" onClick={onClose} disabled={importing}>Cancel</Button>
        </div>
      </div>
    </Modal>
  );
}

const PUBLIC_IMPORT_SELECT_CLASS = "w-full px-2 py-2 bg-surface rounded-md text-sm text-text-main border border-border focus:outline-none focus:ring-1 focus:ring-primary/50";

export function PublicImportModal({ isOpen, form, importing, onChange, onImport, onClose }) {
  const source = PUBLIC_PROXY_SOURCES[form.source] || PUBLIC_PROXY_SOURCES.freeproxydb;
  const vpsLabSocks = form.source === "vpslab" && form.protocol === "socks5";
  const anonymityDisabled = !source.supportsAnonymity || (vpsLabSocks && !source.anonymityProtocols?.includes("socks5"));

  return (
    <Modal isOpen={isOpen} title="Import from Public Lists" onClose={onClose}>
      <div className="flex flex-col gap-4">
        <div>
          <label htmlFor="public-proxy-source" className="text-sm font-medium text-text-main mb-1 block">Source</label>
          <select
            id="public-proxy-source"
            value={form.source}
            onChange={(e) => onChange("source", e.target.value)}
            className={PUBLIC_IMPORT_SELECT_CLASS}
            disabled={importing}
          >
            {Object.values(PUBLIC_PROXY_SOURCES).map((entry) => (
              <option key={entry.id} value={entry.id}>{entry.label}</option>
            ))}
          </select>
          <p className="text-xs text-text-muted mt-1">{source.note}</p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="public-proxy-count" className="text-sm font-medium text-text-main mb-1 block">Count</label>
            <Input
              id="public-proxy-count"
              type="number"
              value={form.count}
              onChange={(e) => onChange("count", e.target.value)}
              placeholder={String(source.defaultCount)}
              hint={`${source.minCount}-${source.maxCount}`}
              disabled={importing}
            />
          </div>
          <div>
            <label htmlFor="public-proxy-protocol" className="text-sm font-medium text-text-main mb-1 block">Protocol</label>
            <select
              id="public-proxy-protocol"
              value={form.protocol}
              onChange={(e) => onChange("protocol", e.target.value)}
              className={PUBLIC_IMPORT_SELECT_CLASS}
              disabled={importing}
            >
              {source.protocols.map((protocol) => (
                <option key={protocol} value={protocol}>{protocol.toUpperCase()}</option>
              ))}
            </select>
          </div>
        </div>
        {source.supportsCountry ? (
          <Input
            label="Country"
            value={form.country}
            onChange={(e) => onChange("country", e.target.value)}
            placeholder="US,CA"
            hint="Optional country codes, comma-separated"
            disabled={importing}
          />
        ) : null}
        <div>
          <label htmlFor="public-proxy-anonymity" className="text-sm font-medium text-text-main mb-1 block">Anonymity</label>
          <select
            id="public-proxy-anonymity"
            value={form.anonymity}
            onChange={(e) => onChange("anonymity", e.target.value)}
            className={PUBLIC_IMPORT_SELECT_CLASS}
            disabled={importing || anonymityDisabled}
          >
            <option value="">any</option>
            <option value="elite">elite</option>
            <option value="anonymous">anonymous</option>
            <option value="transparent">transparent</option>
          </select>
          {anonymityDisabled ? <p className="text-xs text-text-muted mt-1">VPSLab socks5 list has no anonymity cuts.</p> : null}
        </div>
        <ToggleField
          label="HTTPS only"
          description="Only proxies verified as HTTPS-capable."
          checked={form.httpsOnly === true}
          onChange={() => onChange("httpsOnly", !form.httpsOnly)}
          disabled={importing || (form.source === "vpslab" && form.protocol === "socks5")}
        />
        {source.supportsMaxSpeed ? (
          <Input
            label="Max speed (s)"
            value={form.maxSpeed}
            onChange={(e) => onChange("maxSpeed", e.target.value)}
            placeholder="10"
            hint="Optional upper bound on response time in seconds"
            type="number"
            disabled={importing}
          />
        ) : null}
        {source.supportsOrderBy ? (
          <div>
            <label htmlFor="public-proxy-order" className="text-sm font-medium text-text-main mb-1 block">Order by</label>
            <select
              id="public-proxy-order"
              value={form.orderBy}
              onChange={(e) => onChange("orderBy", e.target.value)}
              className={PUBLIC_IMPORT_SELECT_CLASS}
              disabled={importing}
            >
              {source.orderByOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
            <p className="text-xs text-text-muted mt-1">Fastest = lowest measured latency; unmeasured proxies sort last.</p>
          </div>
        ) : null}
        <p className="text-xs text-text-muted">
          Imported pools start active. Free proxies churn fast — run Health Check after importing and disable the dead ones.
        </p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <Button fullWidth onClick={onImport} disabled={importing}>{importing ? "Importing..." : "Import"}</Button>
          <Button fullWidth variant="ghost" onClick={onClose} disabled={importing}>Cancel</Button>
        </div>
      </div>
    </Modal>
  );
}

export function PoolRow({ pool, selected, testing, onSelect, onToggle, onTest, onEdit, onDelete }) {
  return (
    <div className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-3 min-w-0 flex-1">
        <input type="checkbox" checked={selected} onChange={onSelect} aria-label={`Select proxy ${pool.name || pool.id}`} className="mt-1 size-4 shrink-0 rounded border-black/20 dark:border-white/20" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="min-w-0 max-w-full truncate text-sm font-medium sm:max-w-[18rem]">{pool.name}</p>
            <Badge variant={getStatusVariant(pool.testStatus)} size="sm" dot>{pool.testStatus || "unknown"}</Badge>
            <Badge variant={pool.isActive ? "success" : "default"} size="sm">{pool.isActive ? "active" : "inactive"}</Badge>
            {pool.type === "vercel" && <Badge variant="default" size="sm">vercel relay</Badge>}
            {pool.type === "cloudflare" && <Badge variant="default" size="sm">cloudflare relay</Badge>}
            <Badge variant="default" size="sm">{pool.boundConnectionCount || 0} bound</Badge>
          </div>
          <p className="text-xs text-text-muted truncate mt-1">{pool.proxyUrl}</p>
          {pool.noProxy ? <p className="text-xs text-text-muted truncate">No proxy: {pool.noProxy}</p> : null}
          <p className="text-[11px] text-text-muted mt-1">Last tested: {formatDateTime(pool.lastTestedAt)}{pool.lastError ? ` · ${pool.lastError}` : ""}</p>
        </div>
      </div>
      <div className="flex items-center justify-end gap-1">
        <Toggle size="sm" checked={pool.isActive === true} onChange={onToggle} title={pool.isActive ? "Disable" : "Enable"} />
        <button type="button" onClick={onTest} className="p-2 rounded hover:bg-black/5 dark:hover:bg-white/5 text-text-muted hover:text-primary" title="Test proxy" disabled={testing}>
          <span className="material-symbols-outlined text-[18px]" style={testing ? { animation: "spin 1s linear infinite" } : undefined}>{testing ? "progress_activity" : "science"}</span>
        </button>
        <button type="button" onClick={onEdit} className="p-2 rounded hover:bg-black/5 dark:hover:bg-white/5 text-text-muted hover:text-primary" title="Edit"><span className="material-symbols-outlined text-[18px]">edit</span></button>
        <button type="button" onClick={onDelete} className="p-2 rounded hover:bg-red-500/10 text-red-500" title="Delete"><span className="material-symbols-outlined text-[18px]">delete</span></button>
      </div>
    </div>
  );
}
