package refresh

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"math/rand"
	"strings"
	"sync"
	"time"
)

const defaultExpiryBuffer = 5 * time.Minute

// Credentials holds OAuth/API credentials for a provider connection.
type Credentials struct {
	AccessToken      string         `json:"accessToken"`
	APIKey           string         `json:"apiKey"`
	Token            string         `json:"token"`
	RefreshToken     string         `json:"refreshToken"`
	IDToken          string         `json:"idToken"`
	ExpiresAt        time.Time      `json:"expiresAt"`
	TokenExpiresAt   time.Time      `json:"tokenExpiresAt"`
	LastRefreshAt    time.Time      `json:"lastRefreshAt"`
	LastRefresh      time.Time      `json:"lastRefresh"`
	ExpiresIn        int            `json:"expiresIn"`
	ProjectID        string         `json:"projectId"`
	CopilotToken     string         `json:"copilotToken"`
	CopilotTokenExpiresAt time.Time `json:"copilotTokenExpiresAt"`
	ProviderSpecificData map[string]any `json:"providerSpecificData"`
}

// Refreshed holds the result of a token refresh.
type Refreshed struct {
	AccessToken      string         `json:"accessToken"`
	APIKey           string         `json:"apiKey"`
	Token            string         `json:"token"`
	RefreshToken     string         `json:"refreshToken"`
	IDToken          string         `json:"idToken"`
	ExpiresIn        int            `json:"expiresIn"`
	ExpiresAt        time.Time      `json:"expiresAt"`
	ProjectID        string         `json:"projectId"`
	LastRefreshAt    time.Time      `json:"lastRefreshAt"`
	CopilotToken     string         `json:"copilotToken"`
	CopilotTokenExpiresAt time.Time `json:"copilotTokenExpiresAt"`
	ProviderSpecificData map[string]any `json:"providerSpecificData"`
	Error            string         `json:"error"`
}

// ProviderConfig controls refresh behavior for a provider.
type ProviderConfig struct {
	RefreshLeadMs   time.Duration
	MaxRefreshAgeMs time.Duration
	TrackRefreshAt  bool
}

// RefreshFunc performs the provider-specific token exchange.
type RefreshFunc func(ctx context.Context, creds Credentials) (*Refreshed, error)

var (
	registry   = map[string]RefreshFunc{}
	providerCfgs = map[string]ProviderConfig{}
	refreshLocks = map[string]*sync.Mutex{}
	locksMu    sync.Mutex
)

// Register binds a provider ID to its refresh implementation.
func Register(provider string, fn RefreshFunc, cfg ProviderConfig) {
	registry[provider] = fn
	providerCfgs[provider] = cfg
}

// GetRefreshLead returns the lead time before expiry to trigger a refresh.
func GetRefreshLead(provider string) time.Duration {
	if cfg, ok := providerCfgs[provider]; ok && cfg.RefreshLeadMs > 0 {
		return cfg.RefreshLeadMs
	}
	return defaultExpiryBuffer
}

// IsUnrecoverableError reports whether a refresh result indicates a permanent failure.
func IsUnrecoverableError(r *Refreshed) bool {
	if r == nil {
		return false
	}
	switch r.Error {
	case "unrecoverable_refresh_error", "refresh_token_reused", "invalid_request", "invalid_grant":
		return true
	}
	return false
}

// ShouldRefresh reports whether credentials need a refresh.
func ShouldRefresh(provider string, creds *Credentials, now time.Time) bool {
	if creds == nil {
		return false
	}

	exp := expiryTime(creds)
	if !exp.IsZero() && exp.Sub(now) < GetRefreshLead(provider) {
		return true
	}

	cfg, ok := providerCfgs[provider]
	if ok && cfg.MaxRefreshAgeMs > 0 && creds.RefreshToken != "" {
		last := lastRefreshTime(creds)
		if last.IsZero() || now.Sub(last) >= cfg.MaxRefreshAgeMs {
			return true
		}
	}
	return false
}

func expiryTime(creds *Credentials) time.Time {
	if !creds.ExpiresAt.IsZero() {
		return creds.ExpiresAt
	}
	return creds.TokenExpiresAt
}

func lastRefreshTime(creds *Credentials) time.Time {
	if !creds.LastRefreshAt.IsZero() {
		return creds.LastRefreshAt
	}
	if !creds.LastRefresh.IsZero() {
		return creds.LastRefresh
	}
	if creds.ProviderSpecificData != nil {
		if v, ok := creds.ProviderSpecificData["lastRefreshAt"].(string); ok {
			t, _ := time.Parse(time.RFC3339, v)
			return t
		}
	}
	return time.Time{}
}

