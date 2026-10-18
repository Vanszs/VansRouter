"use client";

import { useState } from "react";
import Modal from "./Modal";
import Button from "./Button";

// Mounted only while a catalog preview is open, so cancel/reopen resets selection.
export default function ModelImportModal({ models, onClose, onConfirm }) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const visible = models.filter((m) => `${m.id} ${m.name || ""}`.toLowerCase().includes(query.toLowerCase()));
  const toggle = (key) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });
  const close = () => { if (!busy) onClose(); };
  const confirm = async () => {
    setBusy(true);
    setError("");
    try {
      await onConfirm(models.filter((_, i) => selected.has(i)));
      onClose();
    } catch (err) {
      setError(err.message || "Failed to import models");
    } finally { setBusy(false); }
  };
  return (
    <Modal isOpen onClose={close} title="Select models to import" size="xl" footer={<>
      <Button variant="secondary" onClick={close} disabled={busy}>Cancel</Button>
      <Button onClick={confirm} loading={busy} disabled={busy || selected.size === 0}>Import {selected.size} models</Button>
    </>}>
      <input aria-label="Search models" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search models" className="w-full rounded-lg border border-border bg-background p-2" />
      <div className="my-3 flex gap-3 items-center">
        <Button size="sm" variant="secondary" disabled={busy} onClick={() => setSelected((prev) => new Set([...prev, ...visible.map((m) => models.indexOf(m))]))}>Select visible</Button>
        <Button size="sm" variant="secondary" disabled={busy} onClick={() => setSelected(new Set())}>Clear selection</Button>
        <span className="text-xs text-text-muted">{selected.size} selected / {models.length} available</span>
      </div>
      {error && <p role="alert" className="mb-3 text-red-500">{error}</p>}
      <div className="max-h-80 overflow-y-auto space-y-2">
        {visible.map((model) => {
          const key = models.indexOf(model);
          return <label key={key} className="flex gap-3 items-center rounded-lg border border-border p-2">
            <input type="checkbox" disabled={busy} checked={selected.has(key)} onChange={() => toggle(key)} />
            <span className="min-w-0 break-all text-sm">{model.id}</span>
          </label>;
        })}
        {visible.length === 0 && <p className="text-text-muted">No matching models</p>}
      </div>
    </Modal>
  );
}
