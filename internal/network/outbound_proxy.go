package network

import (
	"os"
	"strings"
)

// OutboundProxySettings holds the global outbound proxy configuration
// read from the settings DB.
type OutboundProxySettings struct {
	OutboundProxyEnabled bool
	OutboundProxyURL     string
	OutboundNoProxy      string
}

// ApplyOutboundProxyEnv writes HTTP_PROXY / HTTPS_PROXY / ALL_PROXY / NO_PROXY
// environment variables based on the provided settings.
//
// When disabled, previously-managed env vars are cleaned up.
// When enabled with values, they are written and marked as managed.
// When enabled with empty values, externally-provided env vars are left alone.
func ApplyOutboundProxyEnv(settings OutboundProxySettings) {
	enabled := settings.OutboundProxyEnabled
	proxyURL := normalizeString(settings.OutboundProxyURL)
	noProxy := normalizeString(settings.OutboundNoProxy)

	const managedFlag = "NINE_ROUTER_PROXY_MANAGED"

	// If disabled, clear managed env vars.
	if !enabled {
		if os.Getenv(managedFlag) == "1" {
			os.Unsetenv("HTTP_PROXY")
			os.Unsetenv("HTTPS_PROXY")
			os.Unsetenv("ALL_PROXY")
			os.Unsetenv("NO_PROXY")
			os.Unsetenv(managedFlag)
			os.Unsetenv("NINE_ROUTER_PROXY_URL")
			os.Unsetenv("NINE_ROUTER_NO_PROXY")
		}
		return
	}

	wasManaged := os.Getenv(managedFlag) == "1"
	managed := false

	if wasManaged {
		if proxyURL == "" {
			os.Unsetenv("HTTP_PROXY")
			os.Unsetenv("HTTPS_PROXY")
			os.Unsetenv("ALL_PROXY")
			os.Unsetenv("NINE_ROUTER_PROXY_URL")
		}
		if noProxy == "" {
			os.Unsetenv("NO_PROXY")
			os.Unsetenv("NINE_ROUTER_NO_PROXY")
		}
	}

	if proxyURL != "" {
		if validated, err := ValidateProxyURL(proxyURL); err == nil {
			v := validated.String()
			os.Setenv("HTTP_PROXY", v)
			os.Setenv("HTTPS_PROXY", v)
			os.Setenv("ALL_PROXY", v)
			os.Setenv("NINE_ROUTER_PROXY_URL", v)
			managed = true
		}
	}

	if noProxy != "" {
		os.Setenv("NO_PROXY", noProxy)
		os.Setenv("NINE_ROUTER_NO_PROXY", noProxy)
		managed = true
	}

	if managed {
		os.Setenv(managedFlag, "1")
	} else if wasManaged {
		os.Unsetenv(managedFlag)
	}
}

// GetEnvProxyURL returns the proxy URL for a target URL based on environment
// variables (HTTP_PROXY, HTTPS_PROXY, ALL_PROXY, NO_PROXY).
// Returns empty string if no proxy should be used.
func GetEnvProxyURL(targetURL string) string {
	noProxy := os.Getenv("NO_PROXY")
	if noProxy == "" {
		noProxy = os.Getenv("no_proxy")
	}
	if ShouldBypassByNoProxy(targetURL, noProxy) {
		return ""
	}

	// Parse protocol from target URL
	isHTTPS := strings.HasPrefix(targetURL, "https://")

	if isHTTPS {
		for _, key := range []string{"HTTPS_PROXY", "https_proxy", "ALL_PROXY", "all_proxy"} {
			if v := os.Getenv(key); v != "" {
				return v
			}
		}
		return ""
	}

	for _, key := range []string{"HTTP_PROXY", "http_proxy", "ALL_PROXY", "all_proxy"} {
		if v := os.Getenv(key); v != "" {
			return v
		}
	}
	return ""
}
