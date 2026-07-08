package executors

import (
	"net/http"
	"strings"
)

// CodebuddyCnExecutor targets Codebuddy CN API.
type CodebuddyCnExecutor struct {
	DefaultExecutor
}

// NewCodebuddyCnExecutor creates a Codebuddy CN executor.
func NewCodebuddyCnExecutor(provider string, cfg *ProviderConfig) *CodebuddyCnExecutor {
	return &CodebuddyCnExecutor{DefaultExecutor: *NewDefaultExecutor(provider, cfg)}
}

// BuildURL returns the Codebuddy CN endpoint.
func (ex *CodebuddyCnExecutor) BuildURL(model string, stream bool, urlIndex int, creds Credentials) string {
	if url := ex.BaseExecutor.BuildURL(model, stream, urlIndex, creds); url != "" {
		return url
	}

	baseURL := "https://api.codebuddy.cn"
	if b, _ := creds.ProviderSpecificData["baseUrl"].(string); b != "" {
		baseURL = strings.TrimSuffix(b, "/")
	}
	return baseURL + "/v1/chat/completions"
}

// BuildHeaders sets Codebuddy CN auth headers.
func (ex *CodebuddyCnExecutor) BuildHeaders(creds Credentials, stream bool) http.Header {
	h := ex.DefaultExecutor.BuildHeaders(creds, stream)

	if creds.APIKey != "" {
		h.Set("Authorization", "Bearer "+creds.APIKey)
	}

	return h
}

func init() {
	Register("codebuddy-cn", func(provider string, cfg *ProviderConfig) Executor {
		return NewCodebuddyCnExecutor(provider, cfg)
	})
}
