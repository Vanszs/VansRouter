package executors

import (
	"context"
	"fmt"
	"net/http"
	"sync"

	"github.com/9router/9router/internal/network"
	"github.com/9router/9router/internal/resilience"
)

// globalProviderRegistry is the shared breaker/semaphore registry.
// It is initialized once and reused across all executor calls.
var (
	globalProviderRegistry *resilience.ProviderRegistry
	globalSemaphore         *resilience.Semaphore
	initMu                  sync.Mutex
	initialized            bool
)

// InitResilience initializes the global breaker/semaphore registries.
// Call once at startup. Safe to call multiple times.
func InitResilience() {
	initMu.Lock()
	defer initMu.Unlock()
	if initialized {
		return
	}
	globalProviderRegistry = resilience.NewProviderRegistry()
	globalSemaphore = resilience.NewSemaphore()
	initialized = true
}

// proxyHashForRequest computes the proxy hash for a request, used as the
// resilience bucket key component. Returns "direct" when no proxy is used.
func proxyHashForRequest(targetURL string, creds Credentials) string {
	psd := creds.ProviderSpecificData
	if psd == nil {
		return "direct"
	}
	cfg := network.ResolveConnectionProxyConfig(psd, nil)
	proxyURL := network.ResolveConnectionProxyURL(targetURL, cfg)
	if proxyURL == "" {
		return "direct"
	}
	return network.GetProxyHash(psd)
}

// CheckBreaker returns nil if the breaker for (provider, proxyHash) allows
// execution, or an error if the circuit is open.
func CheckBreaker(provider, proxyHash string) error {
	if !initialized {
		return nil
	}
	if globalProviderRegistry == nil {
		return nil
	}
	if globalProviderRegistry.IsProviderInCooldown(provider, proxyHash) {
		remaining := globalProviderRegistry.GetProviderCooldownRemainingMs(provider, proxyHash)
		var ms int64
		if remaining != nil {
			ms = *remaining
		}
		return fmt.Errorf("circuit breaker open for %s (proxy=%s): retry after %dms", provider, proxyHash, ms)
	}
	return nil
}

// RecordResult records success/failure to the breaker for (provider, proxyHash).
func RecordResult(provider string, resp *http.Response, err error, proxyHash string) {
	if !initialized || globalProviderRegistry == nil {
		return
	}
	if err != nil {
		globalProviderRegistry.RecordProviderFailure(provider, 0, err.Error(), "", proxyHash)
		return
	}
	if resp != nil && resp.StatusCode >= 500 {
		globalProviderRegistry.RecordProviderFailure(provider, resp.StatusCode, fmt.Sprintf("HTTP %d", resp.StatusCode), "", proxyHash)
		return
	}
	if resp != nil && resp.StatusCode == 429 {
		globalProviderRegistry.RecordProviderFailure(provider, resp.StatusCode, "rate limited", "", proxyHash)
		return
	}
	// Success: clear any prior transient failures
	globalProviderRegistry.ClearProviderFailure(provider, proxyHash)
}

// AcquireSemaphore acquires a concurrency slot for the given provider/account/proxy.
// Returns a release function. If maxConcurrency <= 0, returns a no-op.
func AcquireSemaphore(ctx context.Context, provider, accountKey, proxyHash string, maxConcurrency int) (func(), error) {
	if !initialized || globalSemaphore == nil {
		return func() {}, nil
	}
	if maxConcurrency <= 0 {
		return func() {}, nil
	}
	key := resilience.AccountKey(provider, accountKey, proxyHash)
	return globalSemaphore.Acquire(ctx, key, maxConcurrency)
}
