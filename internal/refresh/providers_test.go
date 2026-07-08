package refresh

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestRefreshXAI(t *testing.T) {
	tests := []struct {
		name           string
		refreshToken   string
		serverResponse tokenResponse
		statusCode     int
		wantErr        bool
		wantNil        bool
		wantToken      string
	}{
		{
			name:         "successful refresh",
			refreshToken: "old_token",
			serverResponse: tokenResponse{
				AccessToken:  "new_access_token",
				RefreshToken: "new_refresh_token",
				ExpiresIn:    3600,
				IDToken:      "id_token",
			},
			statusCode: http.StatusOK,
			wantErr:    false,
			wantNil:    false,
			wantToken:  "new_access_token",
		},
		{
			name:           "no refresh token",
			refreshToken:   "",
			serverResponse: tokenResponse{},
			statusCode:     0, // server won't be called
			wantErr:        false,
			wantNil:        true,
			wantToken:      "",
		},
		{
			name:         "invalid_grant error",
			refreshToken: "bad_token",
			serverResponse: tokenResponse{
				Error: "invalid_grant",
			},
			statusCode: http.StatusBadRequest,
			wantErr:    false,
			wantNil:    false,
			wantToken:  "", // Should return Refreshed with error
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Setup test server
			var server *httptest.Server
			if tt.refreshToken != "" {
				server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					w.WriteHeader(tt.statusCode)
					json.NewEncoder(w).Encode(tt.serverResponse)
				}))
				defer server.Close()

				// Override xai token URL
				SetProviderOAuth("xai", ProviderOAuthConfig{
					ClientID: "test_client",
					TokenURL: server.URL,
				})
			}

			creds := Credentials{RefreshToken: tt.refreshToken}
			result, err := refreshXAI(context.Background(), creds)

			if tt.wantErr {
				assert.Error(t, err)
				return
			}

			assert.NoError(t, err)

			if tt.wantNil {
				assert.Nil(t, result)
				return
			}

			assert.NotNil(t, result)
			if tt.wantToken != "" {
				assert.Equal(t, tt.wantToken, result.AccessToken)
			}
		})
	}
}

func TestRefreshClaude(t *testing.T) {
	tests := []struct {
		name           string
		refreshToken   string
		serverResponse tokenResponse
		statusCode     int
		wantErr        bool
		wantNil        bool
		wantToken      string
	}{
		{
			name:         "successful refresh",
			refreshToken: "old_token",
			serverResponse: tokenResponse{
				AccessToken:  "new_claude_token",
				RefreshToken: "new_refresh",
				ExpiresIn:    3600,
			},
			statusCode: http.StatusOK,
			wantErr:    false,
			wantNil:    false,
			wantToken:  "new_claude_token",
		},
		{
			name:           "no refresh token",
			refreshToken:   "",
			serverResponse: tokenResponse{},
			statusCode:     0,
			wantErr:        false,
			wantNil:        true,
			wantToken:      "",
		},
		{
			name:         "server error",
			refreshToken: "token",
			serverResponse: tokenResponse{
				Error:     "server_error",
				ErrorDesc: "Internal server error",
			},
			statusCode: http.StatusInternalServerError,
			wantErr:    false,
			wantNil:    true,
			wantToken:  "",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var server *httptest.Server
			if tt.refreshToken != "" {
				server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					w.WriteHeader(tt.statusCode)
					json.NewEncoder(w).Encode(tt.serverResponse)
				}))
				defer server.Close()

				SetProviderOAuth("claude", ProviderOAuthConfig{
					ClientID: "anthropic_console_pkce_client",
					TokenURL: server.URL,
				})
			}

			creds := Credentials{RefreshToken: tt.refreshToken}
			result, err := refreshClaude(context.Background(), creds)

			if tt.wantErr {
				assert.Error(t, err)
				return
			}

			assert.NoError(t, err)

			if tt.wantNil {
				assert.Nil(t, result)
				return
			}

			assert.NotNil(t, result)
			if tt.wantToken != "" {
				assert.Equal(t, tt.wantToken, result.AccessToken)
			}
		})
	}
}

func TestRefreshGoogle(t *testing.T) {
	tests := []struct {
		name           string
		refreshToken   string
		providerData   map[string]any
		serverResponse tokenResponse
		statusCode     int
		wantErr        bool
		wantNil        bool
		wantToken      string
	}{
		{
			name:         "successful refresh with provider data",
			refreshToken: "google_refresh",
			providerData: map[string]any{
				"clientId":     "test_client",
				"clientSecret": "test_secret",
			},
			serverResponse: tokenResponse{
				AccessToken: "new_google_token",
				ExpiresIn:   3600,
			},
			statusCode: http.StatusOK,
			wantErr:    false,
			wantNil:    false,
			wantToken:  "new_google_token",
		},
		{
			name:           "no refresh token",
			refreshToken:   "",
			providerData:   nil,
			serverResponse: tokenResponse{},
			statusCode:     0,
			wantErr:        false,
			wantNil:        true,
			wantToken:      "",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var server *httptest.Server
			if tt.refreshToken != "" {
				server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					w.WriteHeader(tt.statusCode)
					json.NewEncoder(w).Encode(tt.serverResponse)
				}))
				defer server.Close()

				SetProviderOAuth("google", ProviderOAuthConfig{
					TokenURL: server.URL,
				})
			}

			creds := Credentials{
				RefreshToken:         tt.refreshToken,
				ProviderSpecificData: tt.providerData,
			}
			result, err := refreshGoogle(context.Background(), creds)

			if tt.wantErr {
				assert.Error(t, err)
				return
			}

			assert.NoError(t, err)

			if tt.wantNil {
				assert.Nil(t, result)
				return
			}

			assert.NotNil(t, result)
			if tt.wantToken != "" {
				assert.Equal(t, tt.wantToken, result.AccessToken)
			}
		})
	}
}

