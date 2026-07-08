package executors

import (
	"net/http"
	"strings"
)

// OpenCodeExecutor targets OpenCode API.
type OpenCodeExecutor struct {
	DefaultExecutor
}

// NewOpenCodeExecutor creates an OpenCode executor.
func NewOpenCodeExecutor(provider string, cfg *ProviderConfig) *OpenCodeExecutor {
	return &OpenCodeExecutor{DefaultExecutor: *NewDefaultExecutor(provider, cfg)}
}

// BuildURL returns the OpenCode endpoint.
func (ex *OpenCodeExecutor) BuildURL(model string, stream bool, urlIndex int, creds Credentials) string {
	if url := ex.BaseExecutor.BuildURL(model, stream, urlIndex, creds); url != "" {
		return url
	}

	baseURL := "https://api.opencode.ai"
	if b, _ := creds.ProviderSpecificData["baseUrl"].(string); b != "" {
		baseURL = strings.TrimSuffix(b, "/")
	}
	return baseURL + "/v1/chat/completions"
}

// BuildHeaders sets OpenCode auth headers.
func (ex *OpenCodeExecutor) BuildHeaders(creds Credentials, stream bool) http.Header {
	h := ex.DefaultExecutor.BuildHeaders(creds, stream)

	if creds.APIKey != "" {
		h.Set("Authorization", "Bearer "+creds.APIKey)
	}

	return h
}

func init() {
	Register("opencode", func(provider string, cfg *ProviderConfig) Executor {
		return NewOpenCodeExecutor(provider, cfg)
	})
}
