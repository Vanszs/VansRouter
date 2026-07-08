package api

import (
	"encoding/json"
	"log/slog"
	"net/http"

	"github.com/9router/9router/internal/api/dashboard"
	"github.com/9router/9router/internal/api/middleware"
	"github.com/9router/9router/internal/api/v1"
	"github.com/9router/9router/internal/auth"
	"github.com/9router/9router/internal/db/repos"
	"github.com/9router/9router/internal/models"
	"github.com/9router/9router/internal/providers"
	"github.com/go-chi/chi/v5"
)

// Routes builds the chi router with logging, recovery, CORS, real-IP,
// auth, and v1 handlers.
func Routes(logger *slog.Logger, r *repos.Repos, registry *providers.Registry) http.Handler {
	builder := models.NewBuilder(registry, models.NewSQLSource(r.DB))

	router := chi.NewRouter()

	router.Use(middleware.RealIP)
	router.Use(middleware.Recovery(logger))
	router.Use(middleware.RequestLogger(logger))
	router.Use(middleware.NewCORS("").Wrap)

	router.Get("/health", healthHandler)
	router.Get("/shutdown", shutdownHandler)
	router.Get("/version", versionHandler)

	// Public model list used by the dashboard (no API key required).
	router.Get("/models", v1.ModelsHandler(builder))

	// Public OpenAI-compatible surface.
	router.Mount("/v1", v1Router(r, builder))

	// Legacy dashboard path kept for compatibility during the port.
	router.With(auth.APIKeyMiddleware(r.Keys)).Get("/api/v1/models", v1.ModelsHandler(builder))

	// Dashboard API routes (auth, settings, providers, keys, usage, etc).
	router.Mount("/api", dashboardRouter(r, registry, builder))

	return router
}