func TestRefreshCodex(t *testing.T) {
	tests := []struct {
		name           string
		refreshToken   string
		serverResponse tokenResponse
		statusCode     int
		wantErr        bool
		wantNil        bool
		wantError      string
		wantToken      string
	}{
		{
			name:         "successful refresh",
			refreshToken: "codex_refresh",
			serverResponse: tokenResponse{
				AccessToken:  "new_codex_token",
				RefreshToken: "new_refresh",
				IDToken:      "id_token",
				ExpiresIn:    3600,
			},
			statusCode: http.StatusOK,
			wantErr:    false,
			wantNil:    false,
			wantToken:  "new_codex_token",
		},
		{
			name:         "permanent error - invalid_grant",
			refreshToken: "bad_token",
			serverResponse: tokenResponse{
				Error:     "invalid_grant",
				ErrorDesc: "Refresh token is invalid",
			},
			statusCode: http.StatusBadRequest,
			wantErr:    false,
			wantNil:    false,
			wantError:  "unrecoverable_refresh_error",
			wantToken:  "",
		},
		{
			name:         "permanent error - refresh_token_reused",
			refreshToken: "reused_token",
			serverResponse: tokenResponse{
				Error:     "invalid_grant",
				ErrorDesc: "Refresh token already used",
			},
			statusCode: http.StatusBadRequest,
			wantErr:    false,
			wantNil:    false,
			wantError:  "unrecoverable_refresh_error",
			wantToken:  "",
		},
		{
			name:           "no refresh token",
			refreshToken:   "",
			serverResponse: tokenResponse{},
			statusCode:     0,
			wantErr:        false,
			wantNil:        true,
			wantToken:      "",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var server *httptest.Server
			if tt.refreshToken != "" {
				server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					w.WriteHeader(tt.statusCode)
					json.NewEncoder(w).Encode(tt.serverResponse)
				}))
				defer server.Close()

				SetProviderOAuth("codex", ProviderOAuthConfig{
					ClientID: "codex-cli",
					TokenURL: server.URL,
				})
			}

			creds := Credentials{RefreshToken: tt.refreshToken}
			result, err := refreshCodex(context.Background(), creds)

			if tt.wantErr {
				assert.Error(t, err)
				return
			}

			assert.NoError(t, err)

			if tt.wantNil {
				assert.Nil(t, result)
				return
			}

			assert.NotNil(t, result)

			if tt.wantError != "" {
				assert.Equal(t, tt.wantError, result.Error)
				assert.True(t, IsUnrecoverableError(result))
			} else if tt.wantToken != "" {
				assert.Equal(t, tt.wantToken, result.AccessToken)
			}
		})
	}
}

func TestRefreshGitHub(t *testing.T) {
	tests := []struct {
		name           string
		refreshToken   string
		serverResponse tokenResponse
		statusCode     int
		wantErr        bool
		wantNil        bool
		wantToken      string
	}{
		{
			name:         "successful refresh",
			refreshToken: "github_refresh",
			serverResponse: tokenResponse{
				AccessToken:  "gho_new_token",
				RefreshToken: "ghr_new_refresh",
				ExpiresIn:    28800,
			},
			statusCode: http.StatusOK,
			wantErr:    false,
			wantNil:    false,
			wantToken:  "gho_new_token",
		},
		{
			name:           "no refresh token",
			refreshToken:   "",
			serverResponse: tokenResponse{},
			statusCode:     0,
			wantErr:        false,
			wantNil:        true,
			wantToken:      "",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var server *httptest.Server
			if tt.refreshToken != "" {
				server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					w.WriteHeader(tt.statusCode)
					json.NewEncoder(w).Encode(tt.serverResponse)
				}))
				defer server.Close()

				SetProviderOAuth("github", ProviderOAuthConfig{
					ClientID: "test_client",
					TokenURL: server.URL,
				})
			}

			creds := Credentials{RefreshToken: tt.refreshToken}
			result, err := refreshGitHub(context.Background(), creds)

			if tt.wantErr {
				assert.Error(t, err)
				return
			}

			assert.NoError(t, err)

			if tt.wantNil {
				assert.Nil(t, result)
				return
			}

			assert.NotNil(t, result)
			if tt.wantToken != "" {
				assert.Equal(t, tt.wantToken, result.AccessToken)
			}
		})
	}
}

