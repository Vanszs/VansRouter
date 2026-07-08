package dashboard

import (
	"encoding/json"
	"strings"
	"net/http"
	"strconv"

	"github.com/9router/9router/internal/db/repos"
	"github.com/9router/9router/internal/models"
	"github.com/9router/9router/internal/network"
	"github.com/go-chi/chi/v5"
)

// StubsHandlers holds placeholder implementations for dashboard routes that
// are not fully ported to Go yet. They return empty but shape-valid responses
// so the frontend never hits a 404/500 while navigating the dashboard.
type StubsHandlers struct {
	// Builder is the model list builder, used by ModelsList to serve the
	// /api/models route with real data instead of an empty stub.
	Builder *models.Builder
	Repos *repos.Repos
}

// NewStubsHandlers creates stub handlers. The builder parameter is optional;
// pass nil to keep the old empty-stub behaviour for routes that don't need it.
func NewStubsHandlers(builder *models.Builder, repos *repos.Repos) *StubsHandlers {
	return &StubsHandlers{Builder: builder, Repos: repos}
}

func (h *StubsHandlers) empty(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{})
}

func (h *StubsHandlers) ok(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"success": true})
}

// cliToolSettingsResponse returns the shape frontend cli-tools/*-settings
// routes read on GET. POST/DELETE return { success, message }.
func cliToolSettingsResponse(tool string) map[string]any {
	return map[string]any{
		"installed":    false,
		"settings":     nil,
		"has9Router":   false,
		"settingsPath": "",
		"message":      tool + " CLI is not installed",
	}
}

// cliToolSaveResponse matches the shape returned by POST/DELETE on
// cli-tools/*-settings routes.
func cliToolSaveResponse(tool string) map[string]any {
	return map[string]any{
		"success": true,
		"message": tool + " settings updated successfully",
	}
}

// oauthConnectionResponse returns the trimmed connection payload the FE
// expects after a successful OAuth import.
func oauthConnectionResponse() map[string]any {
	return map[string]any{
		"id":           "",
		"provider":     "",
		"email":        nil,
		"displayName":  nil,
		"name":         nil,
		"workspace":    nil,
		"plan":         nil,
	}
}

// Auth stubs

// OIDCTest handles POST /api/auth/oidc/test. Mirrors the JS test handler
// that probes OIDC discovery + client secret.
func (h *StubsHandlers) OIDCTest(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"ok":                 false,
		"discoveryOk":        false,
		"clientSecretTested": false,
		"clientSecretValid":  false,
		"issuerUrl":          "",
		"clientId":           "",
		"scopes":             "openid profile email",
		"redirectUri":        "",
		"authorizationEndpoint": "",
		"tokenEndpoint":      "",
		"jwksUri":            "",
		"message":            "OIDC test is not implemented in the go port yet",
	})
}

// Model stubs

// ModelsList handles GET /api/models.
// If the handler was created with a Builder, it serves the real model list;
// otherwise it falls back to the empty-stub response.
func (h *StubsHandlers) ModelsList(w http.ResponseWriter, r *http.Request) {
	if h.Builder == nil {
		writeJSON(w, http.StatusOK, map[string]any{"models": []any{}})
		return
	}
	list, err := h.Builder.BuildModelsList(r.Context(), models.AllKinds)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal_error", "Failed to build models list")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"models": list})
}

// ModelAliases handles GET /api/models/alias.
func (h *StubsHandlers) ModelAliases(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		writeJSON(w, http.StatusOK, map[string]any{"aliases": map[string]string{}})
	case http.MethodPut:
		writeJSON(w, http.StatusOK, map[string]any{"success": true, "model": "", "alias": ""})
	case http.MethodDelete:
		writeJSON(w, http.StatusOK, map[string]any{"success": true})
	default:
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed", "Method not allowed")
	}
}

// ModelAvailability handles GET /api/models/availability.
func (h *StubsHandlers) ModelAvailability(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"models":           []any{},
		"unavailableCount": 0,
	})
}

// ModelCustom handles GET /api/models/custom.
func (h *StubsHandlers) ModelCustom(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"models": []any{}})
}

// ModelDisabled handles GET /api/models/disabled.
func (h *StubsHandlers) ModelDisabled(w http.ResponseWriter, r *http.Request) {
	if r.URL.Query().Get("providerAlias") != "" {
		writeJSON(w, http.StatusOK, map[string]any{"ids": []any{}})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"disabled": map[string]any{}})
}

// ModelTest handles GET/POST /api/models/test. JS handler only exports POST
// and forwards to pingModelByKind; stub returns the keys FE code reads.
func (h *StubsHandlers) ModelTest(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodPost {
		writeJSON(w, http.StatusOK, map[string]any{
			"ok":      false,
			"error":   "model ping is not implemented in the go port yet",
			"latency": 0,
			"model":   "",
		})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"result": map[string]any{}})
}

