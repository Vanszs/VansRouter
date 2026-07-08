package executors

import (
	"net/http"
	"strings"
)

// QwenExecutor targets Qwen (Alibaba) API.
type QwenExecutor struct {
	DefaultExecutor
}

// NewQwenExecutor creates a Qwen executor.
func NewQwenExecutor(provider string, cfg *ProviderConfig) *QwenExecutor {
	return &QwenExecutor{DefaultExecutor: *NewDefaultExecutor(provider, cfg)}
}

// BuildURL returns the Qwen endpoint.
func (ex *QwenExecutor) BuildURL(model string, stream bool, urlIndex int, creds Credentials) string {
	if url := ex.BaseExecutor.BuildURL(model, stream, urlIndex, creds); url != "" {
		return url
	}

	baseURL := "https://dashscope.aliyuncs.com/compatible-mode"
	if b, _ := creds.ProviderSpecificData["baseUrl"].(string); b != "" {
		baseURL = strings.TrimSuffix(b, "/")
	}
	return baseURL + "/v1/chat/completions"
}

// BuildHeaders sets Qwen auth headers.
func (ex *QwenExecutor) BuildHeaders(creds Credentials, stream bool) http.Header {
	h := ex.DefaultExecutor.BuildHeaders(creds, stream)

	if creds.APIKey != "" {
		h.Set("Authorization", "Bearer "+creds.APIKey)
	}

	return h
}

func init() {
	Register("qwen", func(provider string, cfg *ProviderConfig) Executor {
		return NewQwenExecutor(provider, cfg)
	})
}
