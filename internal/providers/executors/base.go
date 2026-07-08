package executors

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

const (
	openaiCompatBaseURL     = "https://api.openai.com/v1"
	anthropicCompatBaseURL  = "https://api.anthropic.com/v1"
	defaultConnectTimeoutMs = 60_000
)

// BaseExecutor is the shared upstream HTTP executor for OpenAI-compatible providers.
// It handles URL selection, auth header construction, retry/fallback loops, and
// context cancellation propagation.
type BaseExecutor struct {
	provider string
	config   *ProviderConfig
}

// NewBaseExecutor creates an executor for provider with the given config.
func NewBaseExecutor(provider string, cfg *ProviderConfig) *BaseExecutor {
	if cfg == nil {
		cfg = &ProviderConfig{}
	}
	return &BaseExecutor{provider: provider, config: cfg}
}

// Provider returns the executor's provider id.
func (ex *BaseExecutor) Provider() string { return ex.provider }

// BaseURLs returns the ordered list of upstream endpoint URLs.
func (ex *BaseExecutor) BaseURLs() []string {
	if len(ex.config.BaseUrls) > 0 {
		return ex.config.BaseUrls
	}
	if ex.config.BaseUrl != "" {
		return []string{ex.config.BaseUrl}
	}
	return nil
}

// FallbackCount returns how many fallback URLs are available (at least 1).
func (ex *BaseExecutor) FallbackCount() int {
	if n := len(ex.BaseURLs()); n > 0 {
		return n
	}
	return 1
}

// BuildURL constructs the upstream URL for the given model, stream flag, and URL index.
func (ex *BaseExecutor) BuildURL(model string, stream bool, urlIndex int, creds Credentials) string {
	// Runtime transport overrides everything else.
	if rt := creds.RuntimeTransport; rt != nil && rt.BaseURL != "" {
		if rt.URLSuffix != "" {
			return rt.BaseURL + rt.URLSuffix
		}
		return rt.BaseURL
	}

	provider := ex.provider

	if strings.HasPrefix(provider, "openai-compatible-") {
		baseURL := openaiCompatBaseURL
		if b, _ := creds.ProviderSpecificData["baseUrl"].(string); b != "" {
			baseURL = b
		}
		baseURL = strings.TrimSuffix(baseURL, "/")
		path := "/chat/completions"
		if strings.Contains(provider, "responses") {
			path = "/responses"
		}
		return baseURL + path
	}

	if strings.HasPrefix(provider, "anthropic-compatible-") {
		baseURL := anthropicCompatBaseURL
		if b, _ := creds.ProviderSpecificData["baseUrl"].(string); b != "" {
			baseURL = b
		}
		baseURL = strings.TrimSuffix(baseURL, "/")
		return baseURL + "/messages"
	}

	if ex.config.Format == "gemini" {
		action := "generateContent"
		if stream {
			action = "streamGenerateContent?alt=sse"
		}
		return fmt.Sprintf("%s/%s:%s", ex.config.BaseUrl, model, action)
	}

	if ex.config.URLSuffix != "" {
		return ex.config.BaseUrl + ex.config.URLSuffix
	}

	urls := ex.BaseURLs()
	if len(urls) == 0 {
		return ""
	}
	url := urls[urlIndex]
	if urlIndex >= len(urls) {
		url = urls[0]
	}

	if strings.Contains(url, "{accountId}") {
		accountID, _ := creds.ProviderSpecificData["accountId"].(string)
		url = strings.ReplaceAll(url, "{accountId}", accountID)
	}
	return url
}

// BuildHeaders constructs the HTTP headers for an upstream request.
func (ex *BaseExecutor) BuildHeaders(creds Credentials, stream bool) http.Header {
	h := make(http.Header)
	h.Set("Content-Type", "application/json")

	for k, v := range ex.config.Headers {
		h.Set(k, v)
	}

	if rt := creds.RuntimeTransport; rt != nil {
		for k, v := range rt.Headers {
			h.Set(k, v)
		}
	}

	desc := ex.resolveAuthDescriptor()
	for _, hook := range desc.Hooks {
		// ponytail: header hooks (kimiHeaders, clineHeaders, claudeOverlay, etc.) deferred to Step 2
		_ = hook
	}

	applyAuth(h, desc, creds)

	if stream && !ex.config.PreserveAccept {
		h.Set("Accept", "text/event-stream")
	}
	return h
}

func (ex *BaseExecutor) resolveAuthDescriptor() AuthDescriptor {
	if rt := ex.provider; strings.HasPrefix(rt, "anthropic-compatible-") {
		return AuthDescriptor{
			APIKey:           &AuthSpec{Header: "x-api-key", Scheme: "raw"},
			OAuth:            &AuthSpec{Header: "Authorization", Scheme: "bearer"},
			AnthropicVersion: true,
		}
	}
	if ex.config.Format == "claude" {
		return AuthDescriptor{Combined: true, Header: "x-api-key", Scheme: "raw", AnthropicVersion: true}
	}
	if len(ex.config.Auth) > 0 {
		var desc AuthDescriptor
		if err := json.Unmarshal(ex.config.Auth, &desc); err == nil {
			return desc
		}
	}
	return AuthDescriptor{Combined: true, Header: "Authorization", Scheme: "bearer"}
}