// Provider stubs

// ProvidersClient handles GET /api/providers/client. Matches the JS shape
// (connections list + pagination + totals). When Repos is available, serves
// real provider connections from the database.
func (h *StubsHandlers) ProvidersClient(w http.ResponseWriter, r *http.Request) {
	if h.Repos == nil {
		writeJSON(w, http.StatusOK, map[string]any{
			"connections":   []any{},
			"providerOptions": []any{},
			"pagination": map[string]any{
				"page":      1,
				"pageSize":  20,
				"total":     0,
				"totalPages": 1,
			},
			"totals": map[string]any{
				"eligibleConnections":         0,
				"providerFilteredConnections": 0,
			},
		})
		return
	}

	// Parse pagination parameters from query string.
	page := 1
	pageSize := 20
	if p, err := strconv.Atoi(r.URL.Query().Get("page")); err == nil && p > 0 {
		page = p
	}
	if ps, err := strconv.Atoi(r.URL.Query().Get("pageSize")); err == nil && ps > 0 && ps <= 100 {
		pageSize = ps
	}
	providerFilter := r.URL.Query().Get("provider")

	allConnections, err := h.Repos.Accounts.List(providerFilter, nil)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal_error", "Failed to list connections")
		return
	}

	// Strip sensitive fields from connections.
	safeConnections := make([]map[string]any, 0, len(allConnections))
	for _, c := range allConnections {
		m := connectionToMap(c)
		delete(m, "apiKey")
		delete(m, "accessToken")
		delete(m, "refreshToken")
		delete(m, "idToken")
		safeConnections = append(safeConnections, m)
	}

	total := len(safeConnections)
	totalPages := 1
	if pageSize > 0 {
		totalPages = (total + pageSize - 1) / pageSize
	}

	// Apply pagination slice.
	start := (page - 1) * pageSize
	if start > total {
		start = total
	}
	end := start + pageSize
	if end > total {
		end = total
	}
	paged := safeConnections[start:end]

	writeJSON(w, http.StatusOK, map[string]any{
		"connections":   paged,
		"providerOptions": []any{},
		"pagination": map[string]any{
			"page":       page,
			"pageSize":   pageSize,
			"total":      total,
			"totalPages": totalPages,
		},
		"totals": map[string]any{
			"eligibleConnections":         total,
			"providerFilteredConnections": total,
		},
	})
}

// ProvidersKiloFreeModels handles GET /api/providers/kilo/free-models.
func (h *StubsHandlers) ProvidersKiloFreeModels(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"models": []any{}, "cached": false})
}

// ProvidersTestBatch handles POST /api/providers/test-batch.
func (h *StubsHandlers) ProvidersTestBatch(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"mode":       "",
		"providerId": nil,
		"results":    []any{},
		"testedAt":   "",
		"summary":    map[string]int{"total": 0, "passed": 0, "failed": 0},
	})
}

// ProvidersValidate handles POST /api/providers/validate.
func (h *StubsHandlers) ProvidersValidate(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"valid": false,
		"error": "validation is not implemented in the go port yet",
	})
}

// ProviderTest handles POST /api/providers/{id}/test.
func (h *StubsHandlers) ProviderTest(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"valid":     false,
		"error":     "test is not implemented in the go port yet",
		"refreshed": false,
	})
}

// ProviderNodesValidate handles POST /api/provider-nodes/validate.
func (h *StubsHandlers) ProviderNodesValidate(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"valid": false,
		"error": "node validation is not implemented in the go port yet",
	})
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
	writeJSON(w, http.StatusOK, map[string]any{
		"error": "vercel deploy is not implemented in the go port yet",
	})
}

// ProxyPoolsCloudflareDeploy handles POST /api/proxy-pools/cloudflare-deploy.
func (h *StubsHandlers) ProxyPoolsCloudflareDeploy(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"error": "cloudflare deploy is not implemented in the go port yet",
	})
}

// ProxyPoolsDenoDeploy handles POST /api/proxy-pools/deno-deploy.
func (h *StubsHandlers) ProxyPoolsDenoDeploy(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"error": "deno deploy is not implemented in the go port yet",
	})
}

// Settings stubs

