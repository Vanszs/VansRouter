package executors

import (
	"net/http"
	"strings"
)

// IFlowExecutor targets IFlow API.
type IFlowExecutor struct {
	DefaultExecutor
}

// NewIFlowExecutor creates an IFlow executor.
func NewIFlowExecutor(provider string, cfg *ProviderConfig) *IFlowExecutor {
	return &IFlowExecutor{DefaultExecutor: *NewDefaultExecutor(provider, cfg)}
}

// BuildURL returns the IFlow endpoint.
func (ex *IFlowExecutor) BuildURL(model string, stream bool, urlIndex int, creds Credentials) string {
	if url := ex.BaseExecutor.BuildURL(model, stream, urlIndex, creds); url != "" {
		return url
	}

	baseURL := "https://api.iflow.cn"
	if b, _ := creds.ProviderSpecificData["baseUrl"].(string); b != "" {
		baseURL = strings.TrimSuffix(b, "/")
	}
	return baseURL + "/v1/chat/completions"
}

// BuildHeaders sets IFlow auth headers.
func (ex *IFlowExecutor) BuildHeaders(creds Credentials, stream bool) http.Header {
	h := ex.DefaultExecutor.BuildHeaders(creds, stream)

	if creds.APIKey != "" {
		h.Set("Authorization", "Bearer "+creds.APIKey)
	}

	return h
}

func init() {
	Register("iflow", func(provider string, cfg *ProviderConfig) Executor {
		return NewIFlowExecutor(provider, cfg)
	})
}
