package refresh

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// OAuthEndpoint holds token/auth URLs for a provider.
type OAuthEndpoint struct {
	TokenURL string
	AuthURL  string
}

// ProviderOAuthConfig holds OAuth credentials for a provider.
type ProviderOAuthConfig struct {
	ClientID     string
	ClientSecret string
	TokenURL     string
	AuthURL      string
}

// providerOAuth holds per-provider OAuth configuration.
// These values mirror open-sse/config/providers.js PROVIDER_OAUTH.
var providerOAuth = map[string]ProviderOAuthConfig{
	"claude": {
		ClientID: "anthropic_console_pkce_client",
		TokenURL: "https://api.anthropic.com/oauth/token",
		AuthURL:  "https://console.anthropic.com/oauth/authorize",
	},
	"codex": {
		ClientID: "codex-cli",
		TokenURL: "https://auth.openai.com/token",
		AuthURL:  "https://auth.openai.com/authorize",
	},
	"xai": {
		ClientID: "xai-cli",
		TokenURL: "https://accounts.x.ai/token",
		AuthURL:  "https://accounts.x.ai/authorize",
	},
	"github": {
		ClientID: "Ov23liRpx8jRDDT8v8gz",
		TokenURL: "https://github.com/login/oauth/access_token",
		AuthURL:  "https://github.com/login/oauth/authorize",
	},
	"google": {
		TokenURL: "https://oauth2.googleapis.com/token",
		AuthURL:  "https://accounts.google.com/o/oauth2/auth",
	},
	"qwen": {
		ClientID: "", // populated from registry at runtime
		TokenURL: "", // populated from registry at runtime
	},
	"iflow": {
		ClientID: "", // populated from registry at runtime
		TokenURL: "", // populated from registry at runtime
	},
	"codebuddy-cn": {
		TokenURL: "https://copilot.tencent.com/v2/plugin/auth/token/refresh",
	},
}

// SetProviderOAuth allows runtime configuration of OAuth settings
// (e.g., loading client IDs and token URLs from the provider registry).
func SetProviderOAuth(id string, cfg ProviderOAuthConfig) {
	existing, ok := providerOAuth[id]
	if !ok {
		existing = ProviderOAuthConfig{}
	}
	if cfg.ClientID != "" {
		existing.ClientID = cfg.ClientID
	}
	if cfg.ClientSecret != "" {
		existing.ClientSecret = cfg.ClientSecret
	}
	if cfg.TokenURL != "" {
		existing.TokenURL = cfg.TokenURL
	}
	if cfg.AuthURL != "" {
		existing.AuthURL = cfg.AuthURL
	}
	providerOAuth[id] = existing
}

// getProviderOAuth returns the OAuth config for a provider.
func getProviderOAuth(id string) (ProviderOAuthConfig, bool) {
	cfg, ok := providerOAuth[id]
	return cfg, ok
}

// httpClient is the HTTP client used for refresh requests.
// It can be replaced in tests.
var httpClient = &http.Client{Timeout: 30 * time.Second}

// refreshLogger is the logger used by refresh functions.
var refreshLogger = slog.Default()

// SetHTTPClient sets the HTTP client for refresh requests (for testing).
func SetHTTPClient(c *http.Client) {
	if c != nil {
		httpClient = c
	}
}

// SetLogger sets the logger for refresh functions.
func SetLogger(l *slog.Logger) {
	if l != nil {
		refreshLogger = l
	}
}

// --- Helper types ---

// tokenResponse is the standard OAuth token response.
type tokenResponse struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	IDToken      string `json:"id_token"`
	ExpiresIn    int    `json:"expires_in"`
	ResourceURL  string `json:"resource_url"`
	Error        string `json:"error"`
	ErrorDesc    string `json:"error_description"`
}

// awsTokenResponse is the AWS Cognito / IDC token response (camelCase).
type awsTokenResponse struct {
	AccessToken  string `json:"accessToken"`
	RefreshToken string `json:"refreshToken"`
	ExpiresIn    int    `json:"expiresIn"`
	ProfileArn   string `json:"profileArn"`
}

