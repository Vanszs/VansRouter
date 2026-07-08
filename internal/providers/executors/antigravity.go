package executors

import (
	"net/http"
	"strings"
)

// AntigravityExecutor targets Antigravity's Gemini-compatible API.
type AntigravityExecutor struct {
	BaseExecutor
}

// NewAntigravityExecutor creates an Antigravity executor.
func NewAntigravityExecutor(provider string, cfg *ProviderConfig) *AntigravityExecutor {
	return &AntigravityExecutor{BaseExecutor: *NewBaseExecutor(provider, cfg)}
}

// BuildURL returns the Antigravity endpoint.
func (ex *AntigravityExecutor) BuildURL(model string, stream bool, urlIndex int, creds Credentials) string {
	if url := ex.BaseExecutor.BuildURL(model, stream, urlIndex, creds); url != "" {
		return url
	}

	// Antigravity uses Gemini-compatible endpoints
	baseURL := "https://api.antigravity.ai"
	if b, _ := creds.ProviderSpecificData["baseUrl"].(string); b != "" {
		baseURL = strings.TrimSuffix(b, "/")
	}

	action := "generateContent"
	if stream {
		action = "streamGenerateContent?alt=sse"
	}
	return baseURL + "/" + model + ":" + action
}

// BuildHeaders sets Antigravity auth headers.
func (ex *AntigravityExecutor) BuildHeaders(creds Credentials, stream bool) http.Header {
	h := ex.BaseExecutor.BuildHeaders(creds, stream)

	// Antigravity uses Bearer auth
	if creds.APIKey != "" {
		h.Set("Authorization", "Bearer "+creds.APIKey)
	}

	return h
}

func init() {
	Register("antigravity", func(provider string, cfg *ProviderConfig) Executor {
		return NewAntigravityExecutor(provider, cfg)
	})
}
