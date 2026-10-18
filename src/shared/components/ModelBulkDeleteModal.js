"use client";

import { useState } from "react";
import Modal from "./Modal";
import Button from "./Button";
import { deleteSelectedModels } from "../utils/deleteSelectedModels.js";

export default function ModelBulkDeleteModal({ models, modelAliases, providerAlias, onClose, onRefresh }) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState(false);
  const visible = models.filter((m) => m.id.toLowerCase().includes(query.toLowerCase()));
  const close = () => { if (!busy) onClose(); };
  const remove = async () => {
    setBusy(true);
    setError("");
    try {
      await deleteSelectedModels(models.filter((m) => selected.has(m.id)), providerAlias, modelAliases);
      await onRefresh();
      onClose();
    } catch (err) {
      setError(err.message);
      await onRefresh();
    } finally { setBusy(false); }
  };
  return <Modal isOpen title="Remove added models" onClose={close} size="xl" footer={<>
    <Button variant="secondary" onClick={close} disabled={busy}>Cancel</Button>
    <Button onClick={confirming ? remove : () => setConfirming(true)} disabled={busy || selected.size === 0} loading={busy}>{confirming ? "Confirm removal" : `Remove ${selected.size} models`}</Button>
  </>}>
    <p className="mb-3 text-sm text-text-muted">Only user-added registrations and their aliases are removed. Provider connections and built-in models are unchanged.</p>
    {error && <p role="alert" className="text-red-500">{error}</p>}
    {confirming ? <><p>Remove these {selected.size} models?</p><ul>{models.filter((m) => selected.has(m.id)).map((m) => <li className="break-all" key={m.id}>{m.id}</li>)}</ul><Button variant="secondary" disabled={busy} onClick={() => setConfirming(false)}>Back to selection</Button></> : <>
      <input aria-label="Search added models" placeholder="Search added models" value={query} onChange={(e) => setQuery(e.target.value)} className="w-full border border-border bg-background p-2 rounded-lg" />
      <div className="flex gap-3 my-3"><Button size="sm" variant="secondary" onClick={() => setSelected((prev) => new Set([...prev, ...visible.map((m) => m.id)]))}>Select visible</Button><Button size="sm" variant="secondary" onClick={() => setSelected(new Set())}>Clear selection</Button><span>{selected.size} selected</span></div>
      <div className="max-h-80 overflow-y-auto">{visible.map((m) => <label key={m.id} className="flex gap-3 p-2"><input type="checkbox" checked={selected.has(m.id)} onChange={() => setSelected((prev) => { const next = new Set(prev); if (next.has(m.id)) next.delete(m.id); else next.add(m.id); return next; })} /><span className="break-all">{m.id}</span></label>)}</div>
    </>}
  </Modal>;
}
