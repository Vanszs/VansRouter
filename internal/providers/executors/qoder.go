package executors

import (
	"net/http"
	"strings"
)

// QoderExecutor targets Qoder API.
type QoderExecutor struct {
	DefaultExecutor
}

// NewQoderExecutor creates a Qoder executor.
func NewQoderExecutor(provider string, cfg *ProviderConfig) *QoderExecutor {
	return &QoderExecutor{DefaultExecutor: *NewDefaultExecutor(provider, cfg)}
}

// BuildURL returns the Qoder endpoint.
func (ex *QoderExecutor) BuildURL(model string, stream bool, urlIndex int, creds Credentials) string {
	if url := ex.BaseExecutor.BuildURL(model, stream, urlIndex, creds); url != "" {
		return url
	}

	baseURL := "https://api.qoder.ai"
	if b, _ := creds.ProviderSpecificData["baseUrl"].(string); b != "" {
		baseURL = strings.TrimSuffix(b, "/")
	}
	return baseURL + "/v1/chat/completions"
}

// BuildHeaders sets Qoder auth headers.
func (ex *QoderExecutor) BuildHeaders(creds Credentials, stream bool) http.Header {
	h := ex.DefaultExecutor.BuildHeaders(creds, stream)

	if creds.APIKey != "" {
		h.Set("Authorization", "Bearer "+creds.APIKey)
	}

	return h
}

func init() {
	Register("qoder", func(provider string, cfg *ProviderConfig) Executor {
		return NewQoderExecutor(provider, cfg)
	})
}
