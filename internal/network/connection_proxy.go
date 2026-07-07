package network

import (
	"fmt"
	"math"
	"net/url"
	"strings"
)

// ConnectionProxyConfig is the resolved proxy configuration for a single
// upstream request. It is produced by ResolveConnectionProxyConfig from
// provider-specific data stored on a connection.
type ConnectionProxyConfig struct {
	Source                 string // "none" | "legacy" | "pool" | "vercel" | "cloudflare" | "deno" | "error"
	ProxyPoolID            string
	ConnectionProxyEnabled bool
	ConnectionProxyURL     string
	ConnectionNoProxy      string
	StrictProxy            bool
	VercelRelayURL         string
}

// ProxyPoolResolver is the interface for resolving proxy pool entries by ID.
// In production this is backed by the DB; tests can stub it.
type ProxyPoolResolver interface {
	GetProxyPoolByID(id string) (*ProxyPool, error)
}

// ProxyPool mirrors the proxy_pools DB row.
type ProxyPool struct {
	ID          string
	ProxyURL    string
	NoProxy     string
	IsActive    bool
	Type        string // "standard" | "vercel" | "cloudflare" | "deno"
	StrictProxy bool
}

// noopPoolResolver returns nil for every ID — used when no DB is wired.
type noopPoolResolver struct{}

func (noopPoolResolver) GetProxyPoolByID(id string) (*ProxyPool, error) {
	return nil, nil
}

// ResolveConnectionProxyConfig computes the final proxy configuration.
//
// Priority:
//  1. Proxy Pool (if proxyPoolId is set and pool is active)
//  2. Legacy Proxy (connectionProxyEnabled + connectionProxyUrl)
//  3. No Proxy
func ResolveConnectionProxyConfig(providerSpecificData map[string]any, resolver ProxyPoolResolver) ConnectionProxyConfig {
	if resolver == nil {
		resolver = noopPoolResolver{}
	}

	result := ConnectionProxyConfig{Source: "none"}

	legacy := normalizeLegacyProxy(providerSpecificData)

	poolIDRaw := normalizeString(providerSpecificData["proxyPoolId"])
	poolID := poolIDRaw
	if poolID == "__none__" {
		poolID = ""
	}
	result.ProxyPoolID = poolID

	// --- Proxy Pool Resolution ---
	if poolID != "" {
		pool, err := resolver.GetProxyPoolByID(poolID)
		if err == nil && pool != nil && pool.IsActive && pool.ProxyURL != "" {
			noProxy := normalizeString(pool.NoProxy)

			if pool.Type == "vercel" || pool.Type == "cloudflare" || pool.Type == "deno" {
				return ConnectionProxyConfig{
					Source:                 pool.Type,
					ProxyPoolID:            poolID,
					ConnectionProxyEnabled: false,
					ConnectionProxyURL:     "",
					ConnectionNoProxy:      noProxy,
					StrictProxy:            pool.StrictProxy,
					VercelRelayURL:         pool.ProxyURL,
				}
			}

			return ConnectionProxyConfig{
				Source:                 "pool",
				ProxyPoolID:            poolID,
				ConnectionProxyEnabled: true,
				ConnectionProxyURL:     pool.ProxyURL,
				ConnectionNoProxy:      noProxy,
				StrictProxy:            pool.StrictProxy,
			}
		}
	}

	// --- Legacy Proxy Fallback ---
	if legacy.ConnectionProxyEnabled && legacy.ConnectionProxyURL != "" {
		result.Source = "legacy"
		result.ConnectionProxyEnabled = true
		result.ConnectionProxyURL = legacy.ConnectionProxyURL
		result.ConnectionNoProxy = legacy.ConnectionNoProxy
		return result
	}

	// --- No Proxy ---
	result.ConnectionNoProxy = legacy.ConnectionNoProxy
	return result
}

// normalizeLegacyProxy extracts legacy proxy fields from provider-specific data.
func normalizeLegacyProxy(psd map[string]any) ConnectionProxyConfig {
	if psd == nil {
		return ConnectionProxyConfig{}
	}
	return ConnectionProxyConfig{
		ConnectionProxyEnabled: psd["connectionProxyEnabled"] == true,
		ConnectionProxyURL:     normalizeString(psd["connectionProxyUrl"]),
		ConnectionNoProxy:      normalizeString(psd["connectionNoProxy"]),
	}
}

