package services

import (
	"context"
	"encoding/base64"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestValidateOAuthEndpoint_Valid(t *testing.T) {
	result, err := ValidateOAuthEndpoint("https://x.ai/oauth2/authorize", "authorization_endpoint")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result != "https://x.ai/oauth2/authorize" {
		t.Errorf("unexpected result: %s", result)
	}
}

func TestValidateOAuthEndpoint_Subdomain(t *testing.T) {
	_, err := ValidateOAuthEndpoint("https://auth.x.ai/oauth2/authorize", "authorization_endpoint")
	if err != nil {
		t.Fatalf("subdomain of x.ai should be valid: %v", err)
	}
}

func TestValidateOAuthEndpoint_NotHTTPS(t *testing.T) {
	_, err := ValidateOAuthEndpoint("http://x.ai/oauth2/authorize", "authorization_endpoint")
	if err == nil {
		t.Fatal("should reject http")
	}
}

func TestValidateOAuthEndpoint_NotXAI(t *testing.T) {
	_, err := ValidateOAuthEndpoint("https://evil.com/oauth2/authorize", "authorization_endpoint")
	if err == nil {
		t.Fatal("should reject non-x.ai host")
	}
}

func TestValidateOAuthEndpoint_Empty(t *testing.T) {
	_, err := ValidateOAuthEndpoint("", "authorization_endpoint")
	if err == nil {
		t.Fatal("should reject empty URL")
	}
}

func TestXaiDiscoverEndpoints_Success(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{
			"authorization_endpoint": "https://auth.x.ai/oauth2/authorize",
			"token_endpoint": "https://auth.x.ai/oauth2/token"
		}`))
	}))
	defer server.Close()

	s := NewXaiService(http.DefaultClient, "test-client-id")
	s.Config.DiscoveryURL = server.URL

	disc, err := s.DiscoverEndpoints(context.Background())
	if err != nil {
		t.Fatalf("discovery failed: %v", err)
	}
	if disc.AuthorizeURL != "https://auth.x.ai/oauth2/authorize" {
		t.Errorf("wrong authorize URL: %s", disc.AuthorizeURL)
	}
	if disc.TokenURL != "https://auth.x.ai/oauth2/token" {
		t.Errorf("wrong token URL: %s", disc.TokenURL)
	}
}

func TestXaiDiscoverEndpoints_Cached(t *testing.T) {
	callCount := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		callCount++
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{
			"authorization_endpoint": "https://auth.x.ai/oauth2/authorize",
			"token_endpoint": "https://auth.x.ai/oauth2/token"
		}`))
	}))
	defer server.Close()

	s := NewXaiService(http.DefaultClient, "test-client-id")
	s.Config.DiscoveryURL = server.URL

	// First call hits the server
	_, _ = s.DiscoverEndpoints(context.Background())
	// Second call should use cache
	_, _ = s.DiscoverEndpoints(context.Background())

	if callCount != 1 {
		t.Errorf("expected 1 HTTP call, got %d (cache not working)", callCount)
	}
}

func TestXaiDiscoverEndpoints_Fallback(t *testing.T) {
	s := NewXaiService(http.DefaultClient, "test-client-id")
	// Use invalid URL to trigger fallback
	s.Config.DiscoveryURL = "http://localhost:1/invalid"

	disc, err := s.DiscoverEndpoints(context.Background())
	if err != nil {
		t.Fatalf("fallback discovery failed: %v", err)
	}
	if disc.AuthorizeURL != s.Config.AuthorizeURL {
		t.Errorf("should use fallback authorize URL: %s", disc.AuthorizeURL)
	}
	if disc.TokenURL != s.Config.TokenURL {
		t.Errorf("should use fallback token URL: %s", disc.TokenURL)
	}
}

func TestXaiBuildAuthURL(t *testing.T) {
	s := NewXaiService(http.DefaultClient, "test-client-id")
	authURL := s.BuildAuthURL(
		"http://127.0.0.1:56121/callback",
		"state123",
		"challenge456",
		"https://auth.x.ai/oauth2/authorize",
	)

	if authURL == "" {
		t.Fatal("auth URL should not be empty")
	}
	if !strings.Contains(authURL, "client_id=test-client-id") {
		t.Error("auth URL should contain client_id")
	}
	if !strings.Contains(authURL, "code_challenge=challenge456") {
		t.Error("auth URL should contain code_challenge")
	}
	if !strings.Contains(authURL, "state=state123") {
		t.Error("auth URL should contain state")
	}
	if !strings.Contains(authURL, "redirect_uri=") {
		t.Error("auth URL should contain redirect_uri")
	}
}

