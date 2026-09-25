"use client";

import { useState, useReducer } from "react";
import { Button, Modal } from "@/shared/components";

function modalReducer(state, action) {
  switch (action.type) {
    case "RESET": return { modelId: "", testStatus: null, testError: "", saving: false };
    case "SET_MODEL": return { ...state, modelId: action.value, testStatus: null, testError: "" };
    case "TEST_START": return { ...state, testStatus: "testing", testError: "" };
    case "TEST_RESULT": return { ...state, testStatus: action.ok ? "ok" : "error", testError: action.error || "" };
    case "SAVE_START": return { ...state, saving: true };
    case "SAVE_DONE": return { ...state, saving: false };
    default: return state;
  }
}

export default function AddCustomModelModal({ isOpen, providerAlias, providerDisplayAlias, onSave, onClose }) {
  const [state, dispatch] = useReducer(modalReducer, { modelId: "", testStatus: null, testError: "", saving: false });
  const { modelId, testStatus, testError, saving } = state;
  const [prevIsOpen, setPrevIsOpen] = useState(false);

  // Reset state when modal opens (prev-prop pattern — no extra render cycle)
  if (isOpen && !prevIsOpen) {
    setPrevIsOpen(true);
    dispatch({ type: "RESET" });
  } else if (!isOpen && prevIsOpen) {
    setPrevIsOpen(false);
  }

  // Strip provider's own alias prefix (e.g. "cc/model" -> "model" for cc provider)
  const stripAlias = (id) => {
    const prefix = `${providerAlias}/`;
    return id.startsWith(prefix) ? id.slice(prefix.length) : id;
  };

  const handleTest = async () => {
    const cleanId = stripAlias(modelId.trim());
    if (!cleanId) return;
    dispatch({ type: "TEST_START" });
    try {
      const res = await fetch("/api/models/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: `${providerAlias}/${cleanId}` }),
      });
      const data = await res.json();
      dispatch({ type: "TEST_RESULT", ok: data.ok, error: data.error });
    } catch (err) {
      dispatch({ type: "TEST_RESULT", ok: false, error: err.message });
    }
  };

  const handleSave = async () => {
    const cleanId = stripAlias(modelId.trim());
    if (!cleanId || saving) return;
    dispatch({ type: "SAVE_START" });
    try {
      await onSave(cleanId);
    } finally {
      dispatch({ type: "SAVE_DONE" });
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter") handleTest();
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Add Custom Model">
      <div className="flex flex-col gap-4">
        <div>
          <label htmlFor="add-custom-model-id" className="text-sm font-medium mb-1.5 block">Model ID</label>
          <div className="flex gap-2">
            <input
              id="add-custom-model-id"
              type="text"
              value={modelId}
              onChange={(e) => dispatch({ type: "SET_MODEL", value: e.target.value })}
              onKeyDown={handleKeyDown}
              placeholder="e.g. claude-opus-4-5"
              className="flex-1 px-3 py-2 text-sm border border-border rounded-lg bg-background focus:outline-none focus:border-primary"
            />
            <Button
              variant="secondary"
              icon="science"
              loading={testStatus === "testing"}
              onClick={handleTest}
              disabled={!modelId.trim() || testStatus === "testing"}
            >
              {testStatus === "testing" ? "Testing..." : "Test"}
            </Button>
          </div>
          <p className="text-xs text-text-muted mt-1">
            Sent to provider as: <code className="font-mono bg-sidebar px-1 rounded">{stripAlias(modelId.trim()) || "model-id"}</code>
          </p>
        </div>

        {/* Test result */}
        {testStatus === "ok" && (
          <div className="flex items-center gap-2 text-sm text-green-600">
            <span className="material-symbols-outlined text-base">check_circle</span>
            Model is reachable
          </div>
        )}
        {testStatus === "error" && (
          <div className="flex items-start gap-2 text-sm text-red-500">
            <span className="material-symbols-outlined text-base shrink-0">cancel</span>
            <span>{testError || "Model not reachable"}</span>
          </div>
        )}

        <div className="flex gap-2 pt-1">
          <Button onClick={onClose} variant="ghost" fullWidth size="sm">Cancel</Button>
          <Button
            onClick={handleSave}
            fullWidth
            size="sm"
            disabled={!modelId.trim() || saving}
          >
            {saving ? "Adding..." : "Add Model"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

