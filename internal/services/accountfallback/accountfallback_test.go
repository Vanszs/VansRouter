package accountfallback

import (
	"testing"
	"time"
)

func TestGetQuotaCooldown(t *testing.T) {
	tests := []struct {
		level int
		want  int
	}{
		{0, 2000},
		{1, 2000},
		{2, 4000},
		{3, 8000},
		{15, 300000}, // max
		{20, 300000}, // capped at max
	}
	for _, tt := range tests {
		got := GetQuotaCooldown(tt.level)
		if got != tt.want {
			t.Errorf("level %d: expected %d, got %d", tt.level, tt.want, got)
		}
	}
}

func TestCheckFallbackError_TextMatch(t *testing.T) {
	result := CheckFallbackError(0, "rate limit exceeded", 0)
	if !result.ShouldFallback {
		t.Error("should fallback")
	}
	if result.NewBackoffLevel != 1 {
		t.Errorf("expected backoff level 1, got %d", result.NewBackoffLevel)
	}
}

func TestCheckFallbackError_TextMatchNoBackoff(t *testing.T) {
	result := CheckFallbackError(0, "no credentials available", 0)
	if !result.ShouldFallback {
		t.Error("should fallback")
	}
	if result.CooldownMs != CooldownLong {
		t.Errorf("expected long cooldown, got %d", result.CooldownMs)
	}
}

func TestCheckFallbackError_StatusMatch(t *testing.T) {
	result := CheckFallbackError(401, "some error", 0)
	if !result.ShouldFallback {
		t.Error("should fallback")
	}
	if result.CooldownMs != CooldownLong {
		t.Errorf("expected long cooldown, got %d", result.CooldownMs)
	}
}

func TestCheckFallbackError_Status429Backoff(t *testing.T) {
	result := CheckFallbackError(429, "too many requests", 0)
	if !result.ShouldFallback {
		t.Error("should fallback")
	}
	if result.NewBackoffLevel != 1 {
		t.Errorf("expected level 1, got %d", result.NewBackoffLevel)
	}
}

func TestCheckFallbackError_Unmatched(t *testing.T) {
	result := CheckFallbackError(500, "internal server error", 0)
	if !result.ShouldFallback {
		t.Error("should fallback for unmatched")
	}
	if result.CooldownMs != TransientCooldownMs {
		t.Errorf("expected transient cooldown, got %d", result.CooldownMs)
	}
}

func TestCheckFallbackError_BackoffProgression(t *testing.T) {
	r1 := CheckFallbackError(429, "rate limit", 0)
	r2 := CheckFallbackError(429, "rate limit", r1.NewBackoffLevel)
	r3 := CheckFallbackError(429, "rate limit", r2.NewBackoffLevel)
	if r3.NewBackoffLevel <= r2.NewBackoffLevel {
		t.Error("backoff should increase")
	}
}

func TestIsAccountUnavailable_Empty(t *testing.T) {
	if IsAccountUnavailable("") {
		t.Error("empty should not be unavailable")
	}
}

func TestIsAccountUnavailable_Future(t *testing.T) {
	future := time.Now().Add(1 * time.Hour).UTC().Format(time.RFC3339)
	if !IsAccountUnavailable(future) {
		t.Error("future timestamp should be unavailable")
	}
}

func TestIsAccountUnavailable_Past(t *testing.T) {
	past := time.Now().Add(-1 * time.Hour).UTC().Format(time.RFC3339)
	if IsAccountUnavailable(past) {
		t.Error("past timestamp should be available")
	}
}

func TestGetUnavailableUntil(t *testing.T) {
	result := GetUnavailableUntil(5000)
	if !IsAccountUnavailable(result) {
		t.Error("5s cooldown should be unavailable")
	}
}

func TestGetEarliestRateLimitedUntil_Empty(t *testing.T) {
	result := GetEarliestRateLimitedUntil([]Account{})
	if result != "" {
		t.Error("empty accounts should return empty string")
	}
}

func TestGetEarliestRateLimitedUntil_AllExpired(t *testing.T) {
	past := time.Now().Add(-1 * time.Hour).UTC().Format(time.RFC3339)
	accounts := []Account{{RateLimitedUntil: past}}
	result := GetEarliestRateLimitedUntil(accounts)
	if result != "" {
		t.Error("expired limits should return empty")
	}
}

