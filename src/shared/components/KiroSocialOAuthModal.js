"use client";

import { useEffect, useRef, useReducer } from "react";
import PropTypes from "prop-types";
import { Modal, Button, Input } from "@/shared/components";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";

function socialReducer(state, action) {
  switch (action.type) {
    case "INIT": return { ...state, error: null, step: "loading" };
    case "AUTH_READY": return { ...state, step: "input", authUrl: action.authUrl, authData: action.data };
    case "AUTH_ERROR": return { ...state, step: "error", error: action.error };
    case "SET_CALLBACK": return { ...state, callbackUrl: action.value };
    case "CLEAR_ERROR": return { ...state, error: null };
    case "GO_INPUT": return { ...state, step: "input", error: null };
    case "SUCCESS": return { ...state, step: "success" };
    default: return state;
  }
}

/**
 * Kiro Social OAuth Modal (Google/GitHub)
 * Handles manual callback URL flow for social login
 */
export default function KiroSocialOAuthModal({ isOpen, provider, onSuccess, onClose }) {
  const [state, dispatch] = useReducer(socialReducer, { step: "loading", authUrl: "", authData: null, callbackUrl: "", error: null });
  const { step, authUrl, authData, callbackUrl, error } = state;
  const { copied, copy } = useCopyToClipboard();
  const openedRef = useRef(false);
  const prevOpenRef = useRef(false);

  // Initialize auth flow when modal opens
  useEffect(() => {
    if (isOpen && !prevOpenRef.current && provider) {
      openedRef.current = false;
      const initAuth = async () => {
        try {
          dispatch({ type: "INIT" });

          const res = await fetch(`/api/oauth/kiro/social-authorize?provider=${provider}`);
          const data = await res.json();

          if (!res.ok) {
            throw new Error(data.error);
          }

          dispatch({ type: "AUTH_READY", authUrl: data.authUrl, data });

          // Auto-open browser once per modal session.
          if (!openedRef.current) {
            openedRef.current = true;
            window.open(data.authUrl, "_blank");
          }
        } catch (err) {
          dispatch({ type: "AUTH_ERROR", error: err.message });
        }
      };
      initAuth();
    }
    prevOpenRef.current = isOpen;
  }, [isOpen, provider]);

  const handleManualSubmit = async () => {
    try {
      dispatch({ type: "CLEAR_ERROR" });
      
      // Parse callback URL - can be either kiro:// or http://localhost format
      let url;
      try {
        url = new URL(callbackUrl);
      } catch (e) {
        // If URL parsing fails, might be malformed
        throw new Error("Invalid callback URL format");
      }

      const code = url.searchParams.get("code");
      const urlState = url.searchParams.get("state");
      const errorParam = url.searchParams.get("error");

      if (errorParam) {
        throw new Error(url.searchParams.get("error_description") || errorParam);
      }

      if (!code) {
        throw new Error("No authorization code found in URL");
      }

      // Exchange code for tokens
      const res = await fetch("/api/oauth/kiro/social-exchange", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code,
          codeVerifier: authData.codeVerifier,
          provider,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      dispatch({ type: "SUCCESS" });
      onSuccess?.();
    } catch (err) {
      dispatch({ type: "AUTH_ERROR", error: err.message });
    }
  };

  const providerName = provider === "google" ? "Google" : "GitHub";

  return (
    <Modal isOpen={isOpen} title={`Connect Kiro via ${providerName}`} onClose={onClose} size="lg">
      <div className="flex flex-col gap-4">
        {/* Loading */}
        {step === "loading" && (
          <div className="text-center py-6">
            <div className="size-16 mx-auto mb-4 rounded-full bg-primary/10 flex items-center justify-center">
              <span className="material-symbols-outlined text-3xl text-primary animate-spin">
                progress_activity
              </span>
            </div>
            <h3 className="text-lg font-semibold mb-2">Initializing...</h3>
            <p className="text-sm text-text-muted">
              Setting up {providerName} authentication
            </p>
          </div>
        )}

        {/* Manual Input Step */}
        {step === "input" && (
          <>
            <div className="space-y-4">
              <div>
                <p className="text-sm font-medium mb-2">Step 1: Open this URL in your browser</p>
                <div className="flex gap-2">
                  <Input value={authUrl} readOnly className="flex-1 font-mono text-xs" />
                  <Button 
                    variant="secondary" 
                    icon={copied === "auth_url" ? "check" : "content_copy"} 
                    onClick={() => copy(authUrl, "auth_url")}
                  >
                    Copy
                  </Button>
                </div>
              </div>

              <div>
                <p className="text-sm font-medium mb-2">Step 2: Paste the callback URL here</p>
                <p className="text-xs text-text-muted mb-2">
                  After authorization, copy the full URL from your browser address bar.
                </p>
                <Input
                  value={callbackUrl}
                  onChange={(e) => dispatch({ type: "SET_CALLBACK", value: e.target.value })}
                  placeholder="kiro://kiro.kiroAgent/authenticate-success?code=..."
                  className="font-mono text-xs"
                />
              </div>
            </div>

            <div className="flex gap-2">
              <Button onClick={handleManualSubmit} fullWidth disabled={!callbackUrl}>
                Connect
              </Button>
              <Button onClick={onClose} variant="ghost" fullWidth>
                Cancel
              </Button>
            </div>
          </>
        )}

        {/* Success */}
        {step === "success" && (
          <div className="text-center py-6">
            <div className="size-16 mx-auto mb-4 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
              <span className="material-symbols-outlined text-3xl text-green-600">check_circle</span>
            </div>
            <h3 className="text-lg font-semibold mb-2">Connected Successfully!</h3>
            <p className="text-sm text-text-muted mb-4">
              Your Kiro account via {providerName} has been connected.
            </p>
            <Button onClick={onClose} fullWidth>
              Done
            </Button>
          </div>
        )}

        {/* Error */}
        {step === "error" && (
          <div className="text-center py-6">
            <div className="size-16 mx-auto mb-4 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
              <span className="material-symbols-outlined text-3xl text-red-600">error</span>
            </div>
            <h3 className="text-lg font-semibold mb-2">Connection Failed</h3>
            <p className="text-sm text-red-600 mb-4">{error}</p>
            <div className="flex gap-2">
              <Button onClick={() => dispatch({ type: "GO_INPUT" })} variant="secondary" fullWidth>
                Try Again
              </Button>
              <Button onClick={onClose} variant="ghost" fullWidth>
                Cancel
              </Button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

KiroSocialOAuthModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  provider: PropTypes.oneOf(["google", "github"]).isRequired,
  onSuccess: PropTypes.func,
  onClose: PropTypes.func.isRequired,
};