func applyAuth(h http.Header, desc AuthDescriptor, creds Credentials) {
	token := creds.APIKey
	if token == "" {
		token = creds.AccessToken
	}

	if desc.Combined {
		h.Set(desc.Header, formatAuthValue(desc.Scheme, token))
		if desc.AnthropicVersion && h.Get("anthropic-version") == "" {
			h.Set("anthropic-version", "2023-06-01")
		}
		return
	}

	if creds.APIKey != "" && desc.APIKey != nil {
		h.Set(desc.APIKey.Header, formatAuthValue(desc.APIKey.Scheme, creds.APIKey))
	} else if creds.AccessToken != "" && desc.OAuth != nil {
		h.Set(desc.OAuth.Header, formatAuthValue(desc.OAuth.Scheme, creds.AccessToken))
	}

	if desc.AnthropicVersion && h.Get("anthropic-version") == "" {
		h.Set("anthropic-version", "2023-06-01")
	}
}

func formatAuthValue(scheme, token string) string {
	if scheme == "raw" {
		return token
	}
	return fmt.Sprintf("Bearer %s", token)
}

// Execute performs the upstream request with retry and fallback.
func (ex *BaseExecutor) Execute(ctx context.Context, req ExecuteRequest) (*http.Response, error) {
	bodyJSON, err := json.Marshal(req.Body)
	if err != nil {
		return nil, fmt.Errorf("marshal request body: %w", err)
	}

	fallbackCount := ex.FallbackCount()
	retryConfig := ex.resolveRetryConfig(req.AccountCount)
	retryAttempts := make(map[int]int)

	var lastErr error
	var lastStatus int

	for urlIndex := 0; urlIndex < fallbackCount; urlIndex++ {
		url := ex.BuildURL(req.Model, req.Stream, urlIndex, req.Credentials)
		if url == "" {
			continue
		}

		// Compute proxy hash for resilience bucket key.
		proxyHash := proxyHashForRequest(url, req.Credentials)

		// Check circuit breaker before attempting request.
		if err := CheckBreaker(ex.provider, proxyHash); err != nil {
			return nil, err
		}

		for {
			connectCtx, connectCancel := ex.connectContext(ctx)
			httpReq, err := http.NewRequestWithContext(connectCtx, http.MethodPost, url, bytes.NewReader(bodyJSON))
			if err != nil {
				connectCancel()
				return nil, err
			}
			httpReq.Header = ex.BuildHeaders(req.Credentials, req.Stream)

			resp, err := clientForRequest(url, req.Credentials).Do(httpReq)
			connectCancel()

			if err != nil {
				lastErr = err
				if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
					if ctx.Err() != nil {
						return nil, ctx.Err()
					}
				}
				if ex.shouldRetryStatus(http.StatusBadGateway, retryAttempts[urlIndex], retryConfig, req.AccountCount) {
					retryAttempts[urlIndex]++
					time.Sleep(retryDelay(retryConfig[http.StatusBadGateway]))
					continue
				}
				if urlIndex+1 < fallbackCount {
					break
				}
				return nil, lastErr
			}

			lastStatus = resp.StatusCode

			if ex.shouldRetryStatus(resp.StatusCode, retryAttempts[urlIndex], retryConfig, req.AccountCount) {
				retryAttempts[urlIndex]++
				waitMs := retryDelay(retryConfig[resp.StatusCode])
				io.Copy(io.Discard, resp.Body)
				resp.Body.Close()
				time.Sleep(waitMs)
				continue
			}

			// 429 with more fallback URLs available -> fall through to next URL (JS behavior).
			if resp.StatusCode == http.StatusTooManyRequests && urlIndex+1 < fallbackCount {
				io.Copy(io.Discard, resp.Body)
				resp.Body.Close()
				break
			}

			// Record result to circuit breaker before returning.
			RecordResult(ex.provider, resp, nil, proxyHash)
			return resp, nil
		}
	}

	if lastErr != nil {
		RecordResult(ex.provider, nil, lastErr, "direct")
		return nil, lastErr
	}
	return nil, fmt.Errorf("all %d URLs failed with last status %d", fallbackCount, lastStatus)
}

func (ex *BaseExecutor) connectContext(parent context.Context) (context.Context, context.CancelFunc) {
	timeout := time.Duration(ex.config.TimeoutMs) * time.Millisecond
	if timeout <= 0 {
		timeout = defaultConnectTimeoutMs * time.Millisecond
	}
	return context.WithTimeout(parent, timeout)
}

func (ex *BaseExecutor) resolveRetryConfig(accountCount int) RetryConfig {
	cfg := ex.config.Retry
	if cfg == nil {
		cfg = RetryConfig{
			http.StatusTooManyRequests: {Attempts: 0, DelayMs: 0},
			http.StatusBadGateway:      {Attempts: 3, DelayMs: 3000},
			http.StatusServiceUnavailable: {Attempts: 3, DelayMs: 2000},
			http.StatusGatewayTimeout:  {Attempts: 2, DelayMs: 3000},
		}
	}
	if accountCount < 3 {
		return cfg
	}
	maxAttempts := 2
	if accountCount >= 5 {
		maxAttempts = 1
	}
	capped := make(RetryConfig, len(cfg))
	for code, entry := range cfg {
		entry.Attempts = min(entry.Attempts, maxAttempts)
		capped[code] = entry
	}
	return capped
}

func (ex *BaseExecutor) shouldRetryStatus(status, attempts int, cfg RetryConfig, accountCount int) bool {
	entry, ok := cfg[status]
	if !ok {
		return false
	}
	maxAttempts := entry.Attempts
	if accountCount >= 5 {
		maxAttempts = min(maxAttempts, 1)
	} else if accountCount >= 3 {
		maxAttempts = min(maxAttempts, 2)
	}
	return attempts < maxAttempts
}

func retryDelay(entry RetryEntry) time.Duration {
	if entry.DelayMs > 0 {
		return time.Duration(entry.DelayMs) * time.Millisecond
	}
	return defaultRetryDelayMs * time.Millisecond
}
