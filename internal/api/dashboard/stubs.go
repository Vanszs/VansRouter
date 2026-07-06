package dashboard

import (
	"encoding/json"
	"net/http"
)

// StubsHandlers holds placeholder implementations for dashboard routes that
// are not fully ported to Go yet. They return empty but shape-valid responses
// so the frontend never hits a 404/500 while navigating the dashboard.
type StubsHandlers struct{}

// NewStubsHandlers creates stub handlers.
func NewStubsHandlers() *StubsHandlers {
	return &StubsHandlers{}
}

func (h *StubsHandlers) empty(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{})
}

func (h *StubsHandlers) ok(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"success": true})
}

// Auth stubs

// OIDCTest handles GET /api/auth/oidc/test.
func (h *StubsHandlers) OIDCTest(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"configured": false})
}

// Model stubs

// ModelsList handles GET /api/models.
func (h *StubsHandlers) ModelsList(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"models": []any{}})
}

// ModelAliases handles GET /api/models/alias.
func (h *StubsHandlers) ModelAliases(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodGet {
		writeJSON(w, http.StatusOK, map[string]any{"aliases": map[string]string{}})
		return
	}
	if r.Method == http.MethodPut {
		writeJSON(w, http.StatusOK, map[string]any{"success": true})
		return
	}
	if r.Method == http.MethodDelete {
		writeJSON(w, http.StatusOK, map[string]any{"success": true})
		return
	}
	writeError(w, http.StatusMethodNotAllowed, "method_not_allowed", "Method not allowed")
}

// ModelAvailability handles GET /api/models/availability.
func (h *StubsHandlers) ModelAvailability(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"models": []any{}})
}

// ModelCustom handles GET /api/models/custom.
func (h *StubsHandlers) ModelCustom(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"models": []any{}})
}

// ModelDisabled handles GET /api/models/disabled.
func (h *StubsHandlers) ModelDisabled(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"disabled": []any{}})
}

// ModelTest handles GET/POST /api/models/test.
func (h *StubsHandlers) ModelTest(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodPost {
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "error": nil, "latency": 0})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"result": map[string]any{}})
}

// Provider stubs

// ProvidersClient handles GET /api/providers/client.
func (h *StubsHandlers) ProvidersClient(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"providers": []any{}})
}

// ProvidersKiloFreeModels handles GET /api/providers/kilo/free-models.
func (h *StubsHandlers) ProvidersKiloFreeModels(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"models": []any{}})
}

// ProvidersTestBatch handles POST /api/providers/test-batch.
func (h *StubsHandlers) ProvidersTestBatch(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"results": []any{}})
}

// ProvidersValidate handles POST /api/providers/validate.
func (h *StubsHandlers) ProvidersValidate(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"valid": true})
}

// ProviderTest handles POST /api/providers/{id}/test.
func (h *StubsHandlers) ProviderTest(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"valid": true, "error": nil, "refreshed": false})
}

// ProviderNodesValidate handles POST /api/provider-nodes/validate.
func (h *StubsHandlers) ProviderNodesValidate(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"valid": true})
}

// Proxy pool stubs

// ProxyPoolsList handles GET /api/proxy-pools.
func (h *StubsHandlers) ProxyPoolsList(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"proxyPools": []any{}})
}

// ProxyPoolsCreate handles POST /api/proxy-pools.
func (h *StubsHandlers) ProxyPoolsCreate(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusCreated, map[string]any{"proxyPool": map[string]any{}})
}

// ProxyPoolsVercelDeploy handles POST /api/proxy-pools/vercel-deploy.
func (h *StubsHandlers) ProxyPoolsVercelDeploy(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "url": ""})
}

// ProxyPoolsCloudflareDeploy handles POST /api/proxy-pools/cloudflare-deploy.
func (h *StubsHandlers) ProxyPoolsCloudflareDeploy(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "url": ""})
}

// ProxyPoolsDenoDeploy handles POST /api/proxy-pools/deno-deploy.
func (h *StubsHandlers) ProxyPoolsDenoDeploy(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "url": ""})
}

// Settings stubs

// SettingsProxyTest handles GET /api/settings/proxy-test.
func (h *StubsHandlers) SettingsProxyTest(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"success": true})
}

// SettingsDatabase handles GET/POST /api/settings/database.
func (h *StubsHandlers) SettingsDatabase(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodPost {
		writeJSON(w, http.StatusOK, map[string]any{"success": true})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"size": 0, "tables": []any{}})
}

// Headroom start/stop

// HeadroomStart handles POST /api/headroom/start.
func (h *StubsHandlers) HeadroomStart(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"success": true})
}

// HeadroomStop handles POST /api/headroom/stop.
func (h *StubsHandlers) HeadroomStop(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"success": true})
}

// Tunnel action stubs