func dashboardRouter(r *repos.Repos, registry *providers.Registry, builder *models.Builder) http.Handler {
	router := chi.NewRouter()

	authHandlers := dashboard.NewAuthHandlers(r.Settings)
	router.Post("/auth/login", authHandlers.Login)
	router.Post("/auth/logout", authHandlers.Logout)
	router.Get("/auth/status", authHandlers.Status)
	router.Get("/auth/check", authHandlers.Check)
	router.Post("/auth/reset-password", authHandlers.ResetPassword)

	settingsHandlers := dashboard.NewSettingsHandlers(r.Settings)
	router.With(dashboard.RequireSession).Get("/settings", settingsHandlers.GetSettings)
	router.With(dashboard.RequireSession).Patch("/settings", settingsHandlers.UpdateSettings)

	providersHandlers := dashboard.NewProvidersHandlers(r)
	providersHandlers.Registry = registry
	router.With(dashboard.RequireSession).Get("/providers", providersHandlers.ListConnections)

	keysHandlers := dashboard.NewKeysHandlers(r)
	router.With(dashboard.RequireSession).Get("/keys", keysHandlers.ListKeys)
	router.With(dashboard.RequireSession).Post("/keys", keysHandlers.CreateKey)
	router.With(dashboard.RequireSession).Get("/keys/{id}", keysHandlers.GetKey)
	router.With(dashboard.RequireSession).Patch("/keys/{id}", keysHandlers.UpdateKey)
	router.With(dashboard.RequireSession).Delete("/keys/{id}", keysHandlers.DeleteKey)

	combosHandlers := dashboard.NewCombosHandlers(r)
	router.With(dashboard.RequireSession).Get("/combos", combosHandlers.ListCombos)
	router.With(dashboard.RequireSession).Post("/combos", combosHandlers.CreateCombo)
	router.With(dashboard.RequireSession).Get("/combos/{id}", combosHandlers.GetCombo)
	router.With(dashboard.RequireSession).Patch("/combos/{id}", combosHandlers.UpdateCombo)
	router.With(dashboard.RequireSession).Delete("/combos/{id}", combosHandlers.DeleteCombo)

	usageHandlers := dashboard.NewUsageHandlers(r)
	router.With(dashboard.RequireSession).Get("/usage/history", usageHandlers.History)
	router.With(dashboard.RequireSession).Get("/usage/logs", usageHandlers.Logs)
	router.With(dashboard.RequireSession).Get("/usage/stats", usageHandlers.Stats)
	router.With(dashboard.RequireSession).Get("/usage/stream", usageHandlers.Stream)
	router.With(dashboard.RequireSession).Get("/usage/providers", usageHandlers.Providers)
	router.With(dashboard.RequireSession).Get("/usage/request-details", usageHandlers.RequestDetails)
	router.With(dashboard.RequireSession).Get("/usage/request-details/{id}", usageHandlers.RequestDetailByID)
	router.With(dashboard.RequireSession).Get("/usage/chart", usageHandlers.Chart)
	router.With(dashboard.RequireSession).Get("/usage/{connectionId}", usageHandlers.ConnectionUsage)
	router.With(dashboard.RequireSession).Post("/usage/{connectionId}/codex-reset-credits", usageHandlers.CodexResetCredits)

	stubs := dashboard.NewStubsHandlers(builder)

	proxyPoolHandlers := dashboard.NewProxyPoolHandlers(r.ProxyPools)
	providerNodeHandlers := dashboard.NewProviderNodeHandlers(r.ProviderNodes)
	providerHandlers := dashboard.NewProviderHandlers(registry)
	modelHandlers := dashboard.NewModelHandlers(registry)

	router.With(dashboard.RequireSession).Get("/proxy-pools", proxyPoolHandlers.List)
	router.With(dashboard.RequireSession).Post("/proxy-pools", proxyPoolHandlers.Create)
	router.With(dashboard.RequireSession).Get("/proxy-pools/{id}", proxyPoolHandlers.Get)
	router.With(dashboard.RequireSession).Put("/proxy-pools/{id}", proxyPoolHandlers.Update)
	router.With(dashboard.RequireSession).Delete("/proxy-pools/{id}", proxyPoolHandlers.Delete)
	router.With(dashboard.RequireSession).Post("/proxy-pools/{id}/test", proxyPoolHandlers.Test)

	router.With(dashboard.RequireSession).Post("/providers/{id}/test", providerHandlers.Test)

	router.With(dashboard.RequireSession).Get("/provider-nodes", providerNodeHandlers.List)
	router.With(dashboard.RequireSession).Post("/provider-nodes", providerNodeHandlers.Create)
	router.With(dashboard.RequireSession).Get("/provider-nodes/{id}", providerNodeHandlers.Get)
	router.With(dashboard.RequireSession).Put("/provider-nodes/{id}", providerNodeHandlers.Update)
	router.With(dashboard.RequireSession).Delete("/provider-nodes/{id}", providerNodeHandlers.Delete)
	router.With(dashboard.RequireSession).Post("/provider-nodes/validate", providerNodeHandlers.Validate)

	router.With(dashboard.RequireSession).Get("/models/alias", modelHandlers.AliasList)
	router.With(dashboard.RequireSession).Put("/models/alias", modelHandlers.AliasUpdate)
	router.With(dashboard.RequireSession).Delete("/models/alias", modelHandlers.AliasDelete)
	router.With(dashboard.RequireSession).Get("/models/availability", modelHandlers.Availability)
	router.With(dashboard.RequireSession).Get("/models/custom", modelHandlers.Custom)
	router.With(dashboard.RequireSession).Get("/models/disabled", modelHandlers.Disabled)
	router.With(dashboard.RequireSession).Get("/models/test", modelHandlers.Test)
	router.With(dashboard.RequireSession).Post("/models/test", modelHandlers.Test)

	tunnelHandlers := dashboard.NewTunnelHandlers()
	router.With(dashboard.RequireSession).Get("/tunnel/status", tunnelHandlers.Status)
	router.With(dashboard.RequireSession).Post("/tunnel/enable", stubs.TunnelEnable)
	router.With(dashboard.RequireSession).Post("/tunnel/disable", stubs.TunnelDisable)
	router.With(dashboard.RequireSession).Get("/tunnel/tailscale-check", stubs.TunnelTailscaleCheck)
	router.With(dashboard.RequireSession).Post("/tunnel/tailscale-install", stubs.TunnelTailscaleInstall)
	router.With(dashboard.RequireSession).Post("/tunnel/tailscale-enable", stubs.TunnelTailscaleEnable)
	router.With(dashboard.RequireSession).Post("/tunnel/tailscale-disable", stubs.TunnelTailscaleDisable)

	headroomHandlers := dashboard.NewHeadroomHandlers()
	router.With(dashboard.RequireSession).Get("/headroom/status", headroomHandlers.Status)
	router.With(dashboard.RequireSession).Post("/headroom/start", stubs.HeadroomStart)
	router.With(dashboard.RequireSession).Post("/headroom/stop", stubs.HeadroomStop)

	versionHandlers := dashboard.NewVersionHandlers()
	router.Get("/version", versionHandlers.GetVersion)

	// Stubs for routes not fully ported yet. These return empty but shape-valid
	// JSON so the frontend never sees a 404 while the Go port is in progress.
	router.With(dashboard.RequireSession).Post("/auth/oidc/test", stubs.OIDCTest)

	router.With(dashboard.RequireSession).Get("/models", stubs.ModelsList)
	router.With(dashboard.RequireSession).Get("/models/alias", stubs.ModelAliases)
	router.With(dashboard.RequireSession).Put("/models/alias", stubs.ModelAliases)
	router.With(dashboard.RequireSession).Delete("/models/alias", stubs.ModelAliases)
	router.With(dashboard.RequireSession).Get("/models/availability", stubs.ModelAvailability)
	router.With(dashboard.RequireSession).Get("/models/custom", stubs.ModelCustom)
	router.With(dashboard.RequireSession).Get("/models/disabled", stubs.ModelDisabled)
	router.With(dashboard.RequireSession).Get("/models/test", stubs.ModelTest)
	router.With(dashboard.RequireSession).Post("/models/test", stubs.ModelTest)

	router.With(dashboard.RequireSession).Get("/providers/client", stubs.ProvidersClient)
	router.With(dashboard.RequireSession).Get("/providers/kilo/free-models", stubs.ProvidersKiloFreeModels)
	router.With(dashboard.RequireSession).Post("/providers/test-batch", stubs.ProvidersTestBatch)
	router.With(dashboard.RequireSession).Post("/providers/validate", stubs.ProvidersValidate)

	router.With(dashboard.RequireSession).Get("/proxy-pools", stubs.ProxyPoolsList)
	router.With(dashboard.RequireSession).Post("/proxy-pools", stubs.ProxyPoolsCreate)
	router.With(dashboard.RequireSession).Post("/proxy-pools/vercel-deploy", stubs.ProxyPoolsVercelDeploy)
	router.With(dashboard.RequireSession).Post("/proxy-pools/cloudflare-deploy", stubs.ProxyPoolsCloudflareDeploy)
	router.With(dashboard.RequireSession).Post("/proxy-pools/deno-deploy", stubs.ProxyPoolsDenoDeploy)

	router.With(dashboard.RequireSession).Post("/settings/proxy-test", stubs.SettingsProxyTest)
	router.With(dashboard.RequireSession).Get("/settings/database", stubs.SettingsDatabase)
	router.With(dashboard.RequireSession).Post("/settings/database", stubs.SettingsDatabase)

	router.With(dashboard.RequireSession).Get("/pricing", stubs.Pricing)
	router.With(dashboard.RequireSession).Patch("/pricing", stubs.Pricing)
	router.With(dashboard.RequireSession).Delete("/pricing", stubs.Pricing)

	router.With(dashboard.RequireSession).Get("/translator/load", stubs.TranslatorLoad)
	router.With(dashboard.RequireSession).Post("/translator/save", stubs.TranslatorSave)
	router.With(dashboard.RequireSession).Post("/translator/send", stubs.TranslatorSend)
	router.With(dashboard.RequireSession).Post("/translator/translate", stubs.TranslatorTranslate)
	router.With(dashboard.RequireSession).Get("/translator/console-logs", stubs.TranslatorConsoleLogs)
	router.With(dashboard.RequireSession).Delete("/translator/console-logs", stubs.TranslatorConsoleLogs)
	router.With(dashboard.RequireSession).Get("/translator/console-logs/stream", stubs.TranslatorConsoleLogsStream)

	router.With(dashboard.RequireSession).Get("/oauth/codex/bulk-import", stubs.OAuthCodexBulkImport)

	// Dashboard mirrors of /v1 media endpoints. The frontend uses relative
	// paths under /api/v1/*; Caddy proxies them here, so we keep the same
	// surface available with session auth.
	router.With(dashboard.RequireSession).Post("/v1/audio/transcriptions", stubs.V1AudioTranscriptions)
	router.With(dashboard.RequireSession).Post("/v1/embeddings", stubs.V1Embeddings)

	// CLI tool settings stubs.
	router.With(dashboard.RequireSession).Get("/cli-tools/all-statuses", stubs.CliToolsAllStatuses)
	router.With(dashboard.RequireSession).Get("/cli-tools/antigravity-mitm", stubs.CliToolsAntigravityMitm)
	router.With(dashboard.RequireSession).Post("/cli-tools/antigravity-mitm", stubs.CliToolsAntigravityMitm)
	router.With(dashboard.RequireSession).Get("/cli-tools/antigravity-mitm/alias", stubs.CliToolsAntigravityMitmAlias)
	router.With(dashboard.RequireSession).Get("/cli-tools/claude-settings", stubs.CliToolsClaudeSettings)
	router.With(dashboard.RequireSession).Post("/cli-tools/claude-settings", stubs.CliToolsClaudeSettings)
	router.With(dashboard.RequireSession).Delete("/cli-tools/claude-settings", stubs.CliToolsClaudeSettings)
	router.With(dashboard.RequireSession).Get("/cli-tools/cline-settings", stubs.CliToolsClineSettings)
	router.With(dashboard.RequireSession).Post("/cli-tools/cline-settings", stubs.CliToolsClineSettings)
	router.With(dashboard.RequireSession).Delete("/cli-tools/cline-settings", stubs.CliToolsClineSettings)
	router.With(dashboard.RequireSession).Get("/cli-tools/codex-settings", stubs.CliToolsCodexSettings)
	router.With(dashboard.RequireSession).Post("/cli-tools/codex-settings", stubs.CliToolsCodexSettings)
	router.With(dashboard.RequireSession).Delete("/cli-tools/codex-settings", stubs.CliToolsCodexSettings)
	router.With(dashboard.RequireSession).Get("/cli-tools/copilot-settings", stubs.CliToolsCopilotSettings)
	router.With(dashboard.RequireSession).Post("/cli-tools/copilot-settings", stubs.CliToolsCopilotSettings)
	router.With(dashboard.RequireSession).Delete("/cli-tools/copilot-settings", stubs.CliToolsCopilotSettings)
	router.With(dashboard.RequireSession).Get("/cli-tools/cowork-settings", stubs.CliToolsCoworkSettings)
	router.With(dashboard.RequireSession).Post("/cli-tools/cowork-settings", stubs.CliToolsCoworkSettings)
	router.With(dashboard.RequireSession).Delete("/cli-tools/cowork-settings", stubs.CliToolsCoworkSettings)
	router.With(dashboard.RequireSession).Get("/cli-tools/cowork-mcp-registry", stubs.CliToolsCoworkMcpRegistry)
	router.With(dashboard.RequireSession).Post("/cli-tools/cowork-mcp-tools", stubs.CliToolsCoworkMcpTools)
	router.With(dashboard.RequireSession).Get("/cli-tools/deepseek-tui-settings", stubs.CliToolsDeepseekTuiSettings)
	router.With(dashboard.RequireSession).Post("/cli-tools/deepseek-tui-settings", stubs.CliToolsDeepseekTuiSettings)
	router.With(dashboard.RequireSession).Delete("/cli-tools/deepseek-tui-settings", stubs.CliToolsDeepseekTuiSettings)
	router.With(dashboard.RequireSession).Get("/cli-tools/droid-settings", stubs.CliToolsDroidSettings)
	router.With(dashboard.RequireSession).Post("/cli-tools/droid-settings", stubs.CliToolsDroidSettings)
	router.With(dashboard.RequireSession).Delete("/cli-tools/droid-settings", stubs.CliToolsDroidSettings)
	router.With(dashboard.RequireSession).Get("/cli-tools/hermes-settings", stubs.CliToolsHermesSettings)
	router.With(dashboard.RequireSession).Post("/cli-tools/hermes-settings", stubs.CliToolsHermesSettings)
	router.With(dashboard.RequireSession).Delete("/cli-tools/hermes-settings", stubs.CliToolsHermesSettings)
	router.With(dashboard.RequireSession).Get("/cli-tools/jcode-settings", stubs.CliToolsJcodeSettings)
	router.With(dashboard.RequireSession).Post("/cli-tools/jcode-settings", stubs.CliToolsJcodeSettings)
	router.With(dashboard.RequireSession).Delete("/cli-tools/jcode-settings", stubs.CliToolsJcodeSettings)
	router.With(dashboard.RequireSession).Get("/cli-tools/kilo-settings", stubs.CliToolsKiloSettings)
	router.With(dashboard.RequireSession).Post("/cli-tools/kilo-settings", stubs.CliToolsKiloSettings)
	router.With(dashboard.RequireSession).Delete("/cli-tools/kilo-settings", stubs.CliToolsKiloSettings)
	router.With(dashboard.RequireSession).Get("/cli-tools/openclaw-settings", stubs.CliToolsOpenclawSettings)
	router.With(dashboard.RequireSession).Post("/cli-tools/openclaw-settings", stubs.CliToolsOpenclawSettings)
	router.With(dashboard.RequireSession).Delete("/cli-tools/openclaw-settings", stubs.CliToolsOpenclawSettings)
	router.With(dashboard.RequireSession).Get("/cli-tools/opencode-settings", stubs.CliToolsOpencodeSettings)
	router.With(dashboard.RequireSession).Post("/cli-tools/opencode-settings", stubs.CliToolsOpencodeSettings)
	router.With(dashboard.RequireSession).Delete("/cli-tools/opencode-settings", stubs.CliToolsOpencodeSettings)

	// App-level stubs.
	router.Get("/init", stubs.Init)
	router.Post("/locale", stubs.Locale)
	router.Get("/tags", stubs.Tags)

	// MCP stubs (per-plugin).
	router.Post("/mcp/{plugin}/message", stubs.MCPMessage)
	router.Get("/mcp/{plugin}/sse", stubs.MCPSSE)

	// Media provider stubs.
	router.Get("/media-providers/tts/voices", stubs.TTSVoices)
	router.Get("/media-providers/tts/deepgram/voices", stubs.TTSProviderVoices)
	router.Get("/media-providers/tts/elevenlabs/voices", stubs.TTSProviderVoices)
	router.Get("/media-providers/tts/inworld/voices", stubs.TTSProviderVoices)
	router.Get("/media-providers/tts/minimax/voices", stubs.TTSProviderVoices)

	// OIDC stubs (start/callback).
	router.Get("/auth/oidc/start", stubs.OIDCStart)
	router.Get("/auth/oidc/callback", stubs.OIDCCallback)

	// Settings additional stubs.
	router.Get("/settings/require-login", stubs.SettingsRequireLogin)

	// Version action stubs.
	router.Post("/version/shutdown", stubs.VersionShutdown)
	router.Post("/version/update", stubs.VersionUpdate)

	// Usage additional stub.
	router.With(dashboard.RequireSession).Get("/usage/request-logs", stubs.UsageRequestLogs)

	// Provider node stubs.
	router.With(dashboard.RequireSession).Put("/provider-nodes/{id}", stubs.ProviderNodeUpdate)
	router.With(dashboard.RequireSession).Delete("/provider-nodes/{id}", stubs.ProviderNodeDelete)

	// Provider connection stubs.
	router.With(dashboard.RequireSession).Get("/providers/{id}", stubs.ProviderConnectionGet)
	router.With(dashboard.RequireSession).Put("/providers/{id}", stubs.ProviderConnectionUpdate)
	router.With(dashboard.RequireSession).Delete("/providers/{id}", stubs.ProviderConnectionDelete)
	router.With(dashboard.RequireSession).Get("/providers/{id}/models", stubs.ProviderModels)
	router.With(dashboard.RequireSession).Post("/providers/{id}/test-models", stubs.ProviderTestModels)
	router.With(dashboard.RequireSession).Get("/providers/suggested-models", stubs.ProviderSuggestedModels)

	// Proxy pool stubs.
	router.With(dashboard.RequireSession).Get("/proxy-pools/{id}", stubs.ProxyPoolGet)
	router.With(dashboard.RequireSession).Put("/proxy-pools/{id}", stubs.ProxyPoolUpdate)
	router.With(dashboard.RequireSession).Delete("/proxy-pools/{id}", stubs.ProxyPoolDelete)
	router.With(dashboard.RequireSession).Post("/proxy-pools/{id}/test", stubs.ProxyPoolTest)

	// OAuth stubs.
	router.With(dashboard.RequireSession).Post("/oauth/codex/import-token", stubs.OAuthCodexImportToken)
	router.With(dashboard.RequireSession).Get("/oauth/cursor/auto-import", stubs.OAuthCursorAutoImport)
	router.With(dashboard.RequireSession).Get("/oauth/cursor/import", stubs.OAuthCursorImport)
	router.With(dashboard.RequireSession).Post("/oauth/cursor/import", stubs.OAuthCursorImport)
	router.With(dashboard.RequireSession).Post("/oauth/gitlab/pat", stubs.OAuthGitlabPAT)
	router.With(dashboard.RequireSession).Post("/oauth/iflow/cookie", stubs.OAuthIflowCookie)
	router.With(dashboard.RequireSession).Post("/oauth/kiro/api-key", stubs.OAuthKiroApiKey)
	router.With(dashboard.RequireSession).Get("/oauth/kiro/auto-import", stubs.OAuthKiroAutoImport)
	router.With(dashboard.RequireSession).Post("/oauth/kiro/import-cli-proxy", stubs.OAuthKiroImportCliProxy)
	router.With(dashboard.RequireSession).Post("/oauth/kiro/import", stubs.OAuthKiroImport)
	router.With(dashboard.RequireSession).Get("/oauth/kiro/social-authorize", stubs.OAuthKiroSocialAuthorize)
	router.With(dashboard.RequireSession).Post("/oauth/kiro/social-exchange", stubs.OAuthKiroSocialExchange)
	router.With(dashboard.RequireSession).Get("/oauth/{provider}/{action}", stubs.OAuthProviderAction)
	router.With(dashboard.RequireSession).Post("/oauth/{provider}/{action}", stubs.OAuthProviderAction)

	return router
}