// codebuddyResponse is the Tencent CodeBuddy token refresh response.
type codebuddyResponse struct {
	Code int `json:"code"`
	Data struct {
		AccessToken  string `json:"accessToken"`
		RefreshToken string `json:"refreshToken"`
		ExpiresIn    int    `json:"expiresIn"`
	} `json:"data"`
	Msg string `json:"msg"`
}

// copilotTokenResponse is the GitHub Copilot token response.
type copilotTokenResponse struct {
	Token     string `json:"token"`
	ExpiresAt int64  `json:"expires_at"`
}

// --- Error classification ---

// ClassifyOAuthRefreshError classifies an OAuth refresh error.
// Returns a structured error with a permanent flag.
func ClassifyOAuthRefreshError(errorText string, status int) OAuthRefreshError {
	var parsed map[string]any
	if errorText != "" {
		_ = json.Unmarshal([]byte(errorText), &parsed)
	}

	code := ""
	description := ""

	if parsed != nil {
		if errVal, ok := parsed["error"]; ok {
			switch v := errVal.(type) {
			case string:
				code = v
			case map[string]any:
				if c, ok := v["code"].(string); ok {
					code = c
				}
			}
		}
		if ec, ok := parsed["error_code"].(string); ok && code == "" {
			code = ec
		}
		if d, ok := parsed["error_description"].(string); ok {
			description = d
		}
		if d, ok := parsed["message"].(string); ok && description == "" {
			description = d
		}
	}
	if description == "" {
		description = errorText
	}

	combined := strings.ToLower(code + " " + description)
	permanentMarkers := []string{
		"refresh_token_expired",
		"refresh_token_reused",
		"refresh_token_invalidated",
		"invalid_grant",
	}
	permanent := false
	for _, marker := range permanentMarkers {
		if strings.Contains(combined, marker) {
			permanent = true
			break
		}
	}

	return OAuthRefreshError{
		Status:      status,
		Code:        code,
		Description: description,
		Permanent:   permanent,
	}
}

// OAuthRefreshError is a structured OAuth refresh error.
type OAuthRefreshError struct {
	Status      int
	Code        string
	Description string
	Permanent   bool
}

func (e OAuthRefreshError) Error() string {
	return fmt.Sprintf("oauth refresh error: status=%d code=%s desc=%s permanent=%v", e.Status, e.Code, e.Description, e.Permanent)
}

// --- Provider-specific refresh implementations ---

