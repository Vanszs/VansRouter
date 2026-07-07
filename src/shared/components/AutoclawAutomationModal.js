"use client";

import { useState } from "react";
import { Modal, Button, Input } from "@/shared/components";

export default function AutoclawAutomationModal({ isOpen, onClose, onSaved }) {
  const [accessToken, setAccessToken] = useState("");
  const [refreshToken, setRefreshToken] = useState("");
  const [deviceId, setDeviceId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  function handleClose() {
    setAccessToken("");
    setRefreshToken("");
    setDeviceId("");
    setError(null);
    onClose?.();
  }

  async function handleImport() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/oauth/autoclaw/import-token", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          accessToken: accessToken.trim(),
          refreshToken: refreshToken.trim(),
          deviceId: deviceId.trim() || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Import failed");
        return;
      }
      setAccessToken("");
      setRefreshToken("");
      setDeviceId("");
      onSaved?.();
      handleClose();
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  const canSubmit = Boolean(accessToken.trim() && refreshToken.trim() && !loading);

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="Import AutoClaw Account" size="md">
      <div className="space-y-3">
        <Input
          label="Access Token"
          value={accessToken}
          onChange={(e) => setAccessToken(e.target.value)}
          placeholder="Bearer eyJ..."
          required
        />
        <Input
          label="Refresh Token"
          value={refreshToken}
          onChange={(e) => setRefreshToken(e.target.value)}
          placeholder="Bearer eyJ..."
          required
        />
        <Input
          label="Device ID (optional)"
          value={deviceId}
          onChange={(e) => setDeviceId(e.target.value)}
          placeholder="Auto-generated if blank"
          hint="Per-account device fingerprint from the autoclaw web client. Leave blank to auto-generate."
        />
        {error && (
          <p className="text-sm text-red-500 break-words" role="alert">
            {error}
          </p>
        )}
        <div className="flex gap-2 justify-end pt-2">
          <Button variant="outline" onClick={handleClose} disabled={loading}>
            Cancel
          </Button>
          <Button variant="primary" loading={loading} onClick={handleImport} disabled={!canSubmit}>
            Import
          </Button>
        </div>
      </div>
    </Modal>
  );
}