// SettingsProxyTest handles POST /api/settings/proxy-test.
// Reads JSON body: { proxyUrl, testUrl?, timeoutMs? } and tests connectivity
// through the proxy using the network package.
func (h *StubsHandlers) SettingsProxyTest(w http.ResponseWriter, r *http.Request) {
	var body struct {
		ProxyURL  string `json:"proxyUrl"`
		TestURL   string `json:"testUrl"`
		TimeoutMs int    `json:"timeoutMs"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_body", "Invalid JSON body")
		return
	}

	result := network.TestProxyURL(r.Context(), body.ProxyURL, body.TestURL, body.TimeoutMs)
	writeJSON(w, http.StatusOK, result)
}

// SettingsDatabase handles GET/POST /api/settings/database. JS exports
// exportDb payload on GET (a full DB dump object) and { success: true }
// on POST import. When Repos is available, serves real counts and data.
func (h *StubsHandlers) SettingsDatabase(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodPost {
		writeJSON(w, http.StatusOK, map[string]any{"success": true})
		return
	}

	// GET: exportDb returns the full settings/connections/etc shape.
	if h.Repos == nil {
		// Stub returns a minimal valid object so the FE doesn't choke.
		writeJSON(w, http.StatusOK, map[string]any{
			"settings":   map[string]any{},
			"keys":       []any{},
			"combos":     []any{},
			"providers":  []any{},
			"proxyPools": []any{},
		})
		return
	}

	// Build real export payload from database.
	settings, err := h.Repos.Settings.Get()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal_error", "Failed to read settings")
		return
	}

	keys, err := h.Repos.Keys.List()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal_error", "Failed to read keys")
		return
	}

	// Combos are stored in a separate table, query directly.
	var combos []map[string]any
	rows, err := h.Repos.DB.Query(`SELECT id, name, COALESCE(kind, '') AS kind, models, createdAt, updatedAt FROM combos ORDER BY name`)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal_error", "Failed to read combos")
		return
	}
	defer rows.Close()
	for rows.Next() {
		var c struct {
			ID        string
			Name      string
			Kind      string
			Models    string
			CreatedAt string
			UpdatedAt string
		}
		if err := rows.Scan(&c.ID, &c.Name, &c.Kind, &c.Models, &c.CreatedAt, &c.UpdatedAt); err != nil {
			writeError(w, http.StatusInternalServerError, "internal_error", "Failed to scan combo")
			return
		}
		var models []any
		_ = json.Unmarshal([]byte(c.Models), &models)
		combos = append(combos, map[string]any{
			"id":        c.ID,
			"name":      c.Name,
			"kind":      c.Kind,
			"models":    models,
			"createdAt": c.CreatedAt,
			"updatedAt": c.UpdatedAt,
		})
	}
	if combos == nil {
		combos = []map[string]any{}
	}

	providers, err := h.Repos.Accounts.List("", nil)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal_error", "Failed to read providers")
		return
	}
	providerMaps := make([]map[string]any, 0, len(providers))
	for _, p := range providers {
		providerMaps = append(providerMaps, connectionToMap(p))
	}

	proxyPools, err := h.Repos.ProxyPools.List(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal_error", "Failed to read proxy pools")
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"settings":   settings,
		"keys":       keys,
		"combos":     combos,
		"providers":  providerMaps,
		"proxyPools": proxyPools,
	})
}

// Headroom start/stop. JS handler returns `{success, ...result}` for start
// and `{stopped, pid, ...}` with 200/409 for stop.

// HeadroomStart handles POST /api/headroom/start.
func (h *StubsHandlers) HeadroomStart(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"success": true,
		"pid":     nil,
		"port":    nil,
	})
}

// HeadroomStop handles POST /api/headroom/stop.
func (h *StubsHandlers) HeadroomStop(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"stopped": false,
		"error":   "headroom stop is not implemented in the go port yet",
		"code":    nil,
	})
}

// Tunnel action stubs

// TunnelEnable handles POST /api/tunnel/enable. JS handler returns the
// enableTunnel() result which is `{ success, url, ... }`.
func (h *StubsHandlers) TunnelEnable(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"success": false,
		"error":   "tunnel enable is not implemented in the go port yet",
	})
}

// TunnelDisable handles POST /api/tunnel/disable.
func (h *StubsHandlers) TunnelDisable(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"success": false,
		"error":   "tunnel disable is not implemented in the go port yet",
	})
}

// TunnelTailscaleCheck handles GET /api/tunnel/tailscale-check.
func (h *StubsHandlers) TunnelTailscaleCheck(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"installed":           false,
		"loggedIn":            false,
		"platform":            "",
		"brewAvailable":       false,
		"daemonRunning":       false,
		"customDaemonRunning": false,
		"systemDaemonRunning": false,
		"hasCachedPassword":   false,
	})
}

// TunnelTailscaleInstall handles POST /api/tunnel/tailscale-install.
// JS handler streams progress as SSE; stub emits one immediate error event.
func (h *StubsHandlers) TunnelTailscaleInstall(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte("event: error\ndata: {\"error\":\"tailscale install is not implemented in the go port yet\"}\n\n"))
}

// TunnelTailscaleEnable handles POST /api/tunnel/tailscale-enable.
func (h *StubsHandlers) TunnelTailscaleEnable(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"success": false,
		"error":   "tailscale enable is not implemented in the go port yet",
	})
}

// TunnelTailscaleDisable handles POST /api/tunnel/tailscale-disable.
func (h *StubsHandlers) TunnelTailscaleDisable(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"success": false,
		"error":   "tailscale disable is not implemented in the go port yet",
	})
}

// Pricing stubs

// Pricing handles GET/PATCH/DELETE /api/pricing. JS GET returns the pricing
// object (provider -> model -> {input, output, ...}) directly.
func (h *StubsHandlers) Pricing(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{})
}

// Translator stubs

// TranslatorLoad handles GET /api/translator/load. JS returns
// { success, content } on success, { success: false, error } on miss.
func (h *StubsHandlers) TranslatorLoad(w http.ResponseWriter, r *http.Request) {
	if r.URL.Query().Get("file") == "" {
		writeJSON(w, http.StatusBadRequest, map[string]any{
			"success": false,
			"error":   "File parameter required",
		})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "content": ""})
}

// TranslatorSave handles POST /api/translator/save.
func (h *StubsHandlers) TranslatorSave(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"success": true,
	})
}

// TranslatorSend handles POST /api/translator/send. JS handler streams the
// executor response as SSE; stub returns a JSON ack.
func (h *StubsHandlers) TranslatorSend(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"success": false,
		"error":   "translator send is not implemented in the go port yet",
	})
}

// TranslatorTranslate handles POST /api/translator/translate.
func (h *StubsHandlers) TranslatorTranslate(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"success": true,
		"result":  map[string]any{},
	})
}

// TranslatorConsoleLogs handles GET/DELETE /api/translator/console-logs.
func (h *StubsHandlers) TranslatorConsoleLogs(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodDelete {
		writeJSON(w, http.StatusOK, map[string]any{"success": true})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "logs": []any{}})
}

// TranslatorConsoleLogsStream handles GET /api/translator/console-logs/stream.
// JS streams `data: {type, line/logs/clear}\n\n` SSE events; stub writes one
// empty init event so clients that expect SSE parsing don't error out.
func (h *StubsHandlers) TranslatorConsoleLogsStream(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte("data: {\"type\":\"init\",\"logs\":[]}\n\n"))
}

// OAuth stubs

// OAuthCodexBulkImport handles POST /api/oauth/codex/bulk-import.
func (h *StubsHandlers) OAuthCodexBulkImport(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"success": 0,
		"failed":  0,
		"results": []any{},
	})
}

// CLI tool stubs

// CliToolsAntigravityMitm handles GET/POST/DELETE/PATCH
// /api/cli-tools/antigravity-mitm. JS GET returns the full status object.
func (h *StubsHandlers) CliToolsAntigravityMitm(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		writeJSON(w, http.StatusOK, map[string]any{
			"running":            false,
			"pid":                nil,
			"certExists":         false,
			"certTrusted":        false,
			"dnsStatus":          map[string]any{},
			"hasCachedPassword":  false,
			"isWin":              false,
			"needsSudoPassword":  false,
			"isAdmin":            false,
			"mitmRouterBaseUrl":  "http://localhost:20128",
		})
	case http.MethodPost:
		writeJSON(w, http.StatusOK, map[string]any{
			"success": false,
			"running": false,
			"pid":     nil,
			"error":   "antigravity-mitm is not implemented in the go port yet",
		})
	case http.MethodDelete:
		writeJSON(w, http.StatusOK, map[string]any{
			"success": true,
			"running": false,
		})
	case http.MethodPatch:
		writeJSON(w, http.StatusOK, map[string]any{
			"success":    true,
			"dnsStatus":  map[string]any{},
		})
	default:
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed", "Method not allowed")
	}
}

// CliToolsAntigravityMitmAlias handles GET /api/cli-tools/antigravity-mitm/alias.
func (h *StubsHandlers) CliToolsAntigravityMitmAlias(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodPut {
		writeJSON(w, http.StatusOK, map[string]any{
			"success": true,
			"aliases": map[string]any{},
		})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"aliases": []any{}})
}

// CliToolsClaudeSettings handles GET/POST/DELETE /api/cli-tools/claude-settings.
func (h *StubsHandlers) CliToolsClaudeSettings(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		writeJSON(w, http.StatusOK, cliToolSettingsResponse("Claude"))
	case http.MethodPost, http.MethodDelete:
		writeJSON(w, http.StatusOK, cliToolSaveResponse("Claude"))
	default:
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed", "Method not allowed")
	}
}

// CliToolsClineSettings handles GET/POST/DELETE /api/cli-tools/cline-settings.
func (h *StubsHandlers) CliToolsClineSettings(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		writeJSON(w, http.StatusOK, cliToolSettingsResponse("Cline"))
	case http.MethodPost, http.MethodDelete:
		writeJSON(w, http.StatusOK, cliToolSaveResponse("Cline"))
	default:
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed", "Method not allowed")
	}
}

// CliToolsCodexSettings handles GET/POST/DELETE /api/cli-tools/codex-settings.
func (h *StubsHandlers) CliToolsCodexSettings(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		writeJSON(w, http.StatusOK, cliToolSettingsResponse("Codex"))
	case http.MethodPost, http.MethodDelete:
		writeJSON(w, http.StatusOK, cliToolSaveResponse("Codex"))
	default:
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed", "Method not allowed")
	}
}

// CliToolsCopilotSettings handles GET/POST/DELETE /api/cli-tools/copilot-settings.
func (h *StubsHandlers) CliToolsCopilotSettings(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		writeJSON(w, http.StatusOK, cliToolSettingsResponse("Copilot"))
	case http.MethodPost, http.MethodDelete:
		writeJSON(w, http.StatusOK, cliToolSaveResponse("Copilot"))
	default:
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed", "Method not allowed")
	}
}

// CliToolsCoworkSettings handles GET/POST/DELETE /api/cli-tools/cowork-settings.
func (h *StubsHandlers) CliToolsCoworkSettings(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		writeJSON(w, http.StatusOK, cliToolSettingsResponse("Cowork"))
	case http.MethodPost, http.MethodDelete:
		writeJSON(w, http.StatusOK, cliToolSaveResponse("Cowork"))
	default:
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed", "Method not allowed")
	}
}

// CliToolsCoworkMcpRegistry handles GET /api/cli-tools/cowork-mcp-registry.
func (h *StubsHandlers) CliToolsCoworkMcpRegistry(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"servers": []any{},
		"total":   0,
		"cached":  false,
	})
}

// CliToolsCoworkMcpTools handles POST /api/cli-tools/cowork-mcp-tools.
func (h *StubsHandlers) CliToolsCoworkMcpTools(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"tools":         []any{},
		"requiresAuth":  false,
	})
}

// CliToolsAllStatuses handles GET /api/cli-tools/all-statuses. Returns a
// dict keyed by tool id.
func (h *StubsHandlers) CliToolsAllStatuses(w http.ResponseWriter, r *http.Request) {
	empty := map[string]any{}
	statuses := map[string]any{
		"claude":      empty,
		"codex":       empty,
		"opencode":    empty,
		"droid":       empty,
		"openclaw":    empty,
		"hermes":      empty,
		"cowork":      empty,
		"copilot":     empty,
		"cline":       empty,
		"kilo":        empty,
		"deepseek-tui": empty,
		"jcode":       empty,
	}
	writeJSON(w, http.StatusOK, statuses)
}

// CliToolsDeepseekTuiSettings handles GET/POST/DELETE /api/cli-tools/deepseek-tui-settings.
func (h *StubsHandlers) CliToolsDeepseekTuiSettings(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		writeJSON(w, http.StatusOK, cliToolSettingsResponse("Deepseek TUI"))
	case http.MethodPost, http.MethodDelete:
		writeJSON(w, http.StatusOK, cliToolSaveResponse("Deepseek TUI"))
	default:
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed", "Method not allowed")
	}
}

// CliToolsDroidSettings handles GET/POST/DELETE /api/cli-tools/droid-settings.
func (h *StubsHandlers) CliToolsDroidSettings(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		writeJSON(w, http.StatusOK, cliToolSettingsResponse("Droid"))
	case http.MethodPost, http.MethodDelete:
		writeJSON(w, http.StatusOK, cliToolSaveResponse("Droid"))
	default:
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed", "Method not allowed")
	}
}

// CliToolsHermesSettings handles GET/POST/DELETE /api/cli-tools/hermes-settings.
func (h *StubsHandlers) CliToolsHermesSettings(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		writeJSON(w, http.StatusOK, cliToolSettingsResponse("Hermes"))
	case http.MethodPost, http.MethodDelete:
		writeJSON(w, http.StatusOK, cliToolSaveResponse("Hermes"))
	default:
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed", "Method not allowed")
	}
}

// CliToolsJcodeSettings handles GET/POST/DELETE /api/cli-tools/jcode-settings.
func (h *StubsHandlers) CliToolsJcodeSettings(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		writeJSON(w, http.StatusOK, cliToolSettingsResponse("Jcode"))
	case http.MethodPost, http.MethodDelete:
		writeJSON(w, http.StatusOK, cliToolSaveResponse("Jcode"))
	default:
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed", "Method not allowed")
	}
}

// CliToolsKiloSettings handles GET/POST/DELETE /api/cli-tools/kilo-settings.
func (h *StubsHandlers) CliToolsKiloSettings(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		writeJSON(w, http.StatusOK, cliToolSettingsResponse("Kilo"))
	case http.MethodPost, http.MethodDelete:
		writeJSON(w, http.StatusOK, cliToolSaveResponse("Kilo"))
	default:
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed", "Method not allowed")
	}
}

// CliToolsOpenclawSettings handles GET/POST/DELETE /api/cli-tools/openclaw-settings.
func (h *StubsHandlers) CliToolsOpenclawSettings(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		writeJSON(w, http.StatusOK, cliToolSettingsResponse("OpenClaw"))
	case http.MethodPost, http.MethodDelete:
		writeJSON(w, http.StatusOK, cliToolSaveResponse("OpenClaw"))
	default:
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed", "Method not allowed")
	}
}

// CliToolsOpencodeSettings handles GET/POST/DELETE /api/cli-tools/opencode-settings.
func (h *StubsHandlers) CliToolsOpencodeSettings(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		writeJSON(w, http.StatusOK, cliToolSettingsResponse("OpenCode"))
	case http.MethodPost, http.MethodDelete:
		writeJSON(w, http.StatusOK, cliToolSaveResponse("OpenCode"))
	default:
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed", "Method not allowed")
	}
}

// V1 media stubs

// V1AudioTranscriptions handles POST /api/v1/audio/transcriptions.
// OpenAI Whisper-compatible shape.
func (h *StubsHandlers) V1AudioTranscriptions(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"text": ""})
}

// V1Embeddings handles POST /api/v1/embeddings. OpenAI-compatible shape.
func (h *StubsHandlers) V1Embeddings(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Input any    `json:"input"`
		Model string `json:"model"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)
	writeJSON(w, http.StatusOK, map[string]any{
		"object": "list",
		"data":   []any{},
		"model":  body.Model,
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

// Tags handles GET /api/tags. Returns Ollama-compatible model list.
// When Builder is available, serves real model list from the models registry.
func (h *StubsHandlers) Tags(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "GET, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "*")
	if h.Builder != nil {
		list, err := h.Builder.BuildModelsList(r.Context(), models.AllKinds)
		if err == nil && list != nil {
			writeJSON(w, http.StatusOK, map[string]any{"models": list})
			return
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"models": []any{}})
}

// MCPMessage handles POST /api/mcp/{plugin}/message. JS handler returns 403
// because cowork/MCP stdio bridge is disabled (RCE risk).
func (h *StubsHandlers) MCPMessage(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusForbidden, map[string]any{
		"error": "Cowork is disabled",
	})
}

// MCPSSE handles GET /api/mcp/{plugin}/sse. JS handler returns 403 text.
func (h *StubsHandlers) MCPSSE(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.WriteHeader(http.StatusForbidden)
	_, _ = w.Write([]byte("Cowork is disabled"))
}

// TTSVoices handles GET /api/media-providers/tts/voices.
func (h *StubsHandlers) TTSVoices(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"voices":    []any{},
		"languages": []any{},
		"byLang":    map[string]any{},
	})
}