func TestRefreshCopilot(t *testing.T) {
	tests := []struct {
		name           string
		accessToken    string
		serverResponse copilotTokenResponse
		statusCode     int
		wantErr        bool
		wantNil        bool
		wantToken      string
	}{
		{
			name:        "successful refresh",
			accessToken: "gho_access_token",
			serverResponse: copilotTokenResponse{
				Token:     "copilot_token_123",
				ExpiresAt: time.Now().Add(1 * time.Hour).Unix(),
			},
			statusCode: http.StatusOK,
			wantErr:    false,
			wantNil:    false,
			wantToken:  "copilot_token_123",
		},
		{
			name:           "no access token",
			accessToken:    "",
			serverResponse: copilotTokenResponse{},
			statusCode:     0,
			wantErr:        false,
			wantNil:        true,
			wantToken:      "",
		},
		{
			name:        "server error",
			accessToken: "bad_token",
			serverResponse: copilotTokenResponse{
				Token: "",
			},
			statusCode: http.StatusUnauthorized,
			wantErr:    false,
			wantNil:    true,
			wantToken:  "",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var server *httptest.Server
			if tt.accessToken != "" {
				server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					// Verify headers
					authHeader := r.Header.Get("Authorization")
					assert.Contains(t, authHeader, "token ")
					assert.Contains(t, authHeader, tt.accessToken)

					w.WriteHeader(tt.statusCode)
					json.NewEncoder(w).Encode(tt.serverResponse)
				}))
				defer server.Close()

				// Override copilot token URL via provider-specific data
			}

			creds := Credentials{
				AccessToken: tt.accessToken,
				ProviderSpecificData: map[string]any{
					"copilotTokenUrl": func() string {
						if server != nil {
							return server.URL
						}
						return "https://api.github.com/copilot_internal/v2/token"
					}(),
				},
			}
			result, err := refreshCopilot(context.Background(), creds)

			if tt.wantErr {
				assert.Error(t, err)
				return
			}

			assert.NoError(t, err)

			if tt.wantNil {
				assert.Nil(t, result)
				return
			}

			assert.NotNil(t, result)
			if tt.wantToken != "" {
				assert.Equal(t, tt.wantToken, result.CopilotToken)
				assert.Equal(t, tt.wantToken, result.Token)
			}
		})
	}
}

func TestClassifyOAuthRefreshError(t *testing.T) {
	tests := []struct {
		name       string
		errorText  string
		status     int
		wantCode   string
		wantDesc   string
		wantPerm   bool
	}{
		{
			name:      "invalid_grant error",
			errorText: `{"error": "invalid_grant", "error_description": "Token expired"}`,
			status:    400,
			wantCode:  "invalid_grant",
			wantDesc:  "Token expired",
			wantPerm:  true,
		},
		{
			name:      "refresh_token_reused error",
			errorText: `{"error": "invalid_grant", "error_description": "refresh_token_reused"}`,
			status:    400,
			wantCode:  "invalid_grant",
			wantDesc:  "refresh_token_reused",
			wantPerm:  true,
		},
		{
			name:      "server error",
			errorText: `{"error": "server_error", "error_description": "Internal error"}`,
			status:    500,
			wantCode:  "server_error",
			wantDesc:  "Internal error",
			wantPerm:  false,
		},
		{
			name:      "nested error code",
			errorText: `{"error": {"code": "invalid_request"}, "message": "Bad request"}`,
			status:    400,
			wantCode:  "invalid_request",
			wantDesc:  "Bad request",
			wantPerm:  false,
		},
		{
			name:      "plain text error",
			errorText: "Something went wrong",
			status:    500,
			wantCode:  "",
			wantDesc:  "Something went wrong",
			wantPerm:  false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := ClassifyOAuthRefreshError(tt.errorText, tt.status)
			assert.Equal(t, tt.status, result.Status)
			assert.Equal(t, tt.wantCode, result.Code)
			assert.Equal(t, tt.wantDesc, result.Description)
			assert.Equal(t, tt.wantPerm, result.Permanent)
		})
	}
}

func TestSetProviderOAuth(t *testing.T) {
	// Test setting new provider
	SetProviderOAuth("test-provider", ProviderOAuthConfig{
		ClientID: "test_client",
		TokenURL: "https://test.com/token",
	})

	cfg, ok := getProviderOAuth("test-provider")
	require.True(t, ok)
	assert.Equal(t, "test_client", cfg.ClientID)
	assert.Equal(t, "https://test.com/token", cfg.TokenURL)

	// Test updating existing provider
	SetProviderOAuth("test-provider", ProviderOAuthConfig{
		ClientSecret: "new_secret",
	})

	cfg, ok = getProviderOAuth("test-provider")
	require.True(t, ok)
	assert.Equal(t, "test_client", cfg.ClientID) // Should preserve
	assert.Equal(t, "new_secret", cfg.ClientSecret)
}

// TestIsUnrecoverableError is already defined in refresh_test.go
