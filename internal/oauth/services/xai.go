package services

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
)

// XaiService handles xAI (Grok) OAuth flow with PKCE.
// Source: src/lib/oauth/services/xai.js
// Flow: discover endpoints → PKCE S256 with 96-byte verifier → exchange code → decode id_token email
type XaiService struct {
	HTTPClient  HTTPClient
	Config      XaiConfig
	mu          sync.Mutex
	cachedDisc  *XaiDiscovery
}

// HTTPClient is the interface for HTTP clients (matches oauth.HTTPClient).
type HTTPClient interface {
	Do(req *http.Request) (*http.Response, error)
}

// XaiConfig holds xAI OAuth configuration.
type XaiConfig struct {
	ClientID            string
	Issuer              string
	AuthEndpointPath    string
	TokenEndpointPath   string
	DiscoveryPath       string
	AuthorizeURL        string // static fallback
	TokenURL            string // static fallback
	DiscoveryURL        string
	Scope               string
	APIBaseURL          string
	RedirectURI         string
	LoopbackPort        int
	CallbackPath        string
	PKCEVerifierBytes   int
	RefreshLeadSeconds  int
	UserAgent           string
	CodeChallengeMethod string
}

// DefaultXaiConfig returns the default xAI OAuth configuration.
// ClientID is sourced from the provider registry at runtime in Node.js;
// here we leave it empty — the caller must set it from the registry.
func DefaultXaiConfig() XaiConfig {
	return XaiConfig{
		Issuer:              "https://auth.x.ai",
		AuthEndpointPath:    "/oauth2/authorize",
		TokenEndpointPath:   "/oauth2/token",
		DiscoveryPath:       "/.well-known/openid-configuration",
		AuthorizeURL:        "https://auth.x.ai/oauth2/authorize",
		TokenURL:            "https://auth.x.ai/oauth2/token",
		DiscoveryURL:        "https://auth.x.ai/.well-known/openid-configuration",
		Scope:               "openid profile email offline_access grok-cli:access api:access",
		APIBaseURL:          "https://api.x.ai/v1",
		LoopbackPort:        56121,
		CallbackPath:        "/callback",
		PKCEVerifierBytes:   96,
		RefreshLeadSeconds:  300, // 5 minutes
		UserAgent:           "grok-cli/vansrouter",
		CodeChallengeMethod: "S256",
	}
}

// XaiDiscovery holds discovered OAuth endpoints.
type XaiDiscovery struct {
	AuthorizeURL string
	TokenURL     string
}

// NewXaiService creates a new xAI OAuth service.
func NewXaiService(client HTTPClient, clientID string) *XaiService {
	cfg := DefaultXaiConfig()
	cfg.ClientID = clientID
	return &XaiService{
		HTTPClient: client,
		Config:     cfg,
	}
}

// ValidateOAuthEndpoint validates that a discovered endpoint URL is on x.ai.
func ValidateOAuthEndpoint(rawURL, field string) (string, error) {
	value := strings.TrimSpace(rawURL)
	if value == "" {
		return "", fmt.Errorf("xai discovery %s is empty", field)
	}

	parsed, err := url.Parse(value)
	if err != nil {
		return "", fmt.Errorf("xai discovery %s is invalid: %w", field, err)
	}

	if parsed.Scheme != "https" {
		return "", fmt.Errorf("xai discovery %s must use https: %s", field, value)
	}

	host := strings.ToLower(strings.TrimSpace(parsed.Hostname()))
	if host != "x.ai" && !strings.HasSuffix(host, ".x.ai") {
		return "", fmt.Errorf("xai discovery %s host %s is not on x.ai", field, host)
	}

	return value, nil
}

