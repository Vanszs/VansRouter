"use client";

import { useState, useCallback, useEffect } from "react";
import OAuthModal from "./OAuthModal";
import KiroAuthModal from "./KiroAuthModal";
import KiroSocialOAuthModal from "./KiroSocialOAuthModal";

/**
 * Kiro OAuth Wrapper
 * Orchestrates between method selection, device code flow, and social login flow
 */
export default function KiroOAuthWrapper({
  isOpen,
  providerInfo,
  onSuccess,
  onRefresh,
  onClose,
  initialBulkJobId,
  initialFlow,
  onBulkJobChange,
}) {
  const [authMethod, setAuthMethod] = useState(null); // null | "builder-id" | "idc" | "social" | "import"
  const [socialProvider, setSocialProvider] = useState(null); // "google" | "github"
  const [idcConfig, setIdcConfig] = useState(null);

  useEffect(() => {
    if (!isOpen || !initialFlow) return;
    /* eslint-disable react-hooks/set-state-in-effect -- sync initialFlow prop to local UI state */
    if (initialFlow.method === "builder-id") {
      setAuthMethod("builder-id");
      return;
    }
    if (initialFlow.method === "social") {
      setAuthMethod("social");
      setSocialProvider(initialFlow.provider || "google");
      return;
    }
    setAuthMethod(null);
    setSocialProvider(null);
    setIdcConfig(null);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [initialFlow, isOpen]);

  const handleMethodSelect = useCallback((method, config) => {
    if (method === "builder-id") {
      // Use device code flow (AWS Builder ID)
      setAuthMethod("builder-id");
    } else if (method === "idc") {
      // Use device code flow with IDC config
      setAuthMethod("idc");
      setIdcConfig(config);
    } else if (method === "social") {
      // Use social login with manual callback
      setAuthMethod("social");
      setSocialProvider(config.provider);
    } else if (method === "import" || method === "api-key") {
      // Import / API-key handled in KiroAuthModal, just close
      onSuccess?.();
    }
  }, [onSuccess]);

  const handleBack = () => {
    setAuthMethod(null);
    setSocialProvider(null);
    setIdcConfig(null);
  };

  const handleSocialSuccess = () => {
    setAuthMethod(null);
    setSocialProvider(null);
    onSuccess?.();
    onClose?.(); // Close modal after success
  };

  const handleDeviceSuccess = () => {
    setAuthMethod(null);
    setIdcConfig(null);
    onSuccess?.();
    onClose?.(); // Close modal after success
  };

  // Show method selection first
  if (!authMethod) {
    return (
      <KiroAuthModal
        isOpen={isOpen}
        onMethodSelect={handleMethodSelect}
        onImportSuccess={onRefresh || onSuccess}
        initialJobId={initialBulkJobId}
        initialSelectedMethod={
          initialFlow?.method === "import"
            ? "import"
            : initialFlow?.method === "idc"
              ? "idc"
              : undefined
        }
        initialImportMode={initialFlow?.method === "import" ? initialFlow.importMode : undefined}
        initialFlowKey={initialFlow?.key}
        onBulkJobChange={onBulkJobChange}
        onClose={onClose}
      />
    );
  }

  // Show device code flow (Builder ID or IDC)
  if (authMethod === "builder-id" || authMethod === "idc") {
    return (
      <OAuthModal
        isOpen={isOpen}
        provider="kiro"
        providerInfo={providerInfo}
        onSuccess={handleDeviceSuccess}
        onClose={handleBack}
        idcConfig={idcConfig}
      />
    );
  }

  // Show social login flow (Google/GitHub with manual callback)
  if (authMethod === "social" && socialProvider) {
    return (
      <KiroSocialOAuthModal
        isOpen={isOpen}
        provider={socialProvider}
        onSuccess={handleSocialSuccess}
        onClose={handleBack}
      />
    );
  }

  return null;
}