func TestXaiExchangeCode_Success(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{
			"access_token": "at-123",
			"refresh_token": "rt-456",
			"id_token": "eyJhbG...aSJ9.sig",
			"expires_in": 3600,
			"token_type": "Bearer"
		}`))
	}))
	defer server.Close()

	s := NewXaiService(http.DefaultClient, "test-client-id")
	tr, err := s.ExchangeCode(context.Background(), server.URL, "code123", "http://127.0.0.1:56121/callback", "verifier789")
	if err != nil {
		t.Fatalf("exchange failed: %v", err)
	}
	if tr.AccessToken != "at-123" {
		t.Errorf("wrong access token: %s", tr.AccessToken)
	}
	if tr.RefreshToken != "rt-456" {
		t.Errorf("wrong refresh token: %s", tr.RefreshToken)
	}
	if tr.ExpiresIn != 3600 {
		t.Errorf("wrong expires_in: %d", tr.ExpiresIn)
	}
}

func TestXaiExchangeCode_Error(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusBadRequest)
		w.Write([]byte("invalid_grant"))
	}))
	defer server.Close()

	s := NewXaiService(http.DefaultClient, "test-client-id")
	_, err := s.ExchangeCode(context.Background(), server.URL, "bad-code", "http://127.0.0.1:56121/callback", "verifier")
	if err == nil {
		t.Fatal("should error on 400 response")
	}
}

func TestXaiRefreshToken_Success(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{
			"access_token": "new-at-123",
			"refresh_token": "new-rt-456",
			"expires_in": 3600,
			"token_type": "Bearer"
		}`))
	}))
	defer server.Close()

	s := NewXaiService(http.DefaultClient, "test-client-id")
	// Pre-populate cache to skip discovery
	s.cachedDisc = &XaiDiscovery{
		AuthorizeURL: s.Config.AuthorizeURL,
		TokenURL:     server.URL,
	}

	tr, err := s.RefreshToken(context.Background(), "old-rt")
	if err != nil {
		t.Fatalf("refresh failed: %v", err)
	}
	if tr.AccessToken != "new-at-123" {
		t.Errorf("wrong access token: %s", tr.AccessToken)
	}
}

func TestDecodeIDTokenEmail_Valid(t *testing.T) {
	// Create a simple JWT: header.payload.signature
	// Payload: {"email":"test@x.ai"}
	header := base64.RawURLEncoding.EncodeToString([]byte(`{"alg":"HS256","typ":"JWT"}`))
	payload := base64.RawURLEncoding.EncodeToString([]byte(`{"email":"test@x.ai"}`))
	idToken := header + "." + payload + ".sig"

	email := DecodeIDTokenEmail(idToken)
	if email != "test@x.ai" {
		t.Errorf("expected test@x.ai, got: %s", email)
	}
}

func TestDecodeIDTokenEmail_PreferredUsername(t *testing.T) {
	payload := base64.RawURLEncoding.EncodeToString([]byte(`{"preferred_username":"user@x.ai"}`))
	header := base64.RawURLEncoding.EncodeToString([]byte(`{"alg":"HS256"}`))
	idToken := header + "." + payload + ".sig"

	email := DecodeIDTokenEmail(idToken)
	if email != "user@x.ai" {
		t.Errorf("expected user@x.ai, got: %s", email)
	}
}

func TestDecodeIDTokenEmail_Sub(t *testing.T) {
	payload := base64.RawURLEncoding.EncodeToString([]byte(`{"sub":"12345"}`))
	header := base64.RawURLEncoding.EncodeToString([]byte(`{"alg":"HS256"}`))
	idToken := header + "." + payload + ".sig"

	email := DecodeIDTokenEmail(idToken)
	if email != "12345" {
		t.Errorf("expected 12345, got: %s", email)
	}
}

func TestDecodeIDTokenEmail_Empty(t *testing.T) {
	email := DecodeIDTokenEmail("")
	if email != "" {
		t.Error("empty token should return empty string")
	}
}

func TestDecodeIDTokenEmail_InvalidJWT(t *testing.T) {
	email := DecodeIDTokenEmail("not.a.jwt.token.here")
	if email != "" {
		t.Error("invalid JWT should return empty string")
	}
}

func TestDecodeIDTokenEmail_TwoParts(t *testing.T) {
	email := DecodeIDTokenEmail("only.two")
	if email != "" {
		t.Error("two-part token should return empty string")
	}
}
