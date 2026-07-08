package executors

import (
	"net/http"
	"strings"
)

// CommandCodeExecutor targets CommandCode API.
type CommandCodeExecutor struct {
	DefaultExecutor
}

// NewCommandCodeExecutor creates a CommandCode executor.
func NewCommandCodeExecutor(provider string, cfg *ProviderConfig) *CommandCodeExecutor {
	return &CommandCodeExecutor{DefaultExecutor: *NewDefaultExecutor(provider, cfg)}
}

// BuildURL returns the CommandCode endpoint.
func (ex *CommandCodeExecutor) BuildURL(model string, stream bool, urlIndex int, creds Credentials) string {
	if url := ex.BaseExecutor.BuildURL(model, stream, urlIndex, creds); url != "" {
		return url
	}

	baseURL := "https://api.commandcode.dev"
	if b, _ := creds.ProviderSpecificData["baseUrl"].(string); b != "" {
		baseURL = strings.TrimSuffix(b, "/")
	}
	return baseURL + "/alpha/generate"
}

// BuildHeaders sets CommandCode auth headers.
func (ex *CommandCodeExecutor) BuildHeaders(creds Credentials, stream bool) http.Header {
	h := ex.DefaultExecutor.BuildHeaders(creds, stream)

	if creds.APIKey != "" {
		h.Set("Authorization", "Bearer "+creds.APIKey)
	}

	return h
}

func init() {
	Register("commandcode", func(provider string, cfg *ProviderConfig) Executor {
		return NewCommandCodeExecutor(provider, cfg)
	})
}