// TunnelEnable handles POST /api/tunnel/enable.
func (h *StubsHandlers) TunnelEnable(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"success": true})
}

// TunnelDisable handles POST /api/tunnel/disable.
func (h *StubsHandlers) TunnelDisable(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"success": true})
}

// TunnelTailscaleCheck handles POST /api/tunnel/tailscale-check.
func (h *StubsHandlers) TunnelTailscaleCheck(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"installed": false, "running": false})
}

// TunnelTailscaleInstall handles POST /api/tunnel/tailscale-install.
func (h *StubsHandlers) TunnelTailscaleInstall(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"success": true})
}

// TunnelTailscaleEnable handles POST /api/tunnel/tailscale-enable.
func (h *StubsHandlers) TunnelTailscaleEnable(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"success": true})
}

// TunnelTailscaleDisable handles POST /api/tunnel/tailscale-disable.
func (h *StubsHandlers) TunnelTailscaleDisable(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"success": true})
}

// Pricing stubs

// Pricing handles GET/PATCH/DELETE /api/pricing.
func (h *StubsHandlers) Pricing(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{})
}

// Translator stubs

// TranslatorLoad handles GET /api/translator/load.
func (h *StubsHandlers) TranslatorLoad(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"data": nil})
}

// TranslatorSave handles POST /api/translator/save.
func (h *StubsHandlers) TranslatorSave(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"success": true})
}

// TranslatorSend handles POST /api/translator/send.
func (h *StubsHandlers) TranslatorSend(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"success": true})
}

// TranslatorTranslate handles POST /api/translator/translate.
func (h *StubsHandlers) TranslatorTranslate(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "result": map[string]any{}})
}

// TranslatorConsoleLogs handles GET/DELETE /api/translator/console-logs.
func (h *StubsHandlers) TranslatorConsoleLogs(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodDelete {
		writeJSON(w, http.StatusOK, map[string]any{"success": true})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"logs": []any{}})
}

// TranslatorConsoleLogsStream handles GET /api/translator/console-logs/stream.
func (h *StubsHandlers) TranslatorConsoleLogsStream(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(":ok\n\n"))
}

// OAuth stubs

// OAuthCodexBulkImport handles GET /api/oauth/codex/bulk-import.
func (h *StubsHandlers) OAuthCodexBulkImport(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "imported": 0})
}

// CLI tool stubs

func cliToolSettingsResponse(tool string) map[string]any {
	return map[string]any{
		"installed":    false,
		"settings":     nil,
		"has9Router":   false,
		"settingsPath": "",
	}
}

// CliToolsAntigravityMitm handles GET/POST /api/cli-tools/antigravity-mitm.
func (h *StubsHandlers) CliToolsAntigravityMitm(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"installed": false, "settings": nil, "has9Router": false})
}

// CliToolsAntigravityMitmAlias handles GET /api/cli-tools/antigravity-mitm/alias.
func (h *StubsHandlers) CliToolsAntigravityMitmAlias(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"aliases": []any{}})
}

// CliToolsClaudeSettings handles GET/POST/DELETE /api/cli-tools/claude-settings.
func (h *StubsHandlers) CliToolsClaudeSettings(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, cliToolSettingsResponse("claude"))
}

// CliToolsClineSettings handles GET/POST/DELETE /api/cli-tools/cline-settings.
func (h *StubsHandlers) CliToolsClineSettings(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, cliToolSettingsResponse("cline"))
}

// CliToolsCodexSettings handles GET/POST/DELETE /api/cli-tools/codex-settings.
func (h *StubsHandlers) CliToolsCodexSettings(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, cliToolSettingsResponse("codex"))
}

// CliToolsCopilotSettings handles GET/POST/DELETE /api/cli-tools/copilot-settings.
func (h *StubsHandlers) CliToolsCopilotSettings(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, cliToolSettingsResponse("copilot"))
}

// CliToolsCoworkSettings handles GET/POST/DELETE /api/cli-tools/cowork-settings.
func (h *StubsHandlers) CliToolsCoworkSettings(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, cliToolSettingsResponse("cowork"))
}

// CliToolsCoworkMcpRegistry handles GET /api/cli-tools/cowork-mcp-registry.
func (h *StubsHandlers) CliToolsCoworkMcpRegistry(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"entries": []any{}})
}

// CliToolsCoworkMcpTools handles GET /api/cli-tools/cowork-mcp-tools.
func (h *StubsHandlers) CliToolsCoworkMcpTools(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"tools": []any{}})
}

// CliToolsAllStatuses handles GET /api/cli-tools/all-statuses.
func (h *StubsHandlers) CliToolsAllStatuses(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"statuses": map[string]any{}})
}

// CliToolsDeepseekTuiSettings handles GET/POST/DELETE /api/cli-tools/deepseek-tui-settings.
func (h *StubsHandlers) CliToolsDeepseekTuiSettings(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, cliToolSettingsResponse("deepseek-tui"))
}

