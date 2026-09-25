"use client";

import { useState, useReducer } from "react";
import { Modal, Input, Button, Badge } from "@/shared/components";

const DEFAULT_BASE_URL = "https://api.openai.com/v1";

function ValidationResult({ validationResult }) {
  if (!validationResult) return null;
  const { valid, error, dimensions } = validationResult;
  if (valid) {
    return (
      <>
        <Badge variant="success">Valid</Badge>
        {dimensions && <span className="text-sm text-text-muted">{dimensions} dims</span>}
      </>
    );
  }
  return (
    <div className="flex flex-col gap-1">
      <Badge variant="error">Invalid</Badge>
      {error && <span className="text-sm text-red-500">{error}</span>}
    </div>
  );
}

function embeddingReducer(state, action) {
  switch (action.type) {
    case "RESET_FORM": return { ...state, formData: action.formData, checkKey: "", checkModelId: "", validationResult: null };
    case "SET_FORM": return { ...state, formData: { ...state.formData, ...action.fields } };
    case "SET_CHECK_KEY": return { ...state, checkKey: action.value };
    case "SET_CHECK_MODEL": return { ...state, checkModelId: action.value };
    case "VALIDATE_START": return { ...state, validating: true, validationResult: null };
    case "VALIDATE_DONE": return { ...state, validating: false, validationResult: action.result };
    case "SUBMIT_START": return { ...state, submitting: true };
    case "SUBMIT_DONE": return { ...state, submitting: false };
    default: return state;
  }
}

// Dual-mode modal: edit when `node` provided, add otherwise
export default function AddCustomEmbeddingModal({ isOpen, onClose, onCreated, onSaved, node }) {
  const isEdit = !!node;
  const [state, dispatch] = useReducer(embeddingReducer, {
    formData: { name: "", prefix: "", baseUrl: DEFAULT_BASE_URL },
    submitting: false,
    checkKey: "",
    checkModelId: "",
    validating: false,
    validationResult: null,
  });
  const { formData, submitting, checkKey, checkModelId, validating, validationResult } = state;

  const [prevIsOpen, setPrevIsOpen] = useState(false);
  const [prevNode, setPrevNode] = useState(node);
  if ((isOpen && !prevIsOpen) || (isOpen && node !== prevNode)) {
    setPrevIsOpen(isOpen);
    setPrevNode(node);
    dispatch({
      type: "RESET_FORM",
      formData: isEdit
        ? { name: node.name || "", prefix: node.prefix || "", baseUrl: node.baseUrl || DEFAULT_BASE_URL }
        : { name: "", prefix: "", baseUrl: DEFAULT_BASE_URL },
    });
  } else if (!isOpen && prevIsOpen) {
    setPrevIsOpen(false);
  }

  const handleSubmit = async () => {
    if (!formData.name.trim() || !formData.prefix.trim() || !formData.baseUrl.trim()) return;
    dispatch({ type: "SUBMIT_START" });
    try {
      const url = isEdit ? `/api/provider-nodes/${node.id}` : "/api/provider-nodes";
      const method = isEdit ? "PUT" : "POST";
      const payload = {
        name: formData.name,
        prefix: formData.prefix,
        baseUrl: formData.baseUrl,
      };
      if (!isEdit) payload.type = "custom-embedding";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (res.ok) {
        if (isEdit) onSaved?.(data.node);
        else onCreated?.(data.node);
      }
    } catch (error) {
      console.log("Error saving custom embedding node:", error);
    } finally {
      dispatch({ type: "SUBMIT_DONE" });
    }
  };

  const handleValidate = async () => {
    dispatch({ type: "VALIDATE_START" });
    try {
      const res = await fetch("/api/provider-nodes/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          baseUrl: formData.baseUrl,
          apiKey: checkKey,
          type: "custom-embedding",
          modelId: checkModelId.trim() || undefined,
        }),
      });
      const data = await res.json();
      dispatch({ type: "VALIDATE_DONE", result: data });
    } catch {
      dispatch({ type: "VALIDATE_DONE", result: { valid: false, error: "Network error" } });
    }
  };

  return (
    <Modal isOpen={isOpen} title={isEdit ? "Edit Custom Embedding" : "Add Custom Embedding"} onClose={onClose}>
      <div className="flex flex-col gap-4">
        <Input
          label="Name"
          value={formData.name}
          onChange={(e) => dispatch({ type: "SET_FORM", fields: { name: e.target.value } })}
          placeholder="Voyage AI"
          hint="Required. A friendly label for this embedding provider."
        />
        <Input
          label="Prefix"
          value={formData.prefix}
          onChange={(e) => dispatch({ type: "SET_FORM", fields: { prefix: e.target.value } })}
          placeholder="voyage"
          hint="Required. Used as the provider prefix for model IDs (e.g. voyage/voyage-3)."
        />
        <Input
          label="Base URL"
          value={formData.baseUrl}
          onChange={(e) => dispatch({ type: "SET_FORM", fields: { baseUrl: e.target.value } })}
          placeholder="https://api.voyageai.com/v1"
          hint="Most embedding APIs are OpenAI-compatible: Voyage, Cohere, Jina, Mistral, Together..."
        />
        <Input
          label="API Key (for Check)"
          type="password"
          value={checkKey}
          onChange={(e) => dispatch({ type: "SET_CHECK_KEY", value: e.target.value })}
        />
        <Input
          label="Model ID (for Check)"
          value={checkModelId}
          onChange={(e) => dispatch({ type: "SET_CHECK_MODEL", value: e.target.value })}
          placeholder="e.g. voyage-3, embed-english-v3.0, text-embedding-3-small"
          hint="Required for validation. Will send a test embeddings request."
        />
        <div className="flex items-center gap-3">
          <Button
            onClick={handleValidate}
            disabled={!checkKey || !checkModelId.trim() || validating || !formData.baseUrl.trim()}
            variant="secondary"
          >
            {validating ? "Checking..." : "Check"}
          </Button>
          <ValidationResult validationResult={validationResult} />
        </div>
        <div className="flex gap-2">
          <Button
            onClick={handleSubmit}
            fullWidth
            disabled={!formData.name.trim() || !formData.prefix.trim() || !formData.baseUrl.trim() || submitting}
          >
            {submitting ? (isEdit ? "Saving..." : "Creating...") : (isEdit ? "Save" : "Create")}
          </Button>
          <Button onClick={onClose} variant="ghost" fullWidth>Cancel</Button>
        </div>
      </div>
    </Modal>
  );
}

