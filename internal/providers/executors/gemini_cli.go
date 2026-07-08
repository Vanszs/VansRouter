package executors

import (
	"net/http"
	"os"
	"strings"
)

// GeminiCliExecutor targets Gemini CLI API.
type GeminiCliExecutor struct {
	BaseExecutor
}

// NewGeminiCliExecutor creates a Gemini CLI executor.
func NewGeminiCliExecutor(provider string, cfg *ProviderConfig) *GeminiCliExecutor {
	return &GeminiCliExecutor{BaseExecutor: *NewBaseExecutor(provider, cfg)}
}

// BuildURL returns the Gemini CLI endpoint.
func (ex *GeminiCliExecutor) BuildURL(model string, stream bool, urlIndex int, creds Credentials) string {
	if url := ex.BaseExecutor.BuildURL(model, stream, urlIndex, creds); url != "" {
		return url
	}

	baseURL := "https://generativelanguage.googleapis.com"
	if b, _ := creds.ProviderSpecificData["baseUrl"].(string); b != "" {
		baseURL = strings.TrimSuffix(b, "/")
	} else if b := os.Getenv("GOOGLE_GEMINI_BASE_URL"); b != "" {
		baseURL = strings.TrimSuffix(b, "/")
	}

	action := "generateContent"
	if stream {
		action = "streamGenerateContent?alt=sse"
	}
	return baseURL + "/v1beta/models/" + model + ":" + action
}

// BuildHeaders sets Gemini CLI auth headers.
func (ex *GeminiCliExecutor) BuildHeaders(creds Credentials, stream bool) http.Header {
	h := ex.BaseExecutor.BuildHeaders(creds, stream)

	// Gemini CLI uses x-goog-api-key header
	if creds.APIKey != "" {
		h.Set("x-goog-api-key", creds.APIKey)
	}

	return h
}

func init() {
	Register("gemini-cli", func(provider string, cfg *ProviderConfig) Executor {
		return NewGeminiCliExecutor(provider, cfg)
	})
}