// GetProxyHash computes a stable, non-cryptographic proxy bucket key.
// It groups accounts by the proxy they share so the semaphore and circuit
// breaker can isolate failures per proxy.
//
// Returns "direct" if no proxy, "proxy-<hash>" for explicit proxy, "pool-<hash>" for pool.
func GetProxyHash(providerSpecificData map[string]any) string {
	if providerSpecificData == nil {
		return "direct"
	}
	enabled := providerSpecificData["connectionProxyEnabled"] == true
	urlVal := normalizeString(providerSpecificData["connectionProxyUrl"])
	if enabled && urlVal != "" {
		return "proxy-" + djb2(urlVal)
	}
	poolID := normalizeString(providerSpecificData["proxyPoolId"])
	if poolID != "" {
		return "pool-" + djb2(poolID)
	}
	return "direct"
}

// djb2 is a stable, non-cryptographic hash (matching the Node.js implementation).
func djb2(s string) string {
	hash := uint32(5381)
	for i := 0; i < len(s); i++ {
		hash = ((hash << 5) + hash) + uint32(s[i])
	}
	return fmt.Sprintf("%d", uint32(math.Mod(float64(hash), float64(math.MaxUint32))))
}

// normalizeString trims and returns a string representation of any value.
func normalizeString(v any) string {
	if v == nil {
		return ""
	}
	if s, ok := v.(string); ok {
		return strings.TrimSpace(s)
	}
	return strings.TrimSpace(fmt.Sprint(v))
}

// ValidateProxyURL validates a proxy URL string.
// Returns nil if valid, error otherwise.
func ValidateProxyURL(raw string) (*url.URL, error) {
	if raw == "" {
		return nil, fmt.Errorf("proxyUrl is required")
	}
	// Reject injection attempts
	if strings.ContainsAny(raw, "\n\r`$") {
		return nil, fmt.Errorf("invalid characters in proxy URL")
	}
	parsed, err := url.Parse(raw)
	if err != nil {
		return nil, fmt.Errorf("invalid proxy URL: %w", err)
	}
	allowedSchemes := map[string]bool{
		"http":    true,
		"https":   true,
		"socks5":  true,
		"socks4":  true,
		"socks5h": true,
		"socks4a": true,
	}
	if !allowedSchemes[parsed.Scheme] {
		return nil, fmt.Errorf("unsupported proxy scheme: %s", parsed.Scheme)
	}
	return parsed, nil
}

// ShouldBypassByNoProxy checks if targetURL should bypass the proxy based on
// NO_PROXY patterns. Supports comma-separated host patterns, "*" wildcard,
// and ".domain.com" suffix matching.
func ShouldBypassByNoProxy(targetURL, noProxy string) bool {
	noProxy = strings.TrimSpace(noProxy)
	if noProxy == "" {
		return false
	}

	parsed, err := url.Parse(targetURL)
	if err != nil {
		return false
	}
	hostname := strings.ToLower(parsed.Hostname())

	patterns := strings.Split(noProxy, ",")
	for _, p := range patterns {
		pattern := strings.ToLower(strings.TrimSpace(p))
		if pattern == "" {
			continue
		}
		if pattern == "*" {
			return true
		}
		if strings.HasPrefix(pattern, ".") {
			if strings.HasSuffix(hostname, pattern) || hostname == pattern[1:] {
				return true
			}
			continue
		}
		if hostname == pattern || strings.HasSuffix(hostname, "."+pattern) {
			return true
		}
	}
	return false
}

// NormalizeProxyURL normalizes a proxy URL string. Allows "host:port" → "http://host:port".
func NormalizeProxyURL(raw string) string {
	normalized := strings.TrimSpace(raw)
	if normalized == "" {
		return ""
	}
	if _, err := url.Parse(normalized); err != nil && !strings.Contains(normalized, "://") {
		return "http://" + normalized
	}
	if !strings.Contains(normalized, "://") {
		return "http://" + normalized
	}
	return normalized
}

// ResolveConnectionProxyURL returns the proxy URL to use for a target URL,
// or empty string if no proxy should be used.
func ResolveConnectionProxyURL(targetURL string, opts ConnectionProxyConfig) string {
	if !opts.ConnectionProxyEnabled || opts.ConnectionProxyURL == "" {
		return ""
	}
	if opts.ConnectionNoProxy != "" && ShouldBypassByNoProxy(targetURL, opts.ConnectionNoProxy) {
		return ""
	}
	return NormalizeProxyURL(opts.ConnectionProxyURL)
}