// TTSProviderVoices handles GET /api/media-providers/tts/{provider}/voices.
// Provider-specific endpoints (deepgram, elevenlabs, inworld, etc.) share
// the same `{ voices | languages, byLang }` shape.
func (h *StubsHandlers) TTSProviderVoices(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"voices":    []any{},
		"languages": []any{},
		"byLang":    map[string]any{},
	})
}

// OIDCStart handles GET /api/auth/oidc/start. JS handler redirects to
// /login?error=oidc_not_configured when no OIDC config exists.
func (h *StubsHandlers) OIDCStart(w http.ResponseWriter, r *http.Request) {
	http.Redirect(w, r, "/login?error=oidc_not_configured", http.StatusFound)
}

// OIDCCallback handles GET /api/auth/oidc/callback. Same redirect-on-error
// behavior as JS.
func (h *StubsHandlers) OIDCCallback(w http.ResponseWriter, r *http.Request) {
	http.Redirect(w, r, "/login?error=oidc_not_implemented", http.StatusFound)
}

// SettingsRequireLogin handles GET /api/settings/require-login.
// When Repos is available, serves real values from the settings table;
// otherwise falls back to safe defaults.
func (h *StubsHandlers) SettingsRequireLogin(w http.ResponseWriter, r *http.Request) {
	if h.Repos != nil && h.Repos.Settings != nil {
		settings, err := h.Repos.Settings.Get()
		if err == nil && settings != nil {
			writeJSON(w, http.StatusOK, map[string]any{
				"requireLogin":          settings["requireLogin"],
				"tunnelDashboardAccess": settings["tunnelDashboardAccess"],
				"tunnelUrl":             settings["tunnelUrl"],
				"tailscaleUrl":          settings["tailscaleUrl"],
			})
			return
		}
	}
	// Fallback: safe defaults
	writeJSON(w, http.StatusOK, map[string]any{
		"requireLogin":          true,
		"tunnelDashboardAccess": true,
		"tunnelUrl":             "",
		"tailscaleUrl":          "",
	})
}