// MergeRefreshedCredentials combines current credentials with refreshed tokens.
func MergeRefreshedCredentials(provider string, current *Credentials, refreshed *Refreshed, now time.Time) (*Credentials, error) {
	if refreshed == nil {
		return nil, nil
	}
	if IsUnrecoverableError(refreshed) {
		return nil, fmt.Errorf("unrecoverable refresh error: %s", refreshed.Error)
	}

	next := &Credentials{}
	if current != nil {
		*next = *current
	}

	if refreshed.AccessToken != "" {
		next.AccessToken = refreshed.AccessToken
	}
	if refreshed.APIKey != "" {
		next.APIKey = refreshed.APIKey
	}
	if refreshed.Token != "" {
		next.Token = refreshed.Token
	}
	if refreshed.RefreshToken != "" {
		next.RefreshToken = refreshed.RefreshToken
	} else if current != nil {
		next.RefreshToken = current.RefreshToken
	}
	if refreshed.IDToken != "" {
		next.IDToken = refreshed.IDToken
	} else if current != nil {
		next.IDToken = current.IDToken
	}

	if refreshed.ExpiresIn > 0 {
		next.ExpiresIn = refreshed.ExpiresIn
		next.ExpiresAt = now.Add(time.Duration(refreshed.ExpiresIn) * time.Second)
	} else if !refreshed.ExpiresAt.IsZero() {
		next.ExpiresAt = refreshed.ExpiresAt
	}

	if refreshed.ProjectID != "" {
		next.ProjectID = refreshed.ProjectID
	}
	if refreshed.CopilotToken != "" {
		next.CopilotToken = refreshed.CopilotToken
	}
	if !refreshed.CopilotTokenExpiresAt.IsZero() {
		next.CopilotTokenExpiresAt = refreshed.CopilotTokenExpiresAt
	}

	next.ProviderSpecificData = mergeProviderSpecificData(next.ProviderSpecificData, refreshed.ProviderSpecificData)

	cfg := providerCfgs[provider]
	if cfg.TrackRefreshAt || next.AccessToken != "" || next.APIKey != "" || next.Token != "" ||
		next.RefreshToken != "" || next.CopilotToken != "" {
		next.LastRefreshAt = now
	}

	return next, nil
}

func mergeProviderSpecificData(existing, next map[string]any) map[string]any {
	if next == nil {
		return existing
	}
	out := map[string]any{}
	for k, v := range existing {
		out[k] = v
	}
	for k, v := range next {
		out[k] = v
	}
	return out
}

// RefreshProviderCredentials refreshes credentials for a provider with locking.
func RefreshProviderCredentials(ctx context.Context, provider string, creds *Credentials) (*Credentials, error) {
	if creds == nil {
		return nil, nil
	}
	fn, ok := registry[provider]
	if !ok {
		// No registered refresher; return current credentials unchanged.
		return creds, nil
	}

	key := refreshLockKey(provider, creds)
	mu := getLock(key)
	mu.Lock()
	defer mu.Unlock()

	refreshed, err := fn(ctx, *creds)
	if err != nil {
		return nil, err
	}
	return MergeRefreshedCredentials(provider, creds, refreshed, time.Now())
}

func getLock(key string) *sync.Mutex {
	locksMu.Lock()
	defer locksMu.Unlock()
	if mu, ok := refreshLocks[key]; ok {
		return mu
	}
	mu := &sync.Mutex{}
	refreshLocks[key] = mu
	return mu
}

func refreshLockKey(provider string, creds *Credentials) string {
	stable := ""
	if creds != nil {
		stable = strings.TrimSpace(creds.RefreshToken)
	}
	if stable == "" {
		return provider + ":default"
	}
	if len(stable) > 16 {
		stable = stable[len(stable)-16:]
	}
	h := sha256.Sum256([]byte(provider + ":" + stable))
	return provider + ":" + base64.RawURLEncoding.EncodeToString(h[:8])
}

// Init registers provider-specific refresh implementations.
// Each provider has its own refresh logic ported from the Node.js codebase.
func Init() {
	// OpenAI (generic API key, no refresh needed)
	Register("openai", func(ctx context.Context, creds Credentials) (*Refreshed, error) {
		return nil, nil
	}, ProviderConfig{RefreshLeadMs: defaultExpiryBuffer})

	// Claude (Anthropic OAuth)
	Register("claude", refreshClaude, ProviderConfig{RefreshLeadMs: defaultExpiryBuffer})

	// Gemini (Google OAuth)
	Register("gemini", refreshGoogle, ProviderConfig{RefreshLeadMs: defaultExpiryBuffer})

	// Codex (OpenAI OAuth with permanent error detection)
	Register("codex", refreshCodex, ProviderConfig{RefreshLeadMs: defaultExpiryBuffer, MaxRefreshAgeMs: 8 * 24 * time.Hour, TrackRefreshAt: true})

	// xAI (Grok OAuth)
	Register("xai", refreshXAI, ProviderConfig{RefreshLeadMs: defaultExpiryBuffer})

	// Qwen (Alibaba Cloud OAuth)
	Register("qwen", refreshQwen, ProviderConfig{RefreshLeadMs: defaultExpiryBuffer})

	// Kiro (AWS Cognito with multiple auth methods)
	Register("kiro", refreshKiro, ProviderConfig{RefreshLeadMs: defaultExpiryBuffer})

	// iFlow (OAuth with Basic auth)
	Register("iflow", refreshIflow, ProviderConfig{RefreshLeadMs: defaultExpiryBuffer})

	// GitHub (OAuth)
	Register("github", refreshGitHub, ProviderConfig{RefreshLeadMs: defaultExpiryBuffer})

	// GitHub Copilot (uses GitHub access token to get Copilot token)
	Register("copilot", refreshCopilot, ProviderConfig{RefreshLeadMs: defaultExpiryBuffer})

	// Tencent CodeBuddy (custom header-based refresh)
	Register("codebuddy-cn", refreshCodebuddy, ProviderConfig{RefreshLeadMs: defaultExpiryBuffer})
}

func init() {
	rand.Seed(time.Now().UnixNano())
}

// MarshalForLog returns a redacted JSON representation of credentials.
func MarshalForLog(creds *Credentials) string {
	if creds == nil {
		return "{}"
	}
	redacted := *creds
	redacted.AccessToken = mask(redacted.AccessToken)
	redacted.APIKey = mask(redacted.APIKey)
	redacted.Token = mask(redacted.Token)
	redacted.RefreshToken = mask(redacted.RefreshToken)
	redacted.IDToken = mask(redacted.IDToken)
	b, _ := json.Marshal(redacted)
	return string(b)
}

func mask(s string) string {
	if len(s) <= 8 {
		return "***"
	}
	return s[:4] + "..." + s[len(s)-4:]
}
