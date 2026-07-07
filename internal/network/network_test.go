package network

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type fakePoolResolver struct {
	pool *ProxyPool
	err  error
}

func (f fakePoolResolver) GetProxyPoolByID(id string) (*ProxyPool, error) {
	return f.pool, f.err
}

func TestResolveConnectionProxyConfig(t *testing.T) {
	t.Run("legacy proxy", func(t *testing.T) {
		cfg := ResolveConnectionProxyConfig(map[string]any{
			"connectionProxyEnabled": true,
			"connectionProxyUrl":     " http://127.0.0.1:7890 ",
			"connectionNoProxy":      "localhost",
		}, nil)
		assert.Equal(t, "legacy", cfg.Source)
		assert.True(t, cfg.ConnectionProxyEnabled)
		assert.Equal(t, "http://127.0.0.1:7890", cfg.ConnectionProxyURL)
		assert.Equal(t, "localhost", cfg.ConnectionNoProxy)
	})

	t.Run("pool overrides legacy", func(t *testing.T) {
		cfg := ResolveConnectionProxyConfig(map[string]any{
			"proxyPoolId":            "pool-1",
			"connectionProxyEnabled": true,
			"connectionProxyUrl":     "http://legacy:7890",
		}, fakePoolResolver{pool: &ProxyPool{ID: "pool-1", ProxyURL: "http://pool:7890", IsActive: true}})
		assert.Equal(t, "pool", cfg.Source)
		assert.Equal(t, "pool-1", cfg.ProxyPoolID)
		assert.Equal(t, "http://pool:7890", cfg.ConnectionProxyURL)
	})

	t.Run("relay pool", func(t *testing.T) {
		cfg := ResolveConnectionProxyConfig(map[string]any{"proxyPoolId": "cf"}, fakePoolResolver{pool: &ProxyPool{ID: "cf", Type: "cloudflare", ProxyURL: "https://relay.example.com", IsActive: true, StrictProxy: true}})
		assert.Equal(t, "cloudflare", cfg.Source)
		assert.False(t, cfg.ConnectionProxyEnabled)
		assert.Equal(t, "https://relay.example.com", cfg.VercelRelayURL)
		assert.True(t, cfg.StrictProxy)
	})

	t.Run("none", func(t *testing.T) {
		cfg := ResolveConnectionProxyConfig(nil, nil)
		assert.Equal(t, "none", cfg.Source)
		assert.False(t, cfg.ConnectionProxyEnabled)
	})
}

func TestGetProxyHash(t *testing.T) {
	assert.Equal(t, "direct", GetProxyHash(nil))
	assert.Equal(t, "direct", GetProxyHash(map[string]any{"connectionProxyEnabled": false, "connectionProxyUrl": "http://x"}))
	assert.Contains(t, GetProxyHash(map[string]any{"connectionProxyEnabled": true, "connectionProxyUrl": "http://x"}), "proxy-")
	assert.Contains(t, GetProxyHash(map[string]any{"proxyPoolId": "pool-a"}), "pool-")
}

func TestShouldBypassByNoProxy(t *testing.T) {
	assert.True(t, ShouldBypassByNoProxy("https://api.example.com/v1", "example.com"))
	assert.True(t, ShouldBypassByNoProxy("https://api.example.com/v1", ".example.com"))
	assert.True(t, ShouldBypassByNoProxy("https://anything.com", "*"))
	assert.False(t, ShouldBypassByNoProxy("https://api.example.com", "other.com"))
	assert.False(t, ShouldBypassByNoProxy("://bad-url", "*"))
}

func TestValidateProxyURL(t *testing.T) {
	_, err := ValidateProxyURL("http://127.0.0.1:7890")
	require.NoError(t, err)
	_, err = ValidateProxyURL("socks5://127.0.0.1:7890")
	require.NoError(t, err)
	_, err = ValidateProxyURL("ftp://127.0.0.1:21")
	require.Error(t, err)
	_, err = ValidateProxyURL("http://x\nBAD")
	require.Error(t, err)
}

func TestApplyOutboundProxyEnv(t *testing.T) {
	keys := []string{"HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY", "NINE_ROUTER_PROXY_MANAGED", "NINE_ROUTER_PROXY_URL", "NINE_ROUTER_NO_PROXY"}
	for _, k := range keys {
		t.Setenv(k, "")
		os.Unsetenv(k)
	}

	ApplyOutboundProxyEnv(OutboundProxySettings{OutboundProxyEnabled: true, OutboundProxyURL: "http://127.0.0.1:7890", OutboundNoProxy: "localhost"})
	assert.Equal(t, "1", os.Getenv("NINE_ROUTER_PROXY_MANAGED"))
	assert.Equal(t, "http://127.0.0.1:7890", os.Getenv("HTTP_PROXY"))
	assert.Equal(t, "http://127.0.0.1:7890", os.Getenv("HTTPS_PROXY"))
	assert.Equal(t, "localhost", os.Getenv("NO_PROXY"))

	ApplyOutboundProxyEnv(OutboundProxySettings{OutboundProxyEnabled: false})
	assert.Empty(t, os.Getenv("HTTP_PROXY"))
	assert.Empty(t, os.Getenv("NINE_ROUTER_PROXY_MANAGED"))
}

func TestTestProxyURLValidation(t *testing.T) {
	res := TestProxyURL(context.Background(), "", "", 0)
	assert.False(t, res.OK)
	assert.Equal(t, 400, res.Status)

	res = TestProxyURL(context.Background(), "ftp://example.com", "", 0)
	assert.False(t, res.OK)
	assert.Equal(t, 400, res.Status)
}

func TestTestProxyURLWithLocalProxy(t *testing.T) {
	// Minimal local HTTP proxy that accepts absolute-form HEAD requests.
	proxy := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodHead {
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}))
	defer proxy.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	res := TestProxyURL(ctx, proxy.URL, "http://example.com/", 1000)
	assert.True(t, res.OK)
	assert.Equal(t, http.StatusNoContent, res.Status)
	assert.Equal(t, "http://example.com/", res.URL)
}