// VersionShutdown handles POST /api/version/shutdown. Mirrors the JS shape
// so the FE can render the same fields.
func (h *StubsHandlers) VersionShutdown(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"success":     true,
		"runtime":     "go",
		"mode":        "manual",
		"autoRestart": false,
		"message":     "Shutdown is not implemented in the go port yet.",
	})
}

// VersionUpdate handles POST /api/version/update.
func (h *StubsHandlers) VersionUpdate(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"success": false,
		"message": "Updater is not implemented in the go port yet.",
	})
}

// UsageRequestLogs handles GET /api/usage/request-logs. JS handler returns
// the raw logs object returned by getRecentLogs.
// When Repos is available, serves recent usage entries from the DB.
func (h *StubsHandlers) UsageRequestLogs(w http.ResponseWriter, r *http.Request) {
	if h.Repos != nil && h.Repos.Usage != nil {
		logs, err := h.Repos.Usage.ListHistory(50)
		if err == nil && logs != nil {
			writeJSON(w, http.StatusOK, map[string]any{"logs": logs})
			return
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"logs": []any{}})
}

// ProviderNodeGet handles GET /api/provider-nodes/{id}. JS handler returns
// 404 + { error } when not found (stub always 404 since no DB here).
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
// When Repos is available, serves real account data from the DB.
func (h *StubsHandlers) ProviderConnectionGet(w http.ResponseWriter, r *http.Request) {
	if h.Repos != nil && h.Repos.Accounts != nil {
		// Extract {id} from URL path
		path := r.URL.Path
		parts := strings.Split(path, "/")
		if len(parts) >= 2 {
			id := parts[len(parts)-1]
			account, err := h.Repos.Accounts.GetByID(id)
			if err == nil && account != nil {
				writeJSON(w, http.StatusOK, map[string]any{"connection": account})
				return
			}
		}
	}
	writeJSON(w, http.StatusNotFound, map[string]any{"error": "Connection not found"})
}