// DiscoverEndpoints fetches authorization + token endpoints from the discovery URL.
// Results are cached process-wide.
func (s *XaiService) DiscoverEndpoints(ctx context.Context) (*XaiDiscovery, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.cachedDisc != nil {
		return s.cachedDisc, nil
	}

	client := s.HTTPClient
	if client == nil {
		client = http.DefaultClient
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, s.Config.DiscoveryURL, nil)
	if err != nil {
		return nil, fmt.Errorf("build discovery request: %w", err)
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", s.Config.UserAgent)

	resp, err := client.Do(req)
	if err != nil {
		// Fall through to static fallback
		s.cachedDisc = &XaiDiscovery{
			AuthorizeURL: s.Config.AuthorizeURL,
			TokenURL:     s.Config.TokenURL,
		}
		return s.cachedDisc, nil
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusOK {
		var data struct {
			AuthorizationEndpoint string `json:"authorization_endpoint"`
			TokenEndpoint         string `json:"token_endpoint"`
		}
		if err := json.NewDecoder(resp.Body).Decode(&data); err == nil {
			authURL, err := ValidateOAuthEndpoint(data.AuthorizationEndpoint, "authorization_endpoint")
			if err == nil {
				tokenURL, err := ValidateOAuthEndpoint(data.TokenEndpoint, "token_endpoint")
				if err == nil {
					s.cachedDisc = &XaiDiscovery{
						AuthorizeURL: authURL,
						TokenURL:     tokenURL,
					}
					return s.cachedDisc, nil
				}
			}
		}
	}

	// Static fallback
	s.cachedDisc = &XaiDiscovery{
		AuthorizeURL: s.Config.AuthorizeURL,
		TokenURL:     s.Config.TokenURL,
	}
	return s.cachedDisc, nil
}

// BuildAuthURL builds the xAI authorization URL.
func (s *XaiService) BuildAuthURL(redirectURI, state, codeChallenge, authorizeURL string) string {
	params := url.Values{
		"response_type":         {"code"},
		"client_id":             {s.Config.ClientID},
		"redirect_uri":          {redirectURI},
		"scope":                 {s.Config.Scope},
		"code_challenge":        {codeChallenge},
		"code_challenge_method": {s.Config.CodeChallengeMethod},
		"state":                 {state},
		"plan":                  {"generic"},
		"referrer":              {"cli-proxy-api"},
	}
	return authorizeURL + "?" + params.Encode()
}

// XaiTokenResponse holds the token response from xAI.
type XaiTokenResponse struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	IDToken      string `json:"id_token"`
	ExpiresIn    int    `json:"expires_in"`
	TokenType    string `json:"token_type"`
}

// ExchangeCode exchanges an authorization code for tokens.
// xAI is a public PKCE client — no client_secret.
func (s *XaiService) ExchangeCode(ctx context.Context, tokenURL, code, redirectURI, codeVerifier string) (*XaiTokenResponse, error) {
	data := url.Values{
		"grant_type":    {"authorization_code"},
		"client_id":     {s.Config.ClientID},
		"code":          {code},
		"redirect_uri":  {redirectURI},
		"code_verifier": {codeVerifier},
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, tokenURL, bytes.NewReader([]byte(data.Encode())))
	if err != nil {
		return nil, fmt.Errorf("build exchange request: %w", err)
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", s.Config.UserAgent)

	client := s.HTTPClient
	if client == nil {
		client = http.DefaultClient
	}

	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("exchange request: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("read exchange response: %w", err)
	}

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("xai token exchange failed: %s", string(body))
	}

	var tr XaiTokenResponse
	if err := json.Unmarshal(body, &tr); err != nil {
		return nil, fmt.Errorf("decode exchange response: %w", err)
	}

	return &tr, nil
}

// RefreshToken refreshes an access token using a refresh token.
func (s *XaiService) RefreshToken(ctx context.Context, refreshToken string) (*XaiTokenResponse, error) {
	disc, err := s.DiscoverEndpoints(ctx)
	if err != nil {
		return nil, fmt.Errorf("discover endpoints: %w", err)
	}

	data := url.Values{
		"grant_type":     {"refresh_token"},
		"client_id":      {s.Config.ClientID},
		"refresh_token":  {refreshToken},
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, disc.TokenURL, bytes.NewReader([]byte(data.Encode())))
	if err != nil {
		return nil, fmt.Errorf("build refresh request: %w", err)
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", s.Config.UserAgent)

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
		return nil, fmt.Errorf("xai token refresh failed: %s", string(body))
	}

	var tr XaiTokenResponse
	if err := json.Unmarshal(body, &tr); err != nil {
		return nil, fmt.Errorf("decode refresh response: %w", err)
	}

	return &tr, nil
}

// DecodeIDTokenEmail extracts the email claim from an id_token JWT.
// No signature verification — mirrors CLIProxyAPI Go behavior.
func DecodeIDTokenEmail(idToken string) string {
	if idToken == "" {
		return ""
	}

	parts := strings.Split(idToken, ".")
	if len(parts) != 3 {
		return ""
	}

	payload := parts[1]
	// Convert base64url to base64 and add padding
	payload = strings.ReplaceAll(payload, "-", "+")
	payload = strings.ReplaceAll(payload, "_", "/")
	for len(payload)%4 != 0 {
		payload += "="
	}

	decoded, err := base64.StdEncoding.DecodeString(payload)
	if err != nil {
		return ""
	}

	var claims map[string]any
	if err := json.Unmarshal(decoded, &claims); err != nil {
		return ""
	}

	if email, ok := claims["email"].(string); ok && email != "" {
		return email
	}
	if pref, ok := claims["preferred_username"].(string); ok && pref != "" {
		return pref
	}
	if sub, ok := claims["sub"].(string); ok {
		return sub
	}
	return ""
}
