"use client";

import { useEffect, useReducer } from "react";
import PropTypes from "prop-types";
import { Modal, Button, Input } from "@/shared/components";

function cursorReducer(state, action) {
  switch (action.type) {
    case "SET_TOKEN": return { ...state, accessToken: action.value };
    case "SET_MACHINE_ID": return { ...state, machineId: action.value };
    case "AUTO_DETECT_START": return { ...state, autoDetecting: true, error: null, autoDetected: false, windowsManual: false };
    case "AUTO_DETECT_DONE": return { ...state, autoDetecting: false, autoDetected: action.found || false, accessToken: action.accessToken || state.accessToken, machineId: action.machineId || state.machineId, windowsManual: action.windowsManual || false, error: action.error || null };
    case "IMPORT_START": return { ...state, importing: true, error: null };
    case "IMPORT_DONE": return { ...state, importing: false, error: action.error || null };
    case "ERROR": return { ...state, error: action.error };
    default: return state;
  }
}

/**
 * Cursor Auth Modal
 * Auto-detect and import token from Cursor IDE's local SQLite database
 */
export default function CursorAuthModal({ isOpen, onSuccess, onClose }) {
  const [state, dispatch] = useReducer(cursorReducer, { accessToken: "", machineId: "", error: null, importing: false, autoDetecting: false, autoDetected: false, windowsManual: false });
  const { accessToken, machineId, error, importing, autoDetecting, autoDetected, windowsManual } = state;

  const runAutoDetect = async () => {
    dispatch({ type: "AUTO_DETECT_START" });
    try {
      const res = await fetch("/api/oauth/cursor/auto-import");
      const data = await res.json();

      if (data.found) {
        dispatch({ type: "AUTO_DETECT_DONE", found: true, accessToken: data.accessToken, machineId: data.machineId });
      } else if (data.windowsManual) {
        dispatch({ type: "AUTO_DETECT_DONE", windowsManual: true });
      } else {
        dispatch({ type: "AUTO_DETECT_DONE", error: data.error || "Could not auto-detect tokens" });
      }
    } catch (err) {
      dispatch({ type: "AUTO_DETECT_DONE", error: "Failed to auto-detect tokens" });
    }
  };

  // Auto-detect tokens when modal opens
  useEffect(() => {
    if (!isOpen) return;
    runAutoDetect();
  }, [isOpen]);

  const handleImportToken = async () => {
    if (!accessToken.trim()) {
      dispatch({ type: "ERROR", error: "Please enter an access token" });
      return;
    }

    if (!machineId.trim()) {
      dispatch({ type: "ERROR", error: "Please enter a machine ID" });
      return;
    }

    dispatch({ type: "IMPORT_START" });

    try {
      const res = await fetch("/api/oauth/cursor/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accessToken: accessToken.trim(),
          machineId: machineId.trim(),
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Import failed");
      }

      onSuccess?.();
      onClose();
    } catch (err) {
      dispatch({ type: "IMPORT_DONE", error: err.message });
    }
  };

  return (
    <Modal isOpen={isOpen} title="Connect Cursor IDE" onClose={onClose}>
      <div className="flex flex-col gap-4">
        {/* Auto-detecting state */}
        {autoDetecting && (
          <div className="text-center py-6">
            <div className="size-16 mx-auto mb-4 rounded-full bg-primary/10 flex items-center justify-center">
              <span className="material-symbols-outlined text-3xl text-primary animate-spin">
                progress_activity
              </span>
            </div>
            <h3 className="text-lg font-semibold mb-2">Auto-detecting tokens...</h3>
            <p className="text-sm text-text-muted">
              Reading from Cursor IDE database
            </p>
          </div>
        )}

        {/* Form (shown after auto-detect completes) */}
        {!autoDetecting && (
          <>
            {/* Success message if auto-detected */}
            {autoDetected && (
              <div className="bg-green-50 dark:bg-green-900/20 p-3 rounded-lg border border-green-200 dark:border-green-800">
                <div className="flex gap-2">
                  <span className="material-symbols-outlined text-green-600 dark:text-green-400">check_circle</span>
                  <p className="text-sm text-green-800 dark:text-green-200">
                    Tokens auto-detected from Cursor IDE successfully!
                  </p>
                </div>
              </div>
            )}

            {/* Windows manual instructions */}
            {windowsManual && (
              <div className="bg-amber-50 dark:bg-amber-900/20 p-3 rounded-lg border border-amber-200 dark:border-amber-800 flex flex-col gap-2">
                <div className="flex gap-2 items-center">
                  <span className="material-symbols-outlined text-amber-600 dark:text-amber-400">info</span>
                  <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
                    Could not read Cursor database automatically.
                  </p>
                </div>
                <p className="text-xs text-amber-700 dark:text-amber-300">
                  Make sure Cursor IDE has been opened at least once, then click <strong>Retry</strong>. If the problem persists, paste your tokens manually below.
                </p>
                <Button onClick={runAutoDetect} variant="outline" fullWidth>
                  Retry
                </Button>
              </div>
            )}

            {/* Info message if not auto-detected */}
            {!autoDetected && !windowsManual && !error && (
              <div className="bg-blue-50 dark:bg-blue-900/20 p-3 rounded-lg border border-blue-200 dark:border-blue-800">
                <div className="flex gap-2">
                  <span className="material-symbols-outlined text-blue-600 dark:text-blue-400">info</span>
                  <p className="text-sm text-blue-800 dark:text-blue-200">
                    Cursor IDE not detected. Please paste your tokens manually.
                  </p>
                </div>
              </div>
            )}

            {/* Access Token Input */}
            <div>
              <label htmlFor="cursor-access-token" className="block text-sm font-medium mb-2">
                Access Token <span className="text-red-500">*</span>
              </label>
              <textarea
                id="cursor-access-token"
                value={accessToken}
                onChange={(e) => dispatch({ type: "SET_TOKEN", value: e.target.value })}
                placeholder="Access token will be auto-filled..."
                rows={3}
                className="w-full px-3 py-2 text-sm font-mono border border-border rounded-lg bg-background focus:outline-none focus:border-primary resize-none"
              />
            </div>

            {/* Machine ID Input */}
            <div>
              <label htmlFor="cursor-machine-id" className="block text-sm font-medium mb-2">
                Machine ID <span className="text-red-500">*</span>
              </label>
              <Input
                id="cursor-machine-id"
                value={machineId}
                onChange={(e) => dispatch({ type: "SET_MACHINE_ID", value: e.target.value })}
                placeholder="Machine ID will be auto-filled..."
                className="font-mono text-sm"
              />
            </div>

            {/* Error Display */}
            {error && (
              <div className="bg-red-50 dark:bg-red-900/20 p-3 rounded-lg border border-red-200 dark:border-red-800">
                <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex gap-2">
              <Button
                onClick={handleImportToken}
                fullWidth
                disabled={importing || !accessToken.trim() || !machineId.trim()}
              >
                {importing ? "Importing..." : "Import Token"}
              </Button>
              <Button onClick={onClose} variant="ghost" fullWidth>
                Cancel
              </Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

CursorAuthModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onSuccess: PropTypes.func,
  onClose: PropTypes.func.isRequired,
};