// CliToolsDroidSettings handles GET/POST/DELETE /api/cli-tools/droid-settings.
func (h *StubsHandlers) CliToolsDroidSettings(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, cliToolSettingsResponse("droid"))
}

// CliToolsHermesSettings handles GET/POST/DELETE /api/cli-tools/hermes-settings.
func (h *StubsHandlers) CliToolsHermesSettings(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, cliToolSettingsResponse("hermes"))
}

// CliToolsJcodeSettings handles GET/POST/DELETE /api/cli-tools/jcode-settings.
func (h *StubsHandlers) CliToolsJcodeSettings(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, cliToolSettingsResponse("jcode"))
}

// CliToolsKiloSettings handles GET/POST/DELETE /api/cli-tools/kilo-settings.
func (h *StubsHandlers) CliToolsKiloSettings(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, cliToolSettingsResponse("kilo"))
}

// CliToolsOpenclawSettings handles GET/POST/DELETE /api/cli-tools/openclaw-settings.
func (h *StubsHandlers) CliToolsOpenclawSettings(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, cliToolSettingsResponse("openclaw"))
}

// CliToolsOpencodeSettings handles GET/POST/DELETE /api/cli-tools/opencode-settings.
func (h *StubsHandlers) CliToolsOpencodeSettings(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, cliToolSettingsResponse("opencode"))
}

// V1 media stubs

// V1AudioTranscriptions handles POST /api/v1/audio/transcriptions.
func (h *StubsHandlers) V1AudioTranscriptions(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"text": ""})
}

// V1Embeddings handles POST /api/v1/embeddings.
func (h *StubsHandlers) V1Embeddings(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Input any `json:"input"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)
	writeJSON(w, http.StatusOK, map[string]any{
		"object": "list",
		"data":   []any{},
		"model":  "",
		"usage":  map[string]int{"prompt_tokens": 0, "total_tokens": 0},
	})
}

// Init handles GET /api/init. Returns a plain-text ack to match the FE.
func (h *StubsHandlers) Init(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/plain")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte("Initialized"))
}

// Locale handles POST /api/locale.
func (h *StubsHandlers) Locale(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Locale string `json:"locale"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)
	if body.Locale == "" {
		body.Locale = "en"
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "locale": body.Locale})
}

// Tags handles GET /api/tags.
func (h *StubsHandlers) Tags(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	writeJSON(w, http.StatusOK, []any{})
}

// MCPMessage handles POST /api/mcp/{plugin}/message.
func (h *StubsHandlers) MCPMessage(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// MCPSSE handles GET /api/mcp/{plugin}/sse.
func (h *StubsHandlers) MCPSSE(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(":ok\n\n"))
}

// TTSVoices handles GET /api/media-providers/tts/voices.
func (h *StubsHandlers) TTSVoices(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"voices": []any{}})
}

// TTSProviderVoices handles GET /api/media-providers/tts/{provider}/voices.
func (h *StubsHandlers) TTSProviderVoices(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"voices": []any{}})
}

// OIDCStart handles GET /api/auth/oidc/start.
func (h *StubsHandlers) OIDCStart(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusNotImplemented, map[string]any{
		"error": "oidc_not_configured",
		"message": "OIDC is not implemented in the go port yet",
	})
}

// OIDCCallback handles GET /api/auth/oidc/callback.
func (h *StubsHandlers) OIDCCallback(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusNotImplemented, map[string]any{
		"error": "oidc_not_implemented",
	})
}

// SettingsRequireLogin handles GET /api/settings/require-login.
func (h *StubsHandlers) SettingsRequireLogin(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"requireLogin":          true,
		"tunnelDashboardAccess": true,
		"tunnelUrl":             "",
		"tailscaleUrl":          "",
	})
}

// VersionShutdown handles POST /api/version/shutdown.
func (h *StubsHandlers) VersionShutdown(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"success":     true,
		"runtime":     "go",
		"mode":        "manual",
		"autoRestart": false,
		"message":     "Update scheduled. Shutdown is not implemented in the go port yet.",
	})
}

// VersionUpdate handles POST /api/version/update.
func (h *StubsHandlers) VersionUpdate(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"success": true,
		"message": "Updater is not implemented in the go port yet.",
	})
}

// UsageRequestLogs handles GET /api/usage/request-logs.
func (h *StubsHandlers) UsageRequestLogs(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"logs": []any{}})
}

// ProviderNodeGet handles GET /api/provider-nodes/{id}.
func (h *StubsHandlers) ProviderNodeGet(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusNotFound, map[string]any{"error": "Provider node not found"})
}

// ProviderNodeUpdate handles PUT /api/provider-nodes/{id}.
func (h *StubsHandlers) ProviderNodeUpdate(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"node": map[string]any{}})
}