// ProviderConnectionUpdate handles PUT /api/providers/{id}.
// When Repos is available, updates the provider connection from the JSON body.
func (h *StubsHandlers) ProviderConnectionUpdate(w http.ResponseWriter, r *http.Request) {
	if h.Repos == nil {
		writeJSON(w, http.StatusOK, map[string]any{"connection": map[string]any{}})
		return
	}

	id := chi.URLParam(r, "id")
	if id == "" {
		writeError(w, http.StatusBadRequest, "invalid_request", "ID required")
		return
	}

	var body map[string]any
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_body", "Invalid JSON body")
		return
	}

	updated, err := h.Repos.Accounts.Update(id, func(a *repos.Account) {
		if v, ok := body["provider"].(string); ok {
			a.Provider = v
		}
		if v, ok := body["authType"].(string); ok {
			a.AuthType = v
		}
		if v, ok := body["name"].(string); ok {
			a.Name = v
		}
		if v, ok := body["email"].(string); ok {
			a.Email = v
		}
		if v, ok := body["priority"].(float64); ok {
			a.Priority = int(v)
		}
		if v, ok := body["isActive"].(bool); ok {
			a.IsActive = v
		}
		if v, ok := body["displayName"].(string); ok {
			a.DisplayName = v
		}
		if v, ok := body["defaultModel"].(string); ok {
			a.DefaultModel = v
		}
		if v, ok := body["globalPriority"].(float64); ok {
			a.GlobalPriority = int(v)
		}
		if v, ok := body["apiKey"].(string); ok {
			a.APIKey = v
		}
		if v, ok := body["accessToken"].(string); ok {
			a.AccessToken = v
		}
		if v, ok := body["refreshToken"].(string); ok {
			a.RefreshToken = v
		}
		if v, ok := body["expiresAt"].(string); ok {
			a.ExpiresAt = v
		}
		if v, ok := body["projectId"].(string); ok {
			a.ProjectID = v
		}
		if v, ok := body["providerSpecificData"].(map[string]any); ok {
			a.ProviderSpecificData = v
		}
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal_error", "Failed to update connection")
		return
	}
	if updated == nil {
		writeError(w, http.StatusNotFound, "not_found", "Connection not found")
		return
	}

	m := connectionToMap(updated)
	delete(m, "apiKey")
	delete(m, "accessToken")
	delete(m, "refreshToken")
	delete(m, "idToken")
	writeJSON(w, http.StatusOK, map[string]any{"connection": m})
}

