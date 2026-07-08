package executors

import (
	"net/http"
	"strings"
)

// GrokWebExecutor targets Grok web API.
type GrokWebExecutor struct {
	DefaultExecutor
}

// NewGrokWebExecutor creates a Grok web executor.
func NewGrokWebExecutor(provider string, cfg *ProviderConfig) *GrokWebExecutor {
	return &GrokWebExecutor{DefaultExecutor: *NewDefaultExecutor(provider, cfg)}
}

// BuildURL returns the Grok web endpoint.
func (ex *GrokWebExecutor) BuildURL(model string, stream bool, urlIndex int, creds Credentials) string {
	if url := ex.BaseExecutor.BuildURL(model, stream, urlIndex, creds); url != "" {
		return url
	}

	baseURL := "https://api.x.ai"
	if b, _ := creds.ProviderSpecificData["baseUrl"].(string); b != "" {
		baseURL = strings.TrimSuffix(b, "/")
	}
	return baseURL + "/v1/chat/completions"
}

// BuildHeaders sets Grok web auth headers.
func (ex *GrokWebExecutor) BuildHeaders(creds Credentials, stream bool) http.Header {
	h := ex.DefaultExecutor.BuildHeaders(creds, stream)

	if creds.APIKey != "" {
		h.Set("Authorization", "Bearer "+creds.APIKey)
	}

	return h
}

func init() {
	Register("grok-web", func(provider string, cfg *ProviderConfig) Executor {
		return NewGrokWebExecutor(provider, cfg)
	})
}
