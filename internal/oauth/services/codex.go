package services

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"time"

	"github.com/9router/9router/internal/oauth"
)

// CodexService handles OpenAI Codex OAuth flow.
type CodexService struct {
	Provider   oauth.Provider
	HTTPClient oauth.HTTPClient
	FixedPort  int
}

// CodexConfig holds Codex OAuth configuration.
type CodexConfig struct {
	ClientID            string
	AuthorizeURL        string
	TokenURL            string
	Scope               string
	CodeChallengeMethod string
	FixedPort           int
	CallbackPath        string
	ExtraParams         map[string]string
}

// DefaultCodexConfig returns the default Codex OAuth configuration.
func DefaultCodexConfig() CodexConfig {
	return CodexConfig{
		ClientID:            "app_EMoamEEZ73f0CkXaXp7hrann",
		AuthorizeURL:        "https://auth.openai.com/oauth/authorize",
		TokenURL:            "https://auth.openai.com/oauth/token",
		Scope:               "openid profile email offline_access",
		CodeChallengeMethod: "S256",
		FixedPort:           1455,
		CallbackPath:        "/auth/callback",
		ExtraParams: map[string]string{
			"id_token_add_organizations": "true",
			"codex_cli_simplified_flow":  "true",
			"originator":                 "codex_cli_rs",
		},
	}
}

// NewCodexService creates a new Codex OAuth service.
func NewCodexService(client oauth.HTTPClient) *CodexService {
	cfg := DefaultCodexConfig()
	return &CodexService{
		Provider: oauth.Provider{
			Name:                "codex",
			ClientID:            cfg.ClientID,
			AuthURL:             cfg.AuthorizeURL,
			TokenURL:            cfg.TokenURL,
			Scopes:              []string{cfg.Scope},
			CodeChallengeMethod: cfg.CodeChallengeMethod,
			ExtraAuthParams:     cfg.ExtraParams,
		},
		HTTPClient: client,
		FixedPort:  cfg.FixedPort,
	}
}

// BuildAuthURL builds the Codex authorization URL.
func (s *CodexService) BuildAuthURL(redirectURI, state, codeChallenge string) (string, error) {
	return s.Provider.BuildAuthURL(redirectURI, state, codeChallenge)
}

// ExchangeCode exchanges an authorization code for tokens.
func (s *CodexService) ExchangeCode(ctx context.Context, code, redirectURI, codeVerifier string) (*oauth.TokenResponse, error) {
	return oauth.Exchange(ctx, s.HTTPClient, s.Provider, code, redirectURI, codeVerifier)
}

// SaveTokensRequest represents the request to save tokens to the server.
type SaveTokensRequest struct {
	AccessToken  string `json:"accessToken"`
	RefreshToken string `json:"refreshToken"`
	ExpiresIn    int    `json:"expiresIn"`
	LastRefreshAt string `json:"lastRefreshAt"`
}

// SaveTokens saves tokens to the server.
func (s *CodexService) SaveTokens(ctx context.Context, serverURL, authToken, userID string, tokens *oauth.TokenResponse) error {
	reqBody := SaveTokensRequest{
		AccessToken:   tokens.AccessToken,
		RefreshToken:  tokens.RefreshToken,
		ExpiresIn:     tokens.ExpiresIn,
		LastRefreshAt: time.Now().UTC().Format(time.RFC3339),
	}

	bodyBytes, err := json.Marshal(reqBody)
	if err != nil {
		return fmt.Errorf("marshal request: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, fmt.Sprintf("%s/api/cli/providers/codex", serverURL), bytes.NewReader(bodyBytes))
	if err != nil {
		return fmt.Errorf("build request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", fmt.Sprintf("Bearer %s", authToken))
	req.Header.Set("X-User-Id", userID)

	client := s.HTTPClient
	if client == nil {
		client = http.DefaultClient
	}

	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("save tokens request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		body, _ := io.ReadAll(resp.Body)
		var errResp struct {
			Error string `json:"error"`
		}
		if json.Unmarshal(body, &errResp) == nil && errResp.Error != "" {
			return fmt.Errorf("save tokens: %s", errResp.Error)
		}
		return fmt.Errorf("save tokens: status %d", resp.StatusCode)
	}

	return nil
}

// RefreshToken refreshes an access token using a refresh token.
func (s *CodexService) RefreshToken(ctx context.Context, refreshToken string) (*oauth.TokenResponse, error) {
	data := url.Values{}
	data.Set("grant_type", "refresh_token")
	data.Set("client_id", s.Provider.ClientID)
	data.Set("refresh_token", refreshToken)
	data.Set("scope", "openid profile email offline_access")

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, s.Provider.TokenURL, bytes.NewReader([]byte(data.Encode())))
	if err != nil {
		return nil, fmt.Errorf("build refresh request: %w", err)
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "application/json")

	client := s.HTTPClient
	if client == nil {
		client = http.DefaultClient
	}

	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("refresh request: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("read refresh response: %w", err)
	}

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("refresh token failed %d: %s", resp.StatusCode, string(body))
	}

	var tr oauth.TokenResponse
	if err := json.Unmarshal(body, &tr); err != nil {
		return nil, fmt.Errorf("decode refresh response: %w", err)
	}

	return &tr, nil
}