func v1Router(r *repos.Repos, builder *models.Builder) http.Handler {
	router := chi.NewRouter()
	router.Use(auth.APIKeyMiddleware(r.Keys))
	router.Get("/models", v1.ModelsHandler(builder))
	chatHandler := v1.NewChatHandler(nil, builder)
	router.Post("/chat/completions", http.HandlerFunc(chatHandler.ServeHTTP))

	searchHandler := &v1.SearchHandler{}
	router.Post("/search", http.HandlerFunc(searchHandler.ServeHTTP))

	fetchHandler := &v1.FetchHandler{}
	router.Post("/fetch", http.HandlerFunc(fetchHandler.ServeHTTP))

	responsesHandler := &v1.ResponsesHandler{}
	router.Post("/responses", http.HandlerFunc(responsesHandler.ServeHTTP))

	messagesHandler := &v1.MessagesHandler{}
	router.Post("/messages/count_tokens", http.HandlerFunc(messagesHandler.ServeHTTP))

	stubs := dashboard.NewStubsHandlers(builder)
	router.Post("/audio/transcriptions", stubs.V1AudioTranscriptions)
	router.Post("/embeddings", stubs.V1Embeddings)

	return router
}

func healthHandler(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func shutdownHandler(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"success": true,
		"message": "Shutting down...",
	})
}

func versionHandler(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"currentVersion": "0.0.0-go",
		"latestVersion":  nil,
		"githubVersion":  nil,
		"hasUpdate":      false,
		"githubStatus":   "current",
		"runtime":        "go",
		"canAutoRestart": false,
		"installCommand": nil,
	})
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}
