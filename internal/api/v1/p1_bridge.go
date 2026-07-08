package v1

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"github.com/9router/9router/internal/db/repos"
	"github.com/9router/9router/internal/providers/executors"
	"github.com/9router/9router/internal/refresh"
	"github.com/9router/9router/internal/tokensaver"
	"github.com/9router/9router/internal/usage"
)

// P1Bridge wires dead-code packages (tokensaver, usage, refresh) into the
// ChatService pipeline. All functions are no-ops if the underlying package
// is not initialized.
var (
	p1Logger *slog.Logger
)

// SetP1Logger sets the logger for P1 bridge functions.
func SetP1Logger(l *slog.Logger) { p1Logger = l }

func p1Log(level, msg string, keysAndValues ...any) {
	if p1Logger == nil {
		return
	}
	switch level {
	case "debug":
		p1Logger.Debug(msg, keysAndValues...)
	case "info":
		p1Logger.Info(msg, keysAndValues...)
	case "warn":
		p1Logger.Warn(msg, keysAndValues...)
	}
}

// injectTokenSavers applies all enabled token-saving features to the request body.
// Modifies body in place. Returns stats for usage tracking.
func injectTokenSavers(body map[string]any, providerID string, settings map[string]any) (cavemanEnabled, ponytailEnabled, rtkEnabled bool) {
	if settings == nil {
		settings = map[string]any{}
	}

	// Caveman: terse output style
	cavemanLevel, _ := settings["cavemanLevel"].(string)
	if cavemanLevel != "" && cavemanLevel != "off" {
		tokensaver.InjectCaveman(body, "openai", cavemanLevel)
		cavemanEnabled = true
		p1Log("debug", "caveman injected", "level", cavemanLevel, "provider", providerID)
	}

	// Ponytail: YAGNI code reduction
	ponytailLevel, _ := settings["ponytailLevel"].(string)
	if ponytailLevel != "" && ponytailLevel != "off" {
		tokensaver.InjectPonytail(body, "openai", ponytailLevel)
		ponytailEnabled = true
		p1Log("debug", "ponytail injected", "level", ponytailLevel, "provider", providerID)
	}

	// RTK: compress tool output
	rtkEnabled, _ = settings["rtkEnabled"].(bool)
	if rtkEnabled {
		tokensaver.CompressMessages(body, true)
		p1Log("debug", "rtk compression applied", "provider", providerID)
	}

	// Dedupe tools
	if tools, ok := body["tools"].([]map[string]any); ok && len(tools) > 0 {
		deduped, _ := tokensaver.DedupeTools(tools)
		if len(deduped) < len(tools) {
			body["tools"] = deduped
			p1Log("debug", "tools deduped", "before", len(tools), "after", len(deduped))
		}
	}

	// Loop guard: detect repeating tool calls
	if msgs, ok := body["messages"].([]map[string]any); ok && len(msgs) > 0 {
		result := tokensaver.DetectLoop(msgs)
		if result.Detected {
			p1Log("warn", "loop detected in conversation",
				"hint", result.Hint,
				"provider", providerID,
			)
		}
	}

	// Termination prompt injection
	tokensaver.InjectTerminationPrompt(body, "openai")

	return cavemanEnabled, ponytailEnabled, rtkEnabled
}

// recordUsage records a usage entry after a successful response.
func recordUsage(store usage.Store, providerID, modelStr, apiKey string, statusCode int, usageData *usage.Usage, requestDuration time.Duration) {
	if store == nil || usageData == nil {
		return
	}

	entry := usage.Entry{
		Provider:         providerID,
		Model:            modelStr,
		APIKey:           apiKey,
		Status:           fmt.Sprintf("%d", statusCode),
		PromptTokens:     usageData.PromptTokens,
		CompletionTokens: usageData.CompletionTokens,
		TotalTokens:      usageData.TotalTokens,
		Timestamp:        time.Now(),
	}

	svc := &usage.Service{Store: store}
	if err := svc.RecordUsage(context.Background(), entry); err != nil {
		p1Log("warn", "failed to record usage", "error", err, "provider", providerID)
	}

	p1Log("info", "usage recorded",
		"provider", providerID,
		"model", modelStr,
		"tokens", usageData.TotalTokens,
		"duration", requestDuration,
	)
}

// maybeRefreshCredentials checks if credentials need refresh and refreshes them.
// Returns updated credentials (possibly the same if no refresh needed).
func maybeRefreshCredentials(ctx context.Context, providerID string, creds *executors.Credentials, accountsRepo *repos.AccountsRepo) executors.Credentials {
	if creds == nil || creds.RefreshToken == "" {
		return *creds
	}

	// Build refresh.Credentials from executor.Credentials
	refreshCreds := &refresh.Credentials{
		AccessToken:  creds.AccessToken,
		RefreshToken: creds.RefreshToken,
	}

	if !refresh.ShouldRefresh(providerID, refreshCreds, time.Now()) {
		return *creds
	}

	p1Log("info", "refreshing credentials", "provider", providerID)

	refreshed, err := refresh.RefreshProviderCredentials(ctx, providerID, refreshCreds)
	if err != nil {
		p1Log("warn", "credential refresh failed", "provider", providerID, "error", err)
		return *creds
	}

	// Merge refreshed credentials back
	creds.AccessToken = refreshed.AccessToken
	if refreshed.RefreshToken != "" {
		creds.RefreshToken = refreshed.RefreshToken
	}
	if creds.ProviderSpecificData == nil {
		creds.ProviderSpecificData = map[string]any{}
	}
	creds.ProviderSpecificData["expiresAt"] = refreshed.ExpiresAt

	p1Log("info", "credentials refreshed", "provider", providerID)
	return *creds
}

// getTokensaverSettings reads tokensaver settings from the settings repo.
func getTokensaverSettings(settingsRepo *repos.SettingsRepo) map[string]any {
	if settingsRepo == nil {
		return map[string]any{}
	}
	allSettings, err := settingsRepo.Get()
	if err != nil || allSettings == nil {
		return map[string]any{}
	}
	settings, ok := allSettings["tokensaver"].(map[string]any)
	if !ok {
		return map[string]any{}
	}
	return settings
}
