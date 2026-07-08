package executors

import (
	"net/http"
	"strings"
)

// XiaomiTokenplanExecutor targets Xiaomi Tokenplan API.
type XiaomiTokenplanExecutor struct {
	DefaultExecutor
}

// NewXiaomiTokenplanExecutor creates a Xiaomi Tokenplan executor.
func NewXiaomiTokenplanExecutor(provider string, cfg *ProviderConfig) *XiaomiTokenplanExecutor {
	return &XiaomiTokenplanExecutor{DefaultExecutor: *NewDefaultExecutor(provider, cfg)}
}

// BuildURL returns the Xiaomi Tokenplan endpoint.
func (ex *XiaomiTokenplanExecutor) BuildURL(model string, stream bool, urlIndex int, creds Credentials) string {
	if url := ex.BaseExecutor.BuildURL(model, stream, urlIndex, creds); url != "" {
		return url
	}

	// Xiaomi uses region-specific endpoints
	region := "default"
	if r, _ := creds.ProviderSpecificData["region"].(string); r != "" {
		region = r
	}

	baseURL := "https://api.mimo.xiaomi.com"
	if b, _ := creds.ProviderSpecificData["baseUrl"].(string); b != "" {
		baseURL = strings.TrimSuffix(b, "/")
	}
	_ = region

	return baseURL + "/v1/chat/completions"
}

// BuildHeaders sets Xiaomi Tokenplan auth headers.
func (ex *XiaomiTokenplanExecutor) BuildHeaders(creds Credentials, stream bool) http.Header {
	h := ex.DefaultExecutor.BuildHeaders(creds, stream)

	if creds.APIKey != "" {
		h.Set("Authorization", "Bearer "+creds.APIKey)
	}

	return h
}

func init() {
	Register("xiaomi-tokenplan", func(provider string, cfg *ProviderConfig) Executor {
		return NewXiaomiTokenplanExecutor(provider, cfg)
	})
}
