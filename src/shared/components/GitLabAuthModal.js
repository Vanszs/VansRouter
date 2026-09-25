"use client";

import { useReducer } from "react";
import { Modal, Button, Input, OAuthModal } from "@/shared/components";

const GITLAB_COM = "https://gitlab.com";

function getRedirectUri() {
  if (typeof window === "undefined") return "http://localhost/callback";
  const port = window.location.port || (window.location.protocol === "https:" ? "443" : "80");
  return `http://localhost:${port}/callback`;
}

const INIT_STATE = { mode: null, baseUrl: GITLAB_COM, clientId: "", clientSecret: "", pat: "", loading: false, error: null, showOAuth: false, oauthMeta: null };

function gitlabReducer(state, action) {
  switch (action.type) {
    case "RESET": return INIT_STATE;
    case "SET_MODE": return { ...state, mode: action.value, error: null };
    case "SET_BASE_URL": return { ...state, baseUrl: action.value };
    case "SET_CLIENT_ID": return { ...state, clientId: action.value };
    case "SET_CLIENT_SECRET": return { ...state, clientSecret: action.value };
    case "SET_PAT": return { ...state, pat: action.value };
    case "ERROR": return { ...state, error: action.error };
    case "PAT_START": return { ...state, loading: true, error: null };
    case "PAT_DONE": return { ...state, loading: false, error: action.error || null };
    case "OAUTH_START": return { ...state, error: null, oauthMeta: action.meta, showOAuth: true };
    case "OAUTH_CLOSE": return { ...state, showOAuth: false };
    default: return state;
  }
}

/**
 * GitLab Duo Authentication Modal
 * Supports two modes:
 * - OAuth (PKCE): requires OAuth App Client ID (and optional Client Secret)
 * - PAT: requires Personal Access Token
 */
