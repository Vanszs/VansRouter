package executors

import (
	"net"
	"net/http"
	"net/url"
	"time"

	"github.com/9router/9router/internal/network"
)

// sharedTransport is a tuned http.Transport for upstream LLM providers.
// It enables HTTP/2, reuses TLS handshakes, and keeps a generous idle pool
// so concurrent streaming requests don't pay connection setup per request.
var sharedTransport = &http.Transport{
	Proxy: http.ProxyFromEnvironment,
	DialContext: (&net.Dialer{
		Timeout:   10 * time.Second,
		KeepAlive: 30 * time.Second,
	}).DialContext,
	ForceAttemptHTTP2:     true,
	MaxIdleConns:          256,
	MaxIdleConnsPerHost:   64,
	MaxConnsPerHost:       128,
	IdleConnTimeout:       90 * time.Second,
	TLSHandshakeTimeout:   10 * time.Second,
	ExpectContinueTimeout: 1 * time.Second,
}

// sharedClient is the reusable upstream HTTP client. Using one client (rather
// than creating a new one per request) lets the transport reuse idle
// connections and amortize TLS handshakes across requests.
var sharedClient = &http.Client{
	Transport: sharedTransport,
}

// ProxyTransport returns the shared upstream transport. Kept for callers that
// need to inspect or wrap it; BaseExecutor uses sharedClient directly.
func ProxyTransport() *http.Transport {
	return sharedTransport
}

// clientForRequest returns an http.Client configured with per-connection proxy
// if present, otherwise falls back to sharedClient (which uses env proxy).
func clientForRequest(targetURL string, creds Credentials) *http.Client {
	// Extract providerSpecificData from Credentials
	psd := creds.ProviderSpecificData
	if psd == nil {
		// No connection-specific proxy, use shared client with env proxy
		return sharedClient
	}

	// Resolve connection-level proxy config (no DB resolver wired yet)
	cfg := network.ResolveConnectionProxyConfig(psd, nil)
	proxyURL := network.ResolveConnectionProxyURL(targetURL, cfg)

	if proxyURL == "" {
		// No proxy configured, use shared client
		return sharedClient
	}

	// Parse proxy URL
	proxyParsed, err := url.Parse(proxyURL)
	if err != nil {
		// Invalid proxy URL, fall back to shared client
		return sharedClient
	}

	// Create transport with explicit proxy
	transport := &http.Transport{
		Proxy: http.ProxyURL(proxyParsed),
		DialContext: (&net.Dialer{
			Timeout:   10 * time.Second,
			KeepAlive: 30 * time.Second,
		}).DialContext,
		ForceAttemptHTTP2:     true,
		MaxIdleConns:          256,
		MaxIdleConnsPerHost:   64,
		MaxConnsPerHost:       128,
		IdleConnTimeout:       90 * time.Second,
		TLSHandshakeTimeout:   10 * time.Second,
		ExpectContinueTimeout: 1 * time.Second,
	}

	return &http.Client{
		Transport: transport,
	}
}
