package services

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/9router/9router/internal/oauth"
)

func TestDefaultCodexConfig(t *testing.T) {
	cfg := DefaultCodexConfig()
	if cfg.ClientID == "" {
		t.Error("client ID should not be empty")
	}
	if cfg.AuthorizeURL == "" {
		t.Error("authorize URL should not be empty")
	}
	if cfg.TokenURL == "" {
		t.Error("token URL should not be empty")
	}
	if cfg.CodeChallengeMethod != "S256" {
		t.Errorf("expected S256, got: %s", cfg.CodeChallengeMethod)
	}
	if cfg.FixedPort != 1455 {
		t.Errorf("expected 1455, got: %d", cfg.FixedPort)
	}
}

func TestNewCodexService(t *testing.T) {
	s := NewCodexService(http.DefaultClient)
	if s == nil {
		t.Fatal("service should not be nil")
	}
	if s.Provider.Name != "codex" {
		t.Errorf("expected 'codex', got: %s", s.Provider.Name)
	}
	if s.FixedPort != 1455 {
		t.Errorf("expected 1455, got: %d", s.FixedPort)
	}
}

func TestCodexBuildAuthURL(t *testing.T) {
	s := NewCodexService(http.DefaultClient)
	authURL, err := s.BuildAuthURL(
		"http://localhost:1455/auth/callback",
		"state123",
		"challenge456",
	)
	if err != nil {
		t.Fatalf("build auth URL failed: %v", err)
	}
	if authURL == "" {
		t.Fatal("auth URL should not be empty")
	}
}

func TestCodexExchangeCode_Success(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{
			"access_token": "at-123",
			"refresh_token": "rt-456",
			"expires_in": 3600,
			"token_type": "Bearer"
		}`))
	}))
	defer server.Close()

	s := NewCodexService(http.DefaultClient)
	// Override token URL to hit test server
	s.Provider.TokenURL = server.URL

	tr, err := s.ExchangeCode(context.Background(), "code123", "http://localhost:1455/auth/callback", "verifier789")
	if err != nil {
		t.Fatalf("exchange failed: %v", err)
	}
	if tr.AccessToken != "at-123" {
		t.Errorf("wrong access token: %s", tr.AccessToken)
	}
	if tr.RefreshToken != "rt-456" {
		t.Errorf("wrong refresh token: %s", tr.RefreshToken)
	}
}

func TestCodexRefreshToken_Success(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{
			"access_token": "new-at",
			"refresh_token": "new-rt",
			"expires_in": 3600,
			"token_type": "Bearer"
		}`))
	}))
	defer server.Close()

	s := NewCodexService(http.DefaultClient)
	s.Provider.TokenURL = server.URL

	tr, err := s.RefreshToken(context.Background(), "old-rt")
	if err != nil {
		t.Fatalf("refresh failed: %v", err)
	}
	if tr.AccessToken != "new-at" {
		t.Errorf("wrong access token: %s", tr.AccessToken)
	}
}

func TestCodexRefreshToken_Error(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusBadRequest)
		w.Write([]byte("invalid_grant"))
	}))
	defer server.Close()

	s := NewCodexService(http.DefaultClient)
	s.Provider.TokenURL = server.URL

	_, err := s.RefreshToken(context.Background(), "bad-rt")
	if err == nil {
		t.Fatal("should error on 400 response")
	}
}

func TestCodexSaveTokens_Success(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	s := NewCodexService(http.DefaultClient)
	tr := &oauth.TokenResponse{
		AccessToken:  "at",
		RefreshToken: "rt",
		ExpiresIn:    3600,
	}
	err := s.SaveTokens(context.Background(), server.URL, "auth-token", "user-1", tr)
	if err != nil {
		t.Fatalf("save tokens failed: %v", err)
	}
}

func TestCodexSaveTokens_Error(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
		w.Write([]byte(`{"error":"internal"}`))
	}))
	defer server.Close()

	s := NewCodexService(http.DefaultClient)
	tr := &oauth.TokenResponse{
		AccessToken:  "at",
		RefreshToken: "rt",
		ExpiresIn:    3600,
	}
	err := s.SaveTokens(context.Background(), server.URL, "auth-token", "user-1", tr)
	if err == nil {
		t.Fatal("should error on 500 response")
	}
}