// ProviderConnectionDelete handles DELETE /api/providers/{id}.
// When Repos is available, deletes the provider connection from the database.
func (h *StubsHandlers) ProviderConnectionDelete(w http.ResponseWriter, r *http.Request) {
	if h.Repos == nil {
		writeJSON(w, http.StatusOK, map[string]any{"message": "Connection deleted successfully"})
		return
	}

	id := chi.URLParam(r, "id")
	if id == "" {
		writeError(w, http.StatusBadRequest, "invalid_request", "ID required")
		return
	}

	deleted, err := h.Repos.Accounts.Delete(id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal_error", "Failed to delete connection")
		return
	}
	if !deleted {
		writeError(w, http.StatusNotFound, "not_found", "Connection not found")
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{"message": "Connection deleted successfully"})
}

// ProviderConnectionGet handles GET /api/providers/{id}.
// When Repos is available, returns the provider connection from the database.
func (h *StubsHandlers) ProviderConnectionGet(w http.ResponseWriter, r *http.Request) {
	if h.Repos == nil {
		writeJSON(w, http.StatusNotFound, map[string]any{"error": "Connection not found"})
		return
	}

	id := chi.URLParam(r, "id")
	if id == "" {
		writeError(w, http.StatusBadRequest, "invalid_request", "ID required")
		return
	}

	account, err := h.Repos.Accounts.GetByID(id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal_error", "Failed to get connection")
		return
	}
	if account == nil {
		writeError(w, http.StatusNotFound, "not_found", "Connection not found")
		return
	}

	m := connectionToMap(account)
	delete(m, "apiKey")
	delete(m, "accessToken")
	delete(m, "refreshToken")
	delete(m, "idToken")
	writeJSON(w, http.StatusOK, map[string]any{"connection": m})
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
		"ok":         false,
		"status":     0,
		"statusText": nil,
		"error":      "proxy pool test is not implemented in the go port yet",
		"elapsedMs":  0,
		"testedAt":   "",
	})
}