// ProviderNodeDelete handles DELETE /api/provider-nodes/{id}.
func (h *StubsHandlers) ProviderNodeDelete(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"success": true})
}

// ProviderConnectionGet handles GET /api/providers/{id}.
func (h *StubsHandlers) ProviderConnectionGet(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusNotFound, map[string]any{"error": "Connection not found"})
}

// ProviderConnectionUpdate handles PUT /api/providers/{id}.
func (h *StubsHandlers) ProviderConnectionUpdate(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"connection": map[string]any{}})
}

// ProviderConnectionDelete handles DELETE /api/providers/{id}.
func (h *StubsHandlers) ProviderConnectionDelete(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"message": "Connection deleted successfully"})
}

// ProviderModels handles GET /api/providers/{id}/models.
func (h *StubsHandlers) ProviderModels(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"provider":     "",
		"connectionId": "",
		"models":       []any{},
	})
}

// ProviderTestModels handles POST /api/providers/{id}/test-models.
func (h *StubsHandlers) ProviderTestModels(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"provider":     "",
		"connectionId": "",
		"results":      []any{},
	})
}

// ProviderSuggestedModels handles GET /api/providers/suggested-models.
func (h *StubsHandlers) ProviderSuggestedModels(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"data": []any{}})
}

// ProxyPoolGet handles GET /api/proxy-pools/{id}.
func (h *StubsHandlers) ProxyPoolGet(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusNotFound, map[string]any{"error": "Proxy pool not found"})
}

// ProxyPoolUpdate handles PUT /api/proxy-pools/{id}.
func (h *StubsHandlers) ProxyPoolUpdate(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"proxyPool": map[string]any{}})
}

// ProxyPoolDelete handles DELETE /api/proxy-pools/{id}.
func (h *StubsHandlers) ProxyPoolDelete(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"success": true})
}

// ProxyPoolTest handles POST /api/proxy-pools/{id}/test.
func (h *StubsHandlers) ProxyPoolTest(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"ok":        false,
		"status":    0,
		"error":     "not implemented in go port",
		"elapsedMs": 0,
		"testedAt":  "",
	})
}

// OAuthCodexImportToken handles POST /api/oauth/codex/import-token.
func (h *StubsHandlers) OAuthCodexImportToken(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"success":    true,
		"connection": map[string]any{},
	})
}

// OAuthCursorAutoImport handles GET /api/oauth/cursor/auto-import.
func (h *StubsHandlers) OAuthCursorAutoImport(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"found": false,
		"error": "not implemented in go port",
	})
}

// OAuthCursorImport handles GET/POST /api/oauth/cursor/import.
func (h *StubsHandlers) OAuthCursorImport(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodGet {
		writeJSON(w, http.StatusOK, map[string]any{
			"provider":       "cursor",
			"method":         "import_token",
			"instructions":   "",
			"requiredFields": []any{},
		})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"success":    true,
		"connection": map[string]any{},
	})
}

// OAuthGitlabPAT handles POST /api/oauth/gitlab/pat.
func (h *StubsHandlers) OAuthGitlabPAT(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"success": true})
}

// OAuthIflowCookie handles POST /api/oauth/iflow/cookie.
func (h *StubsHandlers) OAuthIflowCookie(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"success":    true,
		"connection": map[string]any{},
	})
}

// OAuthKiroApiKey handles POST /api/oauth/kiro/api-key.
func (h *StubsHandlers) OAuthKiroApiKey(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"success":    true,
		"connection": map[string]any{},
	})
}

// OAuthKiroAutoImport handles GET /api/oauth/kiro/auto-import.
func (h *StubsHandlers) OAuthKiroAutoImport(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"found": false,
		"error": "not implemented in go port",
	})
}

// OAuthKiroImportCliProxy handles POST /api/oauth/kiro/import-cli-proxy.
func (h *StubsHandlers) OAuthKiroImportCliProxy(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"success":    true,
		"connection": map[string]any{},
	})
}

// OAuthKiroImport handles POST /api/oauth/kiro/import.
func (h *StubsHandlers) OAuthKiroImport(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"success":    true,
		"connection": map[string]any{},
	})
}

// OAuthKiroSocialAuthorize handles GET /api/oauth/kiro/social-authorize.
func (h *StubsHandlers) OAuthKiroSocialAuthorize(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"url": ""})
}

// OAuthKiroSocialExchange handles POST /api/oauth/kiro/social-exchange.
func (h *StubsHandlers) OAuthKiroSocialExchange(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"success":    true,
		"connection": map[string]any{},
	})
}

// OAuthProviderAction handles GET/POST /api/oauth/{provider}/{action}.
func (h *StubsHandlers) OAuthProviderAction(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"success":    true,
		"connection": map[string]any{},
	})
}
