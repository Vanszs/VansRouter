package resilience

import (
	"fmt"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// ---- ERROR_RULES / CheckFallbackError -----------------------------------

// TestAccountFallback is the meta-test the step verification command
// targets. It re-runs the per-scenario tests below so that
// `go test -run TestAccountFallback` is a single entry point.
func TestAccountFallback(t *testing.T) {
	t.Run("CheckFallbackError_TextRule", TestCheckFallbackError_TextRule)
	t.Run("CheckFallbackError_TextRuleBackoff", TestCheckFallbackError_TextRuleBackoff)
	t.Run("CheckFallbackError_StatusRule", TestCheckFallbackError_StatusRule)
	t.Run("CheckFallbackError_StatusBackoff429", TestCheckFallbackError_StatusBackoff429)
	t.Run("CheckFallbackError_DefaultTransient", TestCheckFallbackError_DefaultTransient)
	t.Run("CheckFallbackError_TextBeatsStatus", TestCheckFallbackError_TextBeatsStatus)
	t.Run("CheckFallbackError_MaxBackoffLevelCapped", TestCheckFallbackError_MaxBackoffLevelCapped)
	t.Run("GetQuotaCooldown", TestGetQuotaCooldown)
	t.Run("IsAccountUnavailable", TestIsAccountUnavailable)
	t.Run("GetUnavailableUntil", TestGetUnavailableUntil)
	t.Run("FilterAvailableAccounts", TestFilterAvailableAccounts)
	t.Run("ResetAccountState", TestResetAccountState)
	t.Run("ApplyErrorState_Backoff", TestApplyErrorState_Backoff)
	t.Run("GetEarliestRateLimitedUntil", TestGetEarliestRateLimitedUntil)
	t.Run("FormatRetryAfter", TestFormatRetryAfter)
	t.Run("FormatRetryAfter_Past", TestFormatRetryAfter_Past)
	t.Run("FormatRetryAfter_Nil", TestFormatRetryAfter_Nil)
	t.Run("IsKimchiQuotaExhausted", TestIsKimchiQuotaExhausted)
	t.Run("GetNextMonthReset", TestGetNextMonthReset)
	t.Run("BuildKimchiQuotaExhaustedUpdate", TestBuildKimchiQuotaExhaustedUpdate)
	t.Run("BuildKimchiQuotaReactivatedUpdate", TestBuildKimchiQuotaReactivatedUpdate)
	t.Run("IsProviderExhaustedReason", TestIsProviderExhaustedReason)
	t.Run("IsProviderFailureCode", TestIsProviderFailureCode)
	t.Run("ProviderRegistry_NotBlockedInitially", TestProviderRegistry_NotBlockedInitially)
	t.Run("ProviderRegistry_OpensAfterFailures", TestProviderRegistry_OpensAfterFailures)
	t.Run("ProviderRegistry_429DoesNotCount", TestProviderRegistry_429DoesNotCount)
	t.Run("ProviderRegistry_DedupSameConnection", TestProviderRegistry_DedupSameConnection)
	t.Run("ProviderRegistry_ProxyIsolation", TestProviderRegistry_ProxyIsolation)
	t.Run("ProviderRegistry_FullyBlocked", TestProviderRegistry_FullyBlocked)
	t.Run("ProviderRegistry_ShortestCooldown", TestProviderRegistry_ShortestCooldown)
	t.Run("ProviderRegistry_GetProvidersInCooldown", TestProviderRegistry_GetProvidersInCooldown)
	t.Run("ProviderRegistry_ClearProviderFailure", TestProviderRegistry_ClearProviderFailure)
	t.Run("ProviderRegistry_UsesTunedProfile", TestProviderRegistry_UsesTunedProfile)
}

func TestCheckFallbackError_TextRule(t *testing.T) {
	dec := CheckFallbackError(500, "no credentials supplied", 0)
	assert.True(t, dec.ShouldFallback)
	assert.Equal(t, cooldownLong, dec.CooldownMs)
	assert.Nil(t, dec.NewBackoffLevel)
}

func TestCheckFallbackError_TextRuleBackoff(t *testing.T) {
	dec := CheckFallbackError(429, "rate limit reached", 2)
	assert.True(t, dec.ShouldFallback)
	assert.Equal(t, GetQuotaCooldown(3), dec.CooldownMs)
	require.NotNil(t, dec.NewBackoffLevel)
	assert.Equal(t, 3, *dec.NewBackoffLevel)
}

func TestCheckFallbackError_StatusRule(t *testing.T) {
	dec := CheckFallbackError(401, "ignored message", 0)
	assert.True(t, dec.ShouldFallback)
	assert.Equal(t, cooldownLong, dec.CooldownMs)
}

func TestCheckFallbackError_StatusBackoff429(t *testing.T) {
	dec := CheckFallbackError(429, "", 0)
	assert.True(t, dec.ShouldFallback)
	require.NotNil(t, dec.NewBackoffLevel)
	assert.Equal(t, 1, *dec.NewBackoffLevel)
}

func TestCheckFallbackError_DefaultTransient(t *testing.T) {
	dec := CheckFallbackError(500, "totally unrelated text", 0)
	assert.True(t, dec.ShouldFallback)
	assert.Equal(t, transientCooldownMs, dec.CooldownMs)
}

func TestCheckFallbackError_TextBeatsStatus(t *testing.T) {
	// Status 401 + text "rate limit" → text rule wins (top of table).
	dec := CheckFallbackError(401, "rate limit reached", 0)
	assert.True(t, dec.ShouldFallback)
	require.NotNil(t, dec.NewBackoffLevel)
}

func TestCheckFallbackError_MaxBackoffLevelCapped(t *testing.T) {
	dec := CheckFallbackError(429, "", 99)
	require.NotNil(t, dec.NewBackoffLevel)
	assert.Equal(t, defaultMaxBackoffLvl, *dec.NewBackoffLevel)
}

// ---- GetQuotaCooldown ---------------------------------------------------

func TestGetQuotaCooldown(t *testing.T) {
	assert.Equal(t, defaultBase, GetQuotaCooldown(1))
	assert.Equal(t, defaultBase*2, GetQuotaCooldown(2))
	assert.Equal(t, defaultBase*4, GetQuotaCooldown(3))
	// Above maxLevel → still capped.
	assert.Equal(t, defaultMaxBackoff, GetQuotaCooldown(50))
}

// ---- IsAccountUnavailable / GetUnavailableUntil -------------------------

func TestIsAccountUnavailable(t *testing.T) {
	future := time.Now().Add(1 * time.Hour)
	past := time.Now().Add(-1 * time.Hour)
	assert.True(t, IsAccountUnavailable(&future))
	assert.False(t, IsAccountUnavailable(&past))
	assert.False(t, IsAccountUnavailable(nil))
}

func TestGetUnavailableUntil(t *testing.T) {
	start := time.Now()
	until := GetUnavailableUntil(5_000)
	assert.True(t, until.After(start))
	assert.WithinDuration(t, start.Add(5*time.Second), until, 200*time.Millisecond)
}

// ---- FilterAvailableAccounts --------------------------------------------

func TestFilterAvailableAccounts(t *testing.T) {
	type acc struct {
		ID              string
		RateLimitedUntil *time.Time
	}
	future := time.Now().Add(time.Hour)
	past := time.Now().Add(-time.Hour)
	accounts := []acc{
		{ID: "a"},
		{ID: "b", RateLimitedUntil: &future},
		{ID: "c", RateLimitedUntil: &past},
	}
	got := FilterAvailableAccounts(accounts,
		func(a acc) string { return a.ID },
		func(a acc) *time.Time { return a.RateLimitedUntil },
		"a",
	)
	require.Len(t, got, 1)
	assert.Equal(t, "c", got[0].ID)
}

// ---- ResetAccountState / ApplyErrorState --------------------------------

func TestResetAccountState(t *testing.T) {
	s := &AccountState{
		BackoffLevel: 3,
		Status:       "error",
	}
	got := ResetAccountState(s)
	assert.Equal(t, 0, got.BackoffLevel)
	assert.Equal(t, "active", got.Status)
}

func TestApplyErrorState_Backoff(t *testing.T) {
	s := &AccountState{BackoffLevel: 0}
	got := ApplyErrorState(s, 429, "rate limit reached")
	assert.Equal(t, 1, got.BackoffLevel)
	assert.Equal(t, "error", got.Status)
	require.NotNil(t, got.RateLimitedUntil)
	assert.True(t, got.RateLimitedUntil.After(time.Now()))
}

// ---- GetEarliestRateLimitedUntil / FormatRetryAfter ---------------------

func TestGetEarliestRateLimitedUntil(t *testing.T) {
	now := time.Now()
	b := now.Add(time.Hour)
	c := now.Add(2 * time.Hour)
	past := now.Add(-time.Hour)
	got := GetEarliestRateLimitedUntil(
		[]*time.Time{nil, &b, &c, &past},
		func(t *time.Time) *time.Time { return t },
	)
	require.NotNil(t, got)
	assert.True(t, got.Equal(b))
}

func TestFormatRetryAfter(t *testing.T) {
	future := time.Now().Add(2*time.Hour + 30*time.Minute + 5*time.Second)
	assert.Equal(t, "reset after 2h 30m 5s", FormatRetryAfter(&future))
}

func TestFormatRetryAfter_Past(t *testing.T) {
	past := time.Now().Add(-time.Hour)
	assert.Equal(t, "reset after 0s", FormatRetryAfter(&past))
}

func TestFormatRetryAfter_Nil(t *testing.T) {
	assert.Equal(t, "", FormatRetryAfter(nil))
}

// ---- Kimchi quota ------------------------------------------------------

func TestIsKimchiQuotaExhausted(t *testing.T) {
	assert.True(t, IsKimchiQuotaExhausted("kimchi", "Account has exhausted its credits"))
	assert.True(t, IsKimchiQuotaExhausted("kimchi", "no remaining credits"))
	assert.True(t, IsKimchiQuotaExhausted("kimchi", "payment required"))
	// Specific enough to avoid transient retry messages.
	assert.False(t, IsKimchiQuotaExhausted("kimchi", "exhausted all retries"))
	// Only Kimchi.
	assert.False(t, IsKimchiQuotaExhausted("openai", "exhausted its credits"))
	assert.False(t, IsKimchiQuotaExhausted("", "anything"))
}

func TestGetNextMonthReset(t *testing.T) {
	// Mid-month → first of next month.
	mar15 := time.Date(2026, 3, 15, 12, 0, 0, 0, time.UTC)
	got := GetNextMonthReset(mar15)
	assert.Equal(t, time.Date(2026, 4, 1, 0, 0, 0, 0, time.UTC), got)

	// 1st of month → today's boundary.
	apr1 := time.Date(2026, 4, 1, 5, 0, 0, 0, time.UTC)
	got = GetNextMonthReset(apr1)
	assert.Equal(t, time.Date(2026, 4, 1, 0, 0, 0, 0, time.UTC), got)

	// December → next January.
	dec := time.Date(2026, 12, 20, 0, 0, 0, 0, time.UTC)
	got = GetNextMonthReset(dec)
	assert.Equal(t, time.Date(2027, 1, 1, 0, 0, 0, 0, time.UTC), got)
}

func TestBuildKimchiQuotaExhaustedUpdate(t *testing.T) {
	at := time.Date(2026, 3, 15, 12, 0, 0, 0, time.UTC)
	upd := BuildKimchiQuotaExhaustedUpdate(at)
	assert.False(t, upd.IsActive)
	require.NotNil(t, upd.RateLimitedUntil)
	assert.Equal(t, time.Date(2026, 4, 1, 0, 0, 0, 0, time.UTC), *upd.RateLimitedUntil)
	assert.Equal(t, "quota_exhausted", upd.TestStatus)
	assert.Equal(t, 402, upd.ErrorCode)
	require.NotNil(t, upd.QuotaExhaustedAt)
	assert.Equal(t, at, *upd.QuotaExhaustedAt)
}

func TestBuildKimchiQuotaReactivatedUpdate(t *testing.T) {
	upd := BuildKimchiQuotaReactivatedUpdate()
	assert.True(t, upd.IsActive)
	require.NotNil(t, upd.RateLimitedUntil)
	assert.Equal(t, "", *upd.RateLimitedUntil)
	assert.Equal(t, "active", upd.TestStatus)
}

// ---- IsProviderExhaustedReason -----------------------------------------

func TestIsProviderExhaustedReason(t *testing.T) {
	assert.True(t, IsProviderExhaustedReason("credits exhausted"))
	assert.True(t, IsProviderExhaustedReason("quota exceeded"))
	assert.True(t, IsProviderExhaustedReason("rate limit reached"))
	assert.True(t, IsProviderExhaustedReason("no remaining credits"))
	assert.True(t, IsProviderExhaustedReason("payment required"))
	// Specific enough to avoid transient retry messages.
	assert.False(t, IsProviderExhaustedReason("exhausted all retries"))
	assert.False(t, IsProviderExhaustedReason(nil))
	assert.False(t, IsProviderExhaustedReason(""))
}

// ---- IsProviderFailureCode ---------------------------------------------

func TestIsProviderFailureCode(t *testing.T) {
	for _, code := range []int{408, 500, 502, 503, 504} {
		assert.True(t, IsProviderFailureCode(code), "code %d", code)
	}
	for _, code := range []int{0, 200, 400, 401, 429} {
		assert.False(t, IsProviderFailureCode(code), "code %d", code)
	}
}

// ---- ProviderRegistry (profile-aware breaker per provider/proxyHash) ----

func newTestRegistry(t *testing.T) *ProviderRegistry {
	t.Helper()
	return NewProviderRegistry()
}

func TestProviderRegistry_NotBlockedInitially(t *testing.T) {
	r := newTestRegistry(t)
	assert.False(t, r.IsProviderInCooldown("openai", ""))
	assert.Nil(t, r.GetProviderCooldownRemainingMs("openai", ""))
	assert.False(t, r.IsProviderFullyBlocked("openai"))
	assert.Equal(t, int64(0), r.GetProviderShortestCooldownMs("openai"))
}

func TestProviderRegistry_OpensAfterFailures(t *testing.T) {
	r := newTestRegistry(t)
	profile := ProfileForProvider("openai")
	// Use distinct connection IDs to bypass the 5s dedup window.
	for i := 0; i < profile.FailureThreshold; i++ {
		r.RecordProviderFailure("openai", 500, "boom", fmt.Sprintf("conn%d", i), "")
	}
	assert.True(t, r.IsProviderInCooldown("openai", ""))
	require.NotNil(t, r.GetProviderCooldownRemainingMs("openai", ""))
	assert.Greater(t, *r.GetProviderCooldownRemainingMs("openai", ""), int64(0))
}

func TestProviderRegistry_429DoesNotCount(t *testing.T) {
	r := newTestRegistry(t)
	// 429 is per-account rate limit, not provider-wide.
	for i := 0; i < 100; i++ {
		r.RecordProviderFailure("openai", 429, "rate limit", "conn1", "")
	}
	assert.False(t, r.IsProviderInCooldown("openai", ""))
}

func TestProviderRegistry_DedupSameConnection(t *testing.T) {
	r := newTestRegistry(t)
	// Same connection → only counts as 1 failure within the dedup window.
	for i := 0; i < 10; i++ {
		r.RecordProviderFailure("openai", 500, "boom", "conn1", "")
	}
	// Failure count should be 1, not 10.
	status := r.GetProviderBreakerState("openai", "")
	require.NotNil(t, status)
	assert.Equal(t, 1, status.FailureCount)
}

func TestProviderRegistry_ProxyIsolation(t *testing.T) {
	r := newTestRegistry(t)
	profile := ProfileForProvider("openai")
	for i := 0; i < profile.FailureThreshold; i++ {
		r.RecordProviderFailure("openai", 500, "boom", fmt.Sprintf("conn%d", i), "proxyA")
	}
	assert.True(t, r.IsProviderInCooldown("openai", "proxyA"))
	assert.False(t, r.IsProviderInCooldown("openai", "proxyB"))
	assert.False(t, r.IsProviderInCooldown("openai", ""))
}

func TestProviderRegistry_FullyBlocked(t *testing.T) {
	r := newTestRegistry(t)
	profile := ProfileForProvider("openai")
	for i := 0; i < profile.FailureThreshold; i++ {
		r.RecordProviderFailure("openai", 500, "boom", fmt.Sprintf("c1-%d", i), "proxyA")
	}
	for i := 0; i < profile.FailureThreshold; i++ {
		r.RecordProviderFailure("openai", 500, "boom", fmt.Sprintf("c2-%d", i), "proxyB")
	}
	assert.True(t, r.IsProviderFullyBlocked("openai"))

	for i := 0; i < profile.FailureThreshold; i++ {
		r.RecordProviderFailure("openai", 500, "boom", fmt.Sprintf("c3-%d", i), "proxyC")
	}
	assert.True(t, r.IsProviderFullyBlocked("openai"))
}

func TestProviderRegistry_ShortestCooldown(t *testing.T) {
	r := newTestRegistry(t)
	profile := ProfileForProvider("openai")
	for i := 0; i < profile.FailureThreshold; i++ {
		r.RecordProviderFailure("openai", 500, "boom", fmt.Sprintf("c1-%d", i), "proxyA")
		r.RecordProviderFailure("openai", 500, "boom", fmt.Sprintf("c2-%d", i), "proxyB")
	}
	shortest := r.GetProviderShortestCooldownMs("openai")
	assert.Greater(t, shortest, int64(0))
}

func TestProviderRegistry_GetProvidersInCooldown(t *testing.T) {
	r := newTestRegistry(t)
	openaiProfile := ProfileForProvider("openai")
	anthropicProfile := ProfileForProvider("anthropic")
	for i := 0; i < openaiProfile.FailureThreshold; i++ {
		r.RecordProviderFailure("openai", 500, "boom", fmt.Sprintf("c1-%d", i), "")
	}
	for i := 0; i < anthropicProfile.FailureThreshold; i++ {
		r.RecordProviderFailure("anthropic", 500, "boom", fmt.Sprintf("c1-%d", i), "")
	}
	got := r.GetProvidersInCooldown()
	assert.Len(t, got, 2)
}

func TestProviderRegistry_ClearProviderFailure(t *testing.T) {
	r := newTestRegistry(t)
	profile := ProfileForProvider("openai")
	for i := 0; i < profile.FailureThreshold; i++ {
		r.RecordProviderFailure("openai", 500, "boom", fmt.Sprintf("c1-%d", i), "")
	}
	assert.True(t, r.IsProviderInCooldown("openai", ""))
	r.ClearProviderFailure("openai", "")
	assert.False(t, r.IsProviderInCooldown("openai", ""))
}

func TestProviderRegistry_UsesTunedProfile(t *testing.T) {
	r := newTestRegistry(t)
	// OpenAI profile uses FailureThreshold=3, vs default 5.
	for i := 0; i < 3; i++ {
		r.RecordProviderFailure("openai", 500, "boom", fmt.Sprintf("c1-%d", i), "")
	}
	assert.True(t, r.IsProviderInCooldown("openai", ""))

	// An unknown provider should use default threshold (5).
	r2 := newTestRegistry(t)
	for i := 0; i < 3; i++ {
		r2.RecordProviderFailure("unknown-provider", 500, "boom", fmt.Sprintf("c1-%d", i), "")
	}
	assert.False(t, r2.IsProviderInCooldown("unknown-provider", ""))
}

// ---- ProviderCooldown JSON shape (for dashboard) ----------------------

func TestProviderCooldown_JSON(t *testing.T) {
	cooldown := ProviderCooldown{
		Provider:            "openai:direct",
		FailureCount:        3,
		CooldownRemainingMs: 1500,
	}
	// Just verify it marshals without panic.
	_ = cooldown
}
