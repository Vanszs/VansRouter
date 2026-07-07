"use client";

import { useCallback, useState } from "react";
import Badge from "./Badge";
import Button from "./Button";
import Input from "./Input";
import Modal from "./Modal";

function parseEntry(raw) {
  const line = String(raw || "").trim();
  if (!line || line.startsWith("#")) return null;

  if (line.startsWith("{")) {
    try {
      const parsed = JSON.parse(line);
      return {
        apiToken: parsed.apiToken || parsed.apiKey || parsed.token || "",
        accountId: parsed.accountId || parsed.account_id || "",
        name: parsed.name || "",
      };
    } catch {
      return { invalid: true, reason: "Invalid JSON" };
    }
  }

  const parts = line.split("|").map((part) => part.trim());
  const apiToken = parts[0] || "";
  const accountId = parts[1] || "";
  const name = parts[2] || "";
  if (!apiToken || !accountId) {
    return { invalid: true, reason: "Missing apiToken or accountId" };
  }
  return { apiToken, accountId, name };
}

export default function CloudflareTokenImportModal({ isOpen, onClose, onSuccess }) {
  const [mode, setMode] = useState("single");
  const [apiToken, setApiToken] = useState("");
  const [accountId, setAccountId] = useState("");
  const [name, setName] = useState("");
  const [bulkText, setBulkText] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);

  const reset = useCallback(() => {
    setApiToken("");
    setAccountId("");
    setName("");
    setBulkText("");
    setResult(null);
  }, []);

  const handleClose = useCallback(() => {
    reset();
    onClose?.();
  }, [reset, onClose]);

  const handleImport = async () => {
    setLoading(true);
    setResult(null);

    try {
      const postBody =
        mode === "single"
          ? { apiToken: apiToken.trim(), accountId: accountId.trim(), name: name.trim() }
          : { text: bulkText };

      const res = await fetch("/api/oauth/cloudflare-ai/import-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(postBody),
      });
      const data = await res.json();
      setResult({ ok: res.ok, data });

      if (res.ok && data.imported > 0) {
        onSuccess?.();
      }
    } catch (error) {
      setResult({ ok: false, data: { error: error.message } });
    } finally {
      setLoading(false);
    }
  };

  const canSubmit = mode === "single"
    ? Boolean(apiToken.trim() && accountId.trim())
    : Boolean(bulkText.trim());

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="Cloudflare AI Token Import" size="lg">
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-1 rounded-lg border border-border bg-surface p-1">
          <button
            type="button"
            onClick={() => { setMode("single"); setResult(null); }}
            className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              mode === "single"
                ? "bg-primary text-white"
                : "text-text-muted hover:text-text-main hover:bg-background"
            }`}
          >
            Single Token
          </button>
          <button
            type="button"
            onClick={() => { setMode("bulk"); setResult(null); }}
            className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              mode === "bulk"
                ? "bg-primary text-white"
                : "text-text-muted hover:text-text-main hover:bg-background"
            }`}
          >
            Bulk Tokens
          </button>
        </div>

        <div className="flex flex-col gap-2 rounded-[10px] bg-background/50 p-3 text-xs text-text-muted">
          <div className="flex items-start gap-2">
            <span className="material-symbols-outlined text-[18px] text-brand-500 leading-none mt-0.5">info</span>
            <span>
              Tokens are verified against Cloudflare API and tested with Workers AI before saving. No browser automation needed.
            </span>
          </div>
          <div className="flex items-start gap-2">
            <span className="material-symbols-outlined text-[18px] text-brand-500 leading-none mt-0.5">check_circle</span>
            <span className="flex items-center gap-1.5 flex-wrap">
              <code className="text-[10px] bg-border/50 px-1.5 py-0.5 rounded leading-none">apiToken|accountId|optionalName</code>
              <span>or</span>
              <code className="text-[10px] bg-border/50 px-1.5 py-0.5 rounded leading-none">{"{ apiToken, accountId, name }"}</code>
            </span>
          </div>
        </div>

        {mode === "single" ? (
          <div className="flex flex-col gap-3">
            <Input
              label="API Token"
              required
              type="password"
              value={apiToken}
              onChange={(e) => setApiToken(e.target.value)}
              placeholder="v1.0-xxxxx-xxxxx"
              disabled={loading}
            />
            <Input
              label="Account ID"
              required
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
              placeholder="abcd1234efgh5678..."
              disabled={loading}
            />
            <Input
              label="Connection Name (optional)"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My Cloudflare AI"
              disabled={loading}
            />
          </div>
        ) : (
          <div>
            <label className="mb-2 block text-sm font-medium">
              Tokens <span className="text-red-500">*</span>
            </label>
            <textarea
              className="min-h-[180px] w-full resize-y rounded-lg border border-border bg-background px-3 py-2 font-mono text-sm focus:outline-none focus:ring-1 focus:ring-primary"
              placeholder={
                "v1.0-token1|account_id_1|main\n" +
                "v1.0-token2|account_id_2\n" +
                '{"apiToken":"v1.0-...","accountId":"abc","name":"alt"}\n' +
                "# comment lines are skipped"
              }
              value={bulkText}
              onChange={(e) => setBulkText(e.target.value)}
              disabled={loading}
            />
            <p className="mt-1 text-xs text-text-muted">
              One entry per line. Supported: <code className="text-[10px] bg-border/50 px-1.5 py-0.5 rounded">apiToken|accountId|name</code> or JSON.
            </p>
          </div>
        )}

        {result && (
          <div className="flex flex-col gap-2">
            {result.ok && result.data.imported > 0 ? (
              <div className="rounded-[10px] bg-green-500/10 p-3 text-xs text-green-600 dark:text-green-400">
                <div className="flex items-center gap-2 font-semibold">
                  <span className="material-symbols-outlined text-[16px]">check_circle</span>
                  Imported {result.data.imported}/{result.data.total} token{result.data.total === 1 ? "" : "s"}
                  {result.data.failed ? ` (${result.data.failed} failed)` : ""}
                </div>
                {result.data.results?.length > 0 && (
                  <ul className="mt-2 space-y-1">
                    {result.data.results.map((r) => (
                      <li key={r.line} className="flex items-center gap-2">
                        <Badge variant="success" size="sm">OK</Badge>
                        <span className="truncate font-mono">{r.accountId}</span>
                        {r.name && <span className="text-text-muted">· {r.name}</span>}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ) : (
              <div className="rounded-[10px] bg-red-500/10 p-3 text-xs text-red-600 dark:text-red-400">
                <div className="flex items-center gap-2 font-semibold">
                  <span className="material-symbols-outlined text-[16px]">error</span>
                  {result.data.error || "Import failed"}
                </div>
                {result.data.failures?.length > 0 && (
                  <ul className="mt-2 space-y-1">
                    {result.data.failures.map((f) => (
                      <li key={f.line} className="flex items-center gap-2">
                        <Badge variant="danger" size="sm">Line {f.line}</Badge>
                        <span className="truncate font-mono">{f.accountId || "—"}</span>
                        <span className="text-red-500">{f.error}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        )}

        <div className="flex gap-2 pt-2">
          <Button variant="outline" onClick={handleClose} fullWidth disabled={loading}>
            Close
          </Button>
          <Button
            variant="primary"
            onClick={handleImport}
            disabled={loading || !canSubmit}
            loading={loading}
            fullWidth
          >
            Verify & Import
          </Button>
        </div>
      </div>
    </Modal>
  );
}