func TestGetEarliestRateLimitedUntil_Earliest(t *testing.T) {
	soon := time.Now().Add(1 * time.Minute).UTC().Format(time.RFC3339)
	later := time.Now().Add(1 * time.Hour).UTC().Format(time.RFC3339)
	accounts := []Account{{RateLimitedUntil: later}, {RateLimitedUntil: soon}}
	result := GetEarliestRateLimitedUntil(accounts)
	if result == "" {
		t.Fatal("should return non-empty")
	}
}

func TestFormatRetryAfter_Empty(t *testing.T) {
	if FormatRetryAfter("") != "" {
		t.Error("empty should return empty")
	}
}

func TestFormatRetryAfter_Past(t *testing.T) {
	past := time.Now().Add(-1 * time.Hour).UTC().Format(time.RFC3339)
	result := FormatRetryAfter(past)
	if result != "reset after 0s" {
		t.Errorf("expected 'reset after 0s', got: %s", result)
	}
}

func TestFormatRetryAfter_Future(t *testing.T) {
	future := time.Now().Add(2 * time.Minute).Add(30 * time.Second).UTC().Format(time.RFC3339)
	result := FormatRetryAfter(future)
	if result == "" {
		t.Error("should not be empty")
	}
	if result[:11] != "reset after" {
		t.Errorf("should start with 'reset after', got: %s", result)
	}
}

func TestIsKimchiQuotaExhausted_NotKimchi(t *testing.T) {
	if IsKimchiQuotaExhausted("openai", "credits exhausted") {
		t.Error("should not trigger for non-kimchi")
	}
}

func TestIsKimchiQuotaExhausted_KimchiMatch(t *testing.T) {
	if !IsKimchiQuotaExhausted("kimchi", "has exhausted its credits") {
		t.Error("should match 'exhausted its credits'")
	}
}

func TestIsKimchiQuotaExhausted_KimchiNoMatch(t *testing.T) {
	if IsKimchiQuotaExhausted("kimchi", "some other error") {
		t.Error("should not match unrelated error")
	}
}

func TestIsKimchiQuotaExhausted_PaymentRequired(t *testing.T) {
	if !IsKimchiQuotaExhausted("kimchi", "payment required") {
		t.Error("should match 'payment required'")
	}
}

func TestGetNextMonthReset_FirstOfMonth(t *testing.T) {
	now := time.Date(2026, 7, 1, 10, 30, 0, 0, time.UTC)
	reset := GetNextMonthReset(now)
	if reset.Day() != 1 {
		t.Errorf("expected day 1, got %d", reset.Day())
	}
	if reset.Month() != time.July {
		t.Errorf("expected July, got %s", reset.Month())
	}
}

func TestGetNextMonthReset_MidMonth(t *testing.T) {
	now := time.Date(2026, 7, 15, 10, 30, 0, 0, time.UTC)
	reset := GetNextMonthReset(now)
	if reset.Day() != 1 {
		t.Errorf("expected day 1, got %d", reset.Day())
	}
	if reset.Month() != time.August {
		t.Errorf("expected August, got %s", reset.Month())
	}
}

func TestBuildKimchiQuotaExhaustedUpdate(t *testing.T) {
	now := time.Date(2026, 7, 15, 10, 30, 0, 0, time.UTC)
	update := BuildKimchiQuotaExhaustedUpdate(now)
	if update.IsActive {
		t.Error("should be inactive")
	}
	if update.TestStatus != "quota_exhausted" {
		t.Errorf("expected 'quota_exhausted', got: %s", update.TestStatus)
	}
	if update.ErrorCode != 402 {
		t.Errorf("expected 402, got: %d", update.ErrorCode)
	}
}

func TestBuildKimchiQuotaReactivatedUpdate(t *testing.T) {
	update := BuildKimchiQuotaReactivatedUpdate()
	if !update.IsActive {
		t.Error("should be active")
	}
	if update.TestStatus != "active" {
		t.Errorf("expected 'active', got: %s", update.TestStatus)
	}
}

func TestClassify429_Quota(t *testing.T) {
	result := Classify429("exceeded your current quota")
	if result.Type != "quota" {
		t.Errorf("expected 'quota', got: %s", result.Type)
	}
}

func TestClassify429_Burst(t *testing.T) {
	result := Classify429("too many requests")
	if result.Type != "burst" {
		t.Errorf("expected 'burst', got: %s", result.Type)
	}
}
