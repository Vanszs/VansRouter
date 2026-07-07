package network

import (
	"context"
	"fmt"
	"net/http"
	"net/url"
	"time"
)

// ProxyTestResult holds the outcome of a proxy connectivity test.
type ProxyTestResult struct {
	OK         bool   `json:"ok"`
	Status     int    `json:"status"`
	StatusText string `json:"statusText,omitempty"`
	URL        string `json:"url,omitempty"`
	ElapsedMs  int64  `json:"elapsedMs,omitempty"`
	Error      string `json:"error,omitempty"`
}

const (
	defaultProxyTestURL     = "https://google.com/"
	defaultProxyTestTimeout = 8000 * time.Millisecond
	maxProxyTestTimeout     = 30000 * time.Millisecond
)

// TestProxyURL tests connectivity through a proxy by making a HEAD request
// to a test URL. Returns a ProxyTestResult.
func TestProxyURL(ctx context.Context, proxyURL, testURL string, timeoutMs int) ProxyTestResult {
	normalizedProxyURL := normalizeString(proxyURL)
	if normalizedProxyURL == "" {
		return ProxyTestResult{OK: false, Status: 400, Error: "proxyUrl is required"}
	}

	normalizedTestURL := normalizeString(testURL)
	if normalizedTestURL == "" {
		normalizedTestURL = defaultProxyTestURL
	}

	timeout := defaultProxyTestTimeout
	if timeoutMs > 0 {
		timeout = time.Duration(timeoutMs) * time.Millisecond
		if timeout > maxProxyTestTimeout {
			timeout = maxProxyTestTimeout
		}
	}

	// Validate proxy URL
	if _, err := ValidateProxyURL(normalizedProxyURL); err != nil {
		return ProxyTestResult{OK: false, Status: 400, Error: fmt.Sprintf("Invalid proxy URL: %s", err)}
	}

	// Create a transport with the proxy
	transport := &http.Transport{
		Proxy: http.ProxyURL(mustParseURL(normalizedProxyURL)),
	}
	defer transport.CloseIdleConnections()

	client := &http.Client{
		Transport: transport,
		Timeout:   timeout,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}

	reqCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	req, err := http.NewRequestWithContext(reqCtx, http.MethodHead, normalizedTestURL, nil)
	if err != nil {
		return ProxyTestResult{OK: false, Status: 500, Error: err.Error()}
	}
	req.Header.Set("User-Agent", "VansRouter")

	startedAt := time.Now()
	resp, err := client.Do(req)
	elapsed := time.Since(startedAt).Milliseconds()

	if err != nil {
		if ctx.Err() == context.DeadlineExceeded || reqCtx.Err() == context.DeadlineExceeded {
			return ProxyTestResult{OK: false, Status: 500, Error: "Proxy test timed out", URL: normalizedTestURL, ElapsedMs: elapsed}
		}
		return ProxyTestResult{OK: false, Status: 500, Error: getErrorMessage(err), URL: normalizedTestURL, ElapsedMs: elapsed}
	}
	defer resp.Body.Close()

	return ProxyTestResult{
		OK:         resp.StatusCode >= 200 && resp.StatusCode < 300,
		Status:     resp.StatusCode,
		StatusText: resp.Status,
		URL:        normalizedTestURL,
		ElapsedMs:  elapsed,
	}
}

// mustParseURL parses a URL string, panicking on error.
// Used only after ValidateProxyURL has confirmed the URL is valid.
func mustParseURL(raw string) *url.URL {
	u, err := url.Parse(raw)
	if err != nil {
		panic("mustParseURL called with invalid URL: " + raw)
	}
	return u
}

func getErrorMessage(err error) string {
	if err == nil {
		return "Unknown error"
	}
	return err.Error()
}