export default function GitLabAuthModal({ isOpen, providerInfo, onSuccess, onClose }) {
  const [state, dispatch] = useReducer(gitlabReducer, INIT_STATE);
  const { mode, baseUrl, clientId, clientSecret, pat, loading, error, showOAuth, oauthMeta } = state;

  const reset = () => dispatch({ type: "RESET" });

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleOAuthStart = () => {
    if (!clientId.trim()) {
      dispatch({ type: "ERROR", error: "Client ID is required" });
      return;
    }
    dispatch({ type: "OAUTH_START", meta: { baseUrl: baseUrl.trim() || GITLAB_COM, clientId: clientId.trim(), clientSecret: clientSecret.trim() } });
  };

  const handlePATSubmit = async () => {
    if (!pat.trim()) {
      dispatch({ type: "ERROR", error: "Personal Access Token is required" });
      return;
    }
    dispatch({ type: "PAT_START" });
    try {
      const res = await fetch("/api/oauth/gitlab/pat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: pat.trim(), baseUrl: baseUrl.trim() || GITLAB_COM }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Authentication failed");
      onSuccess?.();
      handleClose();
    } catch (err) {
      dispatch({ type: "PAT_DONE", error: err.message });
    }
  };

  if (!isOpen) return null;

  // Sub-modal for OAuth PKCE flow
  if (showOAuth && oauthMeta) {
    return (
      <OAuthModal
        isOpen
        provider="gitlab"
        providerInfo={providerInfo}
        oauthMeta={oauthMeta}
        onSuccess={() => { onSuccess?.(); handleClose(); }}
        onClose={() => dispatch({ type: "OAUTH_CLOSE" })}
      />
    );
  }

  return (
    <Modal isOpen={isOpen} title="Connect GitLab Duo" onClose={handleClose} size="lg">
      <div className="flex flex-col gap-4">
        {/* Mode selection */}
        {!mode && (
          <>
            <p className="text-sm text-text-muted">
              Choose how to authenticate with GitLab Duo:
            </p>
            <div className="grid grid-cols-2 gap-3">
              <button type="button"
                onClick={() => dispatch({ type: "SET_MODE", value: "oauth" })}
                className="flex flex-col items-center gap-2 p-4 rounded-lg border border-border hover:border-primary hover:bg-primary/5 transition-colors text-left"
              >
                <span className="material-symbols-outlined text-2xl text-primary">lock_open</span>
                <div>
                  <p className="text-sm font-medium">OAuth App</p>
                  <p className="text-xs text-text-muted">Use a GitLab OAuth application</p>
                </div>
              </button>
              <button type="button"
                onClick={() => dispatch({ type: "SET_MODE", value: "pat" })}
                className="flex flex-col items-center gap-2 p-4 rounded-lg border border-border hover:border-primary hover:bg-primary/5 transition-colors text-left"
              >
                <span className="material-symbols-outlined text-2xl text-primary">key</span>
                <div>
                  <p className="text-sm font-medium">Personal Access Token</p>
                  <p className="text-xs text-text-muted">Use a GitLab PAT with api scope</p>
                </div>
              </button>
            </div>
          </>
        )}

        {/* OAuth mode */}
        {mode === "oauth" && (
          <>
            <p className="text-xs text-text-muted">
              Create an OAuth app at{" "}
              <a href={`${baseUrl.trim() || GITLAB_COM}/-/profile/applications`} target="_blank" rel="noreferrer" className="text-primary underline">
                GitLab Applications
              </a>{" "}
              with redirect URI{" "}
              <code className="bg-sidebar px-1 rounded text-xs">{getRedirectUri()}</code>
            </p>
            <Input label="GitLab Base URL" value={baseUrl} onChange={(e) => dispatch({ type: "SET_BASE_URL", value: e.target.value })} placeholder={GITLAB_COM} />
            <Input label="Client ID" value={clientId} onChange={(e) => dispatch({ type: "SET_CLIENT_ID", value: e.target.value })} placeholder="Your OAuth application client ID" />
            <Input label="Client Secret (optional for PKCE)" value={clientSecret} onChange={(e) => dispatch({ type: "SET_CLIENT_SECRET", value: e.target.value })} placeholder="Leave empty for public PKCE app" />
            {error && <p className="text-sm text-red-500">{error}</p>}
            <div className="flex gap-2">
              <Button onClick={handleOAuthStart} fullWidth disabled={!clientId.trim()}>
                Authorize
              </Button>
              <Button onClick={() => dispatch({ type: "SET_MODE", value: null })} variant="ghost" fullWidth>
                Back
              </Button>
            </div>
          </>
        )}

        {/* PAT mode */}
        {mode === "pat" && (
          <>
            <p className="text-xs text-text-muted">
              Create a PAT at{" "}
              <a href={`${baseUrl.trim() || GITLAB_COM}/-/user_settings/personal_access_tokens`} target="_blank" rel="noreferrer" className="text-primary underline">
                GitLab Access Tokens
              </a>{" "}
              with scopes: <code className="bg-sidebar px-1 rounded text-xs">api</code>,{" "}
              <code className="bg-sidebar px-1 rounded text-xs">read_user</code>, and{" "}
              <code className="bg-sidebar px-1 rounded text-xs">ai_features</code>.
            </p>
            <Input label="GitLab Base URL" value={baseUrl} onChange={(e) => dispatch({ type: "SET_BASE_URL", value: e.target.value })} placeholder={GITLAB_COM} />
            <Input label="Personal Access Token" value={pat} onChange={(e) => dispatch({ type: "SET_PAT", value: e.target.value })} placeholder="glpat-xxxxxxxxxxxxxxxxxxxx" type="password" />
            {error && <p className="text-sm text-red-500">{error}</p>}
            <div className="flex gap-2">
              <Button onClick={handlePATSubmit} fullWidth disabled={!pat.trim() || loading} loading={loading}>
                Connect
              </Button>
              <Button onClick={() => dispatch({ type: "SET_MODE", value: null })} variant="ghost" fullWidth>
                Back
              </Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