// OAuthCodexImportToken handles POST /api/oauth/codex/import-token.
func (h *StubsHandlers) OAuthCodexImportToken(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"success":    true,
		"connection": oauthConnectionResponse(),
	})
}

// OAuthCursorAutoImport handles GET /api/oauth/cursor/auto-import.
func (h *StubsHandlers) OAuthCursorAutoImport(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"found": false,
		"error": "cursor auto-import is not implemented in the go port yet",
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
		"connection": oauthConnectionResponse(),
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
		"connection": oauthConnectionResponse(),
	})
}

// OAuthKiroApiKey handles POST /api/oauth/kiro/api-key.
func (h *StubsHandlers) OAuthKiroApiKey(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"success":    true,
		"connection": oauthConnectionResponse(),
	})
}

// OAuthKiroAutoImport handles GET /api/oauth/kiro/auto-import.
func (h *StubsHandlers) OAuthKiroAutoImport(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"found": false,
		"error": "kiro auto-import is not implemented in the go port yet",
	})
}

// OAuthKiroImportCliProxy handles POST /api/oauth/kiro/import-cli-proxy.
func (h *StubsHandlers) OAuthKiroImportCliProxy(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"success":    true,
		"connection": oauthConnectionResponse(),
	})
}

// OAuthKiroImport handles POST /api/oauth/kiro/import.
func (h *StubsHandlers) OAuthKiroImport(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"success":    true,
		"connection": oauthConnectionResponse(),
	})
}

// OAuthKiroSocialAuthorize handles GET /api/oauth/kiro/social-authorize.
func (h *StubsHandlers) OAuthKiroSocialAuthorize(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"authUrl":       "",
		"state":         "",
		"codeVerifier":  "",
		"codeChallenge": "",
		"provider":      "",
	})
}

// OAuthKiroSocialExchange handles POST /api/oauth/kiro/social-exchange.
func (h *StubsHandlers) OAuthKiroSocialExchange(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"success":    true,
		"connection": oauthConnectionResponse(),
	})
}

// OAuthProviderAction handles GET/POST /api/oauth/{provider}/{action}.
// Action determines the actual response shape; the stub returns a generic
// OAuth-shaped JSON envelope so the FE can read common keys.
func (h *StubsHandlers) OAuthProviderAction(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodGet {
		writeJSON(w, http.StatusOK, map[string]any{
			"url":          "",
			"state":        "",
			"codeVerifier": "",
			"status":       "unknown",
		})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"success":    true,
		"connection": oauthConnectionResponse(),
	})
}