// refreshXAI performs xAI token refresh.
func refreshXAI(ctx context.Context, creds Credentials) (*Refreshed, error) {
	if creds.RefreshToken == "" {
		return nil, nil
	}

	cfg, ok := getProviderOAuth("xai")
	if !ok || cfg.TokenURL == "" {
		return nil, fmt.Errorf("xai: no token URL configured")
	}

	body := url.Values{
		"grant_type":    {"refresh_token"},
		"refresh_token": {creds.RefreshToken},
		"client_id":     {cfg.ClientID},
	}
	if cfg.ClientSecret != "" {
		body.Set("client_secret", cfg.ClientSecret)
	}

	resp, err := postForm(ctx, cfg.TokenURL, body)
	if err != nil {
		refreshLogger.Warn("xai refresh network error", "error", err)
		return nil, err
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(resp.Body)

	if resp.StatusCode != http.StatusOK {
		errInfo := ClassifyOAuthRefreshError(string(respBody), resp.StatusCode)
		refreshLogger.Warn("xai refresh failed", "status", resp.StatusCode, "error", string(respBody))
		if errInfo.Permanent {
			return &Refreshed{Error: "invalid_grant"}, nil
		}
		return nil, nil
	}

	var tokens tokenResponse
	if err := json.Unmarshal(respBody, &tokens); err != nil {
		return nil, fmt.Errorf("xai: parse response: %w", err)
	}

	refreshLogger.Info("xai refresh success", "hasAccessToken", tokens.AccessToken != "", "expiresIn", tokens.ExpiresIn)

	rt := tokens.RefreshToken
	if rt == "" {
		rt = creds.RefreshToken
	}

	return &Refreshed{
		AccessToken:  tokens.AccessToken,
		RefreshToken: rt,
		ExpiresIn:    tokens.ExpiresIn,
		IDToken:      tokens.IDToken,
	}, nil
}

// refreshClaude performs Claude (Anthropic) OAuth token refresh.
func refreshClaude(ctx context.Context, creds Credentials) (*Refreshed, error) {
	if creds.RefreshToken == "" {
		return nil, nil
	}

	cfg, ok := getProviderOAuth("claude")
	if !ok || cfg.TokenURL == "" {
		return nil, fmt.Errorf("claude: no token URL configured")
	}

	payload := map[string]string{
		"grant_type":    "refresh_token",
		"refresh_token": creds.RefreshToken,
		"client_id":     cfg.ClientID,
	}

	resp, err := postJSON(ctx, cfg.TokenURL, payload)
	if err != nil {
		refreshLogger.Error("claude refresh network error", "error", err)
		return nil, err
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(resp.Body)

	if resp.StatusCode != http.StatusOK {
		refreshLogger.Error("claude refresh failed", "status", resp.StatusCode, "error", string(respBody))
		return nil, nil
	}

	var tokens tokenResponse
	if err := json.Unmarshal(respBody, &tokens); err != nil {
		return nil, fmt.Errorf("claude: parse response: %w", err)
	}

	refreshLogger.Info("claude refresh success", "hasAccessToken", tokens.AccessToken != "", "expiresIn", tokens.ExpiresIn)

	rt := tokens.RefreshToken
	if rt == "" {
		rt = creds.RefreshToken
	}

	return &Refreshed{
		AccessToken:  tokens.AccessToken,
		RefreshToken: rt,
		ExpiresIn:    tokens.ExpiresIn,
	}, nil
}

// refreshGoogle performs Google OAuth token refresh.
// Client ID and secret are taken from provider-specific data or credentials.
func refreshGoogle(ctx context.Context, creds Credentials) (*Refreshed, error) {
	if creds.RefreshToken == "" {
		return nil, nil
	}

	// Try to get client_id/secret from provider-specific data
	clientID := ""
	clientSecret := ""
	if creds.ProviderSpecificData != nil {
		if v, ok := creds.ProviderSpecificData["clientId"].(string); ok {
			clientID = v
		}
		if v, ok := creds.ProviderSpecificData["clientSecret"].(string); ok {
			clientSecret = v
		}
	}

	// Fallback to configured values for gemini
	if clientID == "" {
		if cfg, ok := getProviderOAuth("google"); ok {
			if clientID == "" {
				clientID = cfg.ClientID
			}
		}
	}

	tokenURL := "https://oauth2.googleapis.com/token"
	if cfg, ok := getProviderOAuth("google"); ok && cfg.TokenURL != "" {
		tokenURL = cfg.TokenURL
	}

	body := url.Values{
		"grant_type":    {"refresh_token"},
		"refresh_token": {creds.RefreshToken},
		"client_id":     {clientID},
		"client_secret": {clientSecret},
	}

	resp, err := postForm(ctx, tokenURL, body)
	if err != nil {
		refreshLogger.Error("google refresh network error", "error", err)
		return nil, err
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(resp.Body)

	if resp.StatusCode != http.StatusOK {
		refreshLogger.Error("google refresh failed", "status", resp.StatusCode, "error", string(respBody))
		return nil, nil
	}

	var tokens tokenResponse
	if err := json.Unmarshal(respBody, &tokens); err != nil {
		return nil, fmt.Errorf("google: parse response: %w", err)
	}

	refreshLogger.Info("google refresh success", "hasAccessToken", tokens.AccessToken != "", "expiresIn", tokens.ExpiresIn)

	rt := tokens.RefreshToken
	if rt == "" {
		rt = creds.RefreshToken
	}

	return &Refreshed{
		AccessToken:  tokens.AccessToken,
		RefreshToken: rt,
		ExpiresIn:    tokens.ExpiresIn,
	}, nil
}

// refreshQwen performs Qwen OAuth token refresh.
func refreshQwen(ctx context.Context, creds Credentials) (*Refreshed, error) {
	if creds.RefreshToken == "" {
		return nil, nil
	}

	cfg, ok := getProviderOAuth("qwen")
	if !ok || cfg.TokenURL == "" {
		refreshLogger.Warn("qwen: no token URL configured")
		return nil, nil
	}

	body := url.Values{
		"grant_type":    {"refresh_token"},
		"refresh_token": {creds.RefreshToken},
		"client_id":     {cfg.ClientID},
	}

	resp, err := postForm(ctx, cfg.TokenURL, body)
	if err != nil {
		refreshLogger.Warn("qwen refresh network error", "error", err)
		return nil, err
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(resp.Body)

	if resp.StatusCode == http.StatusOK {
		var tokens tokenResponse
		if err := json.Unmarshal(respBody, &tokens); err != nil {
			return nil, fmt.Errorf("qwen: parse response: %w", err)
		}

		refreshLogger.Info("qwen refresh success",
			"hasAccessToken", tokens.AccessToken != "",
			"hasRefreshToken", tokens.RefreshToken != "",
			"expiresIn", tokens.ExpiresIn)

		rt := tokens.RefreshToken
		if rt == "" {
			rt = creds.RefreshToken
		}

		r := &Refreshed{
			AccessToken:  tokens.AccessToken,
			RefreshToken: rt,
			ExpiresIn:    tokens.ExpiresIn,
		}
		if tokens.ResourceURL != "" {
			r.ProviderSpecificData = map[string]any{"resourceUrl": tokens.ResourceURL}
		}
		return r, nil
	}

	refreshLogger.Warn("qwen endpoint error", "status", resp.StatusCode, "error", string(respBody))
	refreshLogger.Error("qwen refresh failed")
	return nil, nil
}

// refreshCodex performs OpenAI Codex token refresh.
func refreshCodex(ctx context.Context, creds Credentials) (*Refreshed, error) {
	if creds.RefreshToken == "" {
		return nil, nil
	}

	cfg, ok := getProviderOAuth("codex")
	if !ok || cfg.TokenURL == "" {
		return nil, fmt.Errorf("codex: no token URL configured")
	}

	payload := map[string]string{
		"client_id":     cfg.ClientID,
		"grant_type":    "refresh_token",
		"refresh_token": creds.RefreshToken,
	}

	resp, err := postJSON(ctx, cfg.TokenURL, payload)
	if err != nil {
		refreshLogger.Error("codex refresh network error", "error", err)
		return nil, err
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(resp.Body)

	if resp.StatusCode != http.StatusOK {
		failure := ClassifyOAuthRefreshError(string(respBody), resp.StatusCode)
		if failure.Permanent {
			refreshLogger.Error("codex refresh token already used or invalid, re-auth required",
				"status", resp.StatusCode, "code", failure.Code)
			return &Refreshed{Error: "unrecoverable_refresh_error"}, nil
		}

		refreshLogger.Error("codex refresh failed",
			"status", resp.StatusCode, "error", string(respBody), "code", failure.Code, "permanent", failure.Permanent)
		return nil, nil
	}

	var tokens tokenResponse
	if err := json.Unmarshal(respBody, &tokens); err != nil {
		return nil, fmt.Errorf("codex: parse response: %w", err)
	}

	refreshLogger.Info("codex refresh success",
		"hasAccessToken", tokens.AccessToken != "",
		"hasRefreshToken", tokens.RefreshToken != "",
		"hasIdToken", tokens.IDToken != "",
		"expiresIn", tokens.ExpiresIn)

	rt := tokens.RefreshToken
	if rt == "" {
		rt = creds.RefreshToken
	}

	return &Refreshed{
		AccessToken:  tokens.AccessToken,
		RefreshToken: rt,
		IDToken:      tokens.IDToken,
		ExpiresIn:    tokens.ExpiresIn,
	}, nil
}

// refreshKiro performs Kiro token refresh.
// Supports three paths: external_idp, AWS IDC, and social (default).
func refreshKiro(ctx context.Context, creds Credentials) (*Refreshed, error) {
	if creds.RefreshToken == "" {
		return nil, nil
	}

	psd := creds.ProviderSpecificData
	authMethod := ""
	clientID := ""
	clientSecret := ""
	region := ""

	if psd != nil {
		if v, ok := psd["authMethod"].(string); ok {
			authMethod = v
		}
		if v, ok := psd["clientId"].(string); ok {
			clientID = v
		}
		if v, ok := psd["clientSecret"].(string); ok {
			clientSecret = v
		}
		if v, ok := psd["region"].(string); ok {
			region = v
		}
	}

	// Path 1: External IDP
	if authMethod == "external_idp" {
		return refreshKiroExternalIDP(ctx, creds, psd)
	}

	// Path 2: AWS IDC or Cognito with client credentials
	if clientID != "" && clientSecret != "" {
		return refreshKiroAWS(ctx, creds, clientID, clientSecret, region, authMethod == "idc", psd)
	}

	// Path 3: Social login (default Kiro endpoint)
	return refreshKiroSocial(ctx, creds, psd)
}

func refreshKiroExternalIDP(ctx context.Context, creds Credentials, psd map[string]any) (*Refreshed, error) {
	// Build token endpoint and body from provider-specific data
	tokenEndpoint := ""
	if psd != nil {
		if v, ok := psd["tokenEndpoint"].(string); ok {
			tokenEndpoint = v
		}
	}
	if tokenEndpoint == "" {
		refreshLogger.Warn("kiro external_idp: no token endpoint configured")
		return nil, nil
	}

	// Build the refresh body from provider-specific data
	bodyStr := ""
	if psd != nil {
		if v, ok := psd["refreshBody"].(string); ok {
			bodyStr = v
		}
	}
	if bodyStr == "" {
		// Fallback: build standard form-encoded body
		body := url.Values{
			"grant_type":    {"refresh_token"},
			"refresh_token": {creds.RefreshToken},
		}
		bodyStr = body.Encode()
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, tokenEndpoint, strings.NewReader(bodyStr))
	if err != nil {
		return nil, fmt.Errorf("kiro external_idp: build request: %w", err)
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "application/json")

	resp, err := httpClient.Do(req)
	if err != nil {
		refreshLogger.Error("kiro external_idp refresh network error", "error", err)
		return nil, err
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(resp.Body)

	if resp.StatusCode != http.StatusOK {
		refreshLogger.Error("kiro external_idp refresh failed", "status", resp.StatusCode, "error", string(respBody))
		return nil, nil
	}

	var tokens tokenResponse
	if err := json.Unmarshal(respBody, &tokens); err != nil {
		return nil, fmt.Errorf("kiro external_idp: parse response: %w", err)
	}

	refreshLogger.Info("kiro external_idp refresh success",
		"hasAccessToken", tokens.AccessToken != "",
		"hasRefreshToken", tokens.RefreshToken != "",
		"expiresIn", tokens.ExpiresIn)

	rt := tokens.RefreshToken
	if rt == "" {
		rt = creds.RefreshToken
	}

	return &Refreshed{
		AccessToken:  tokens.AccessToken,
		RefreshToken: rt,
		ExpiresIn:    tokens.ExpiresIn,
	}, nil
}

func refreshKiroAWS(ctx context.Context, creds Credentials, clientID, clientSecret, region string, isIDC bool, psd map[string]any) (*Refreshed, error) {
	endpoint := "https://oidc.us-east-1.amazonaws.com/token"
	if isIDC && region != "" {
		endpoint = fmt.Sprintf("https://oidc.%s.amazonaws.com/token", region)
	}

	payload := map[string]string{
		"clientId":       clientID,
		"clientSecret":   clientSecret,
		"refreshToken":   creds.RefreshToken,
		"grantType":      "refresh_token",
	}

	resp, err := postJSON(ctx, endpoint, payload)
	if err != nil {
		refreshLogger.Error("kiro aws refresh network error", "error", err)
		return nil, err
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(resp.Body)

	if resp.StatusCode != http.StatusOK {
		refreshLogger.Error("kiro aws refresh failed", "status", resp.StatusCode, "error", string(respBody))
		return nil, nil
	}

	var tokens awsTokenResponse
	if err := json.Unmarshal(respBody, &tokens); err != nil {
		return nil, fmt.Errorf("kiro aws: parse response: %w", err)
	}

	refreshLogger.Info("kiro aws refresh success", "hasAccessToken", tokens.AccessToken != "", "expiresIn", tokens.ExpiresIn)

	rt := tokens.RefreshToken
	if rt == "" {
		rt = creds.RefreshToken
	}

	r := &Refreshed{
		AccessToken:  tokens.AccessToken,
		RefreshToken: rt,
		ExpiresIn:    tokens.ExpiresIn,
	}

	// Resolve profile ARN if not already present
	r.ProviderSpecificData = resolveKiroProfileArn(psd, tokens.AccessToken, tokens.ProfileArn)

	return r, nil
}

func refreshKiroSocial(ctx context.Context, creds Credentials, psd map[string]any) (*Refreshed, error) {
	// Get Kiro token URL from provider config or use default
	tokenURL := ""
	if cfg, ok := getProviderOAuth("kiro"); ok && cfg.TokenURL != "" {
		tokenURL = cfg.TokenURL
	}
	if tokenURL == "" {
		// Default Kiro token URL
		tokenURL = "https://kiro.amazonaws.com/token"
	}

	payload := map[string]string{
		"refreshToken": creds.RefreshToken,
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, tokenURL, strings.NewReader(mustMarshalJSON(payload)))
	if err != nil {
		return nil, fmt.Errorf("kiro social: build request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", "kiro-cli/1.0.0")

	resp, err := httpClient.Do(req)
	if err != nil {
		refreshLogger.Error("kiro social refresh network error", "error", err)
		return nil, err
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(resp.Body)

	if resp.StatusCode != http.StatusOK {
		refreshLogger.Error("kiro social refresh failed", "status", resp.StatusCode, "error", string(respBody))
		return nil, nil
	}

	var tokens awsTokenResponse
	if err := json.Unmarshal(respBody, &tokens); err != nil {
		return nil, fmt.Errorf("kiro social: parse response: %w", err)
	}

	refreshLogger.Info("kiro social refresh success", "hasAccessToken", tokens.AccessToken != "", "expiresIn", tokens.ExpiresIn)

	rt := tokens.RefreshToken
	if rt == "" {
		rt = creds.RefreshToken
	}

	r := &Refreshed{
		AccessToken:  tokens.AccessToken,
		RefreshToken: rt,
		ExpiresIn:    tokens.ExpiresIn,
	}

	r.ProviderSpecificData = resolveKiroProfileArn(psd, tokens.AccessToken, tokens.ProfileArn)

	return r, nil
}

func resolveKiroProfileArn(psd map[string]any, accessToken, refreshedArn string) map[string]any {
	// If profileArn already in psd, no patch needed
	if psd != nil {
		if _, ok := psd["profileArn"]; ok {
			return nil
		}
	}

	profileArn := strings.TrimSpace(refreshedArn)
	if profileArn == "" {
		return nil
	}

	return map[string]any{"profileArn": profileArn}
}

// refreshIflow performs iFlow OAuth token refresh with Basic auth.
func refreshIflow(ctx context.Context, creds Credentials) (*Refreshed, error) {
	if creds.RefreshToken == "" {
		return nil, nil
	}

	cfg, ok := getProviderOAuth("iflow")
	if !ok || cfg.TokenURL == "" {
		refreshLogger.Warn("iflow: no token URL configured")
		return nil, nil
	}

	basicAuth := base64.StdEncoding.EncodeToString([]byte(cfg.ClientID + ":" + cfg.ClientSecret))

	body := url.Values{
		"grant_type":    {"refresh_token"},
		"refresh_token": {creds.RefreshToken},
		"client_id":     {cfg.ClientID},
		"client_secret": {cfg.ClientSecret},
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, cfg.TokenURL, strings.NewReader(body.Encode()))
	if err != nil {
		return nil, fmt.Errorf("iflow: build request: %w", err)
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Authorization", "Basic "+basicAuth)

	resp, err := httpClient.Do(req)
	if err != nil {
		refreshLogger.Error("iflow refresh network error", "error", err)
		return nil, err
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(resp.Body)

	if resp.StatusCode != http.StatusOK {
		refreshLogger.Error("iflow refresh failed", "status", resp.StatusCode, "error", string(respBody))
		return nil, nil
	}

	var tokens tokenResponse
	if err := json.Unmarshal(respBody, &tokens); err != nil {
		return nil, fmt.Errorf("iflow: parse response: %w", err)
	}

	refreshLogger.Info("iflow refresh success",
		"hasAccessToken", tokens.AccessToken != "",
		"hasRefreshToken", tokens.RefreshToken != "",
		"expiresIn", tokens.ExpiresIn)

	rt := tokens.RefreshToken
	if rt == "" {
		rt = creds.RefreshToken
	}

	return &Refreshed{
		AccessToken:  tokens.AccessToken,
		RefreshToken: rt,
		ExpiresIn:    tokens.ExpiresIn,
	}, nil
}

// refreshGitHub performs GitHub OAuth token refresh.
func refreshGitHub(ctx context.Context, creds Credentials) (*Refreshed, error) {
	if creds.RefreshToken == "" {
		return nil, nil
	}

	cfg, ok := getProviderOAuth("github")
	if !ok || cfg.TokenURL == "" {
		return nil, fmt.Errorf("github: no token URL configured")
	}

	body := url.Values{
		"grant_type":    {"refresh_token"},
		"refresh_token": {creds.RefreshToken},
		"client_id":     {cfg.ClientID},
	}
	if cfg.ClientSecret != "" {
		body.Set("client_secret", cfg.ClientSecret)
	}

	resp, err := postForm(ctx, cfg.TokenURL, body)
	if err != nil {
		refreshLogger.Error("github refresh network error", "error", err)
		return nil, err
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(resp.Body)

	if resp.StatusCode != http.StatusOK {
		refreshLogger.Error("github refresh failed", "status", resp.StatusCode, "error", string(respBody))
		return nil, nil
	}

	var tokens tokenResponse
	if err := json.Unmarshal(respBody, &tokens); err != nil {
		return nil, fmt.Errorf("github: parse response: %w", err)
	}

	refreshLogger.Info("github refresh success",
		"hasAccessToken", tokens.AccessToken != "",
		"hasRefreshToken", tokens.RefreshToken != "",
		"expiresIn", tokens.ExpiresIn)

	rt := tokens.RefreshToken
	if rt == "" {
		rt = creds.RefreshToken
	}

	return &Refreshed{
		AccessToken:  tokens.AccessToken,
		RefreshToken: rt,
		ExpiresIn:    tokens.ExpiresIn,
	}, nil
}

// refreshCopilot refreshes GitHub Copilot token using a GitHub access token.
func refreshCopilot(ctx context.Context, creds Credentials) (*Refreshed, error) {
	accessToken := creds.AccessToken
	if accessToken == "" {
		return nil, nil
	}

	// Get copilot token URL from provider-specific data or use default
	copilotTokenURL := "https://api.github.com/copilot_internal/v2/token"
	if creds.ProviderSpecificData != nil {
		if v, ok := creds.ProviderSpecificData["copilotTokenUrl"].(string); ok && v != "" {
			copilotTokenURL = v
		}
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, copilotTokenURL, nil)
	if err != nil {
		return nil, fmt.Errorf("copilot: build request: %w", err)
	}
	req.Header.Set("Authorization", "token "+accessToken)
	req.Header.Set("User-Agent", "GitHubCopilotChat/0.26.2")
	req.Header.Set("Editor-Version", "vscode/1.97.2")
	req.Header.Set("Editor-Plugin-Version", "copilot-chat/0.26.2")
	req.Header.Set("Accept", "application/json")
	req.Header.Set("x-github-api-version", "2025-04-01")

	resp, err := httpClient.Do(req)
	if err != nil {
		refreshLogger.Error("copilot refresh network error", "error", err)
		return nil, err
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(resp.Body)

	if resp.StatusCode != http.StatusOK {
		refreshLogger.Error("copilot refresh failed", "status", resp.StatusCode, "error", string(respBody))
		return nil, nil
	}

	var data copilotTokenResponse
	if err := json.Unmarshal(respBody, &data); err != nil {
		return nil, fmt.Errorf("copilot: parse response: %w", err)
	}

	refreshLogger.Info("copilot refresh success", "hasToken", data.Token != "", "expiresAt", data.ExpiresAt)

	r := &Refreshed{
		Token: data.Token,
	}
	if data.ExpiresAt > 0 {
		r.CopilotTokenExpiresAt = time.Unix(data.ExpiresAt, 0)
	}
	r.CopilotToken = data.Token

	return r, nil
}

// refreshCodebuddy performs Tencent CodeBuddy token refresh.
func refreshCodebuddy(ctx context.Context, creds Credentials) (*Refreshed, error) {
	if creds.RefreshToken == "" {
		return nil, nil
	}

	cfg, ok := getProviderOAuth("codebuddy-cn")
	if !ok || cfg.TokenURL == "" {
		refreshLogger.Warn("codebuddy-cn: no refresh URL configured")
		return nil, nil
	}

	userAgent := "Mozilla/5.0"
	if cfg.ClientID != "" {
		userAgent = cfg.ClientID
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, cfg.TokenURL, strings.NewReader("{}"))
	if err != nil {
		return nil, fmt.Errorf("codebuddy: build request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", userAgent)
	req.Header.Set("X-Requested-With", "XMLHttpRequest")
	req.Header.Set("X-Domain", "copilot.tencent.com")
	req.Header.Set("X-Refresh-Token", creds.RefreshToken)
	req.Header.Set("X-Auth-Refresh-Source", "plugin")
	req.Header.Set("X-Product", "SaaS")

	resp, err := httpClient.Do(req)
	if err != nil {
		refreshLogger.Error("codebuddy refresh network error", "error", err)
		return nil, err
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(resp.Body)

	if resp.StatusCode != http.StatusOK {
		refreshLogger.Error("codebuddy refresh failed", "status", resp.StatusCode, "error", string(respBody))
		return nil, nil
	}

	var data codebuddyResponse
	if err := json.Unmarshal(respBody, &data); err != nil {
		return nil, fmt.Errorf("codebuddy: parse response: %w", err)
	}

	if data.Code != 0 || data.Data.AccessToken == "" {
		refreshLogger.Error("codebuddy refresh returned no token", "code", data.Code, "msg", data.Msg)
		return nil, nil
	}

	refreshLogger.Info("codebuddy refresh success",
		"hasAccessToken", data.Data.AccessToken != "",
		"hasRefreshToken", data.Data.RefreshToken != "",
		"expiresIn", data.Data.ExpiresIn)

	rt := data.Data.RefreshToken
	if rt == "" {
		rt = creds.RefreshToken
	}

	return &Refreshed{
		AccessToken:  data.Data.AccessToken,
		RefreshToken: rt,
		ExpiresIn:    data.Data.ExpiresIn,
	}, nil
}

// refreshGeneric performs a standard OAuth token refresh using provider config.
func refreshGeneric(ctx context.Context, provider string, creds Credentials) (*Refreshed, error) {
	if creds.RefreshToken == "" {
		return nil, nil
	}

	cfg, ok := getProviderOAuth(provider)
	if !ok || cfg.TokenURL == "" {
		refreshLogger.Warn("generic refresh: no refresh URL configured", "provider", provider)
		return nil, nil
	}

	body := url.Values{
		"grant_type":    {"refresh_token"},
		"refresh_token": {creds.RefreshToken},
		"client_id":     {cfg.ClientID},
		"client_secret": {cfg.ClientSecret},
	}

	resp, err := postForm(ctx, cfg.TokenURL, body)
	if err != nil {
		refreshLogger.Error("generic refresh network error", "provider", provider, "error", err)
		return nil, err
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(resp.Body)

	if resp.StatusCode != http.StatusOK {
		refreshLogger.Error("generic refresh failed", "provider", provider, "status", resp.StatusCode, "error", string(respBody))
		return nil, nil
	}

	var tokens tokenResponse
	if err := json.Unmarshal(respBody, &tokens); err != nil {
		return nil, fmt.Errorf("%s: parse response: %w", provider, err)
	}

	refreshLogger.Info("generic refresh success", "provider", provider,
		"hasAccessToken", tokens.AccessToken != "",
		"hasRefreshToken", tokens.RefreshToken != "",
		"expiresIn", tokens.ExpiresIn)

	rt := tokens.RefreshToken
	if rt == "" {
		rt = creds.RefreshToken
	}

	return &Refreshed{
		AccessToken:  tokens.AccessToken,
		RefreshToken: rt,
		ExpiresIn:    tokens.ExpiresIn,
	}, nil
}

// --- HTTP helpers ---

func postForm(ctx context.Context, url string, body url.Values) (*http.Response, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, strings.NewReader(body.Encode()))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "application/json")
	return httpClient.Do(req)
}

func postJSON(ctx context.Context, url string, payload any) (*http.Response, error) {
	data, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, strings.NewReader(string(data)))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	return httpClient.Do(req)
}

func mustMarshalJSON(v any) string {
	data, err := json.Marshal(v)
	if err != nil {
		return "{}"
	}
	return string(data)
}
