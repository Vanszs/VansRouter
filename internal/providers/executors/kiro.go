package executors

import (
	"net/http"
	"strings"
)

// KiroExecutor targets AWS Kiro (CodeWhisperer) API.
type KiroExecutor struct {
	DefaultExecutor
}

// NewKiroExecutor creates a Kiro executor.
func NewKiroExecutor(provider string, cfg *ProviderConfig) *KiroExecutor {
	return &KiroExecutor{DefaultExecutor: *NewDefaultExecutor(provider, cfg)}
}

// BuildURL returns the Kiro endpoint.
func (ex *KiroExecutor) BuildURL(model string, stream bool, urlIndex int, creds Credentials) string {
	if url := ex.BaseExecutor.BuildURL(model, stream, urlIndex, creds); url != "" {
		return url
	}

	baseURL := "https://codewhisperer.us-east-1.amazonaws.com"
	if b, _ := creds.ProviderSpecificData["baseUrl"].(string); b != "" {
		baseURL = strings.TrimSuffix(b, "/")
	}
	return baseURL + "/" + model + "/completions"
}

// BuildHeaders sets Kiro auth headers.
func (ex *KiroExecutor) BuildHeaders(creds Credentials, stream bool) http.Header {
	h := ex.DefaultExecutor.BuildHeaders(creds, stream)

	if creds.APIKey != "" {
		h.Set("Authorization", "Bearer "+creds.APIKey)
	}

	return h
}

func init() {
	Register("kiro", func(provider string, cfg *ProviderConfig) Executor {
		return NewKiroExecutor(provider, cfg)
	})
}
