package accountfallback

import (
	"fmt"
	"math"
	"regexp"
	"strings"
	"time"
)

// Backoff config (mirrors Node.js errorConfig.js)
var (
	BackoffBase          = 2000                    // 2s
	BackoffMax           = 5 * 60 * 1000           // 5min
	BackoffMaxLevel      = 15
	TransientCooldownMs  = 30 * 1000               // 30s
	MaxRateLimitCooldown = 30 * 60 * 1000          // 30min
	CooldownLong         = 2 * 60 * 1000           // 2min
	CooldownShort        = 5 * 1000                // 5s
)

// ErrorRule defines a single error classification rule.
type ErrorRule struct {
	Text       string // case-insensitive substring match (empty = skip)
	Status     int    // HTTP status match (0 = skip)
	CooldownMs int    // fixed cooldown (0 if using backoff)
	Backoff    bool   // use exponential backoff
}

// ErrorRules checked top-to-bottom: text rules first, then status rules.
var ErrorRules = []ErrorRule{
	{Text: "no credentials", CooldownMs: CooldownLong},
	{Text: "request not allowed", CooldownMs: CooldownShort},
	{Text: "improperly formed request", CooldownMs: CooldownLong},
	{Text: "rate limit", Backoff: true},
	{Text: "too many requests", Backoff: true},
	{Text: "quota exceeded", Backoff: true},
	{Text: "capacity", Backoff: true},
	{Text: "overloaded", Backoff: true},
	{Status: 401, CooldownMs: CooldownLong},
	{Status: 402, CooldownMs: CooldownLong},
	{Status: 403, CooldownMs: CooldownLong},
	{Status: 404, CooldownMs: CooldownLong},
	{Status: 429, Backoff: true},
}

// FallbackResult holds the decision to switch accounts.
type FallbackResult struct {
	ShouldFallback  bool
	CooldownMs      int
	NewBackoffLevel int
}

// GetQuotaCooldown calculates exponential backoff cooldown for rate limits.
// Level 1: 2s, Level 2: 4s, Level 3: 8s... → max 5min
func GetQuotaCooldown(backoffLevel int) int {
	level := backoffLevel - 1
	if level < 0 {
		level = 0
	}
	cooldown := float64(BackoffBase) * math.Pow(2, float64(level))
	result := int(cooldown)
	if result > BackoffMax {
		result = BackoffMax
	}
	return result
}

// CheckFallbackError determines if an error should trigger account fallback.
// Config-driven: matches ErrorRules top-to-bottom (text rules first, then status).
func CheckFallbackError(status int, errorText string, backoffLevel int) FallbackResult {
	lowerError := strings.ToLower(errorText)

	for _, rule := range ErrorRules {
		// Text-based rule
		if rule.Text != "" && lowerError != "" && strings.Contains(lowerError, rule.Text) {
			if rule.Backoff {
				newLevel := backoffLevel + 1
				if newLevel > BackoffMaxLevel {
					newLevel = BackoffMaxLevel
				}
				return FallbackResult{
					ShouldFallback:  true,
					CooldownMs:      GetQuotaCooldown(newLevel),
					NewBackoffLevel: newLevel,
				}
			}
			return FallbackResult{
				ShouldFallback:  true,
				CooldownMs:      rule.CooldownMs,
				NewBackoffLevel: backoffLevel,
			}
		}

		// Status-based rule
		if rule.Status != 0 && rule.Status == status {
			if rule.Backoff {
				newLevel := backoffLevel + 1
				if newLevel > BackoffMaxLevel {
					newLevel = BackoffMaxLevel
				}
				return FallbackResult{
					ShouldFallback:  true,
					CooldownMs:      GetQuotaCooldown(newLevel),
					NewBackoffLevel: newLevel,
				}
			}
			return FallbackResult{
				ShouldFallback:  true,
				CooldownMs:      rule.CooldownMs,
				NewBackoffLevel: backoffLevel,
			}
		}
	}

	// Default: transient cooldown for unmatched error
	return FallbackResult{
		ShouldFallback:  true,
		CooldownMs:      TransientCooldownMs,
		NewBackoffLevel: backoffLevel,
	}
}

// IsAccountUnavailable checks if an account is in cooldown.
func IsAccountUnavailable(unavailableUntil string) bool {
	if unavailableUntil == "" {
		return false
	}
	t, err := time.Parse(time.RFC3339, unavailableUntil)
	if err != nil {
		return false
	}
	return t.After(time.Now())
}

// GetUnavailableUntil calculates the unavailable-until timestamp.
func GetUnavailableUntil(cooldownMs int) string {
	return time.Now().Add(time.Duration(cooldownMs) * time.Millisecond).UTC().Format(time.RFC3339)
}

// Account holds account info for rate-limit checking.
type Account struct {
	RateLimitedUntil string
}

// GetEarliestRateLimitedUntil returns the earliest active rate limit timestamp.
func GetEarliestRateLimitedUntil(accounts []Account) string {
	var earliest int64 = 0
	now := time.Now().UnixMilli()

	for _, acc := range accounts {
		if acc.RateLimitedUntil == "" {
			continue
		}
		t, err := time.Parse(time.RFC3339, acc.RateLimitedUntil)
		if err != nil {
			continue
		}
		ms := t.UnixMilli()
		if ms <= now {
			continue
		}
		if earliest == 0 || ms < earliest {
			earliest = ms
		}
	}

	if earliest == 0 {
		return ""
	}
	return time.UnixMilli(earliest).UTC().Format(time.RFC3339)
}

// FormatRetryAfter formats a rate limit timestamp to "reset after Xm Ys".
func FormatRetryAfter(rateLimitedUntil string) string {
	if rateLimitedUntil == "" {
		return ""
	}
	t, err := time.Parse(time.RFC3339, rateLimitedUntil)
	if err != nil {
		return ""
	}
	diffMs := t.UnixMilli() - time.Now().UnixMilli()
	if diffMs <= 0 {
		return "reset after 0s"
	}
	totalSec := int(math.Ceil(float64(diffMs) / 1000))
	h := totalSec / 3600
	m := (totalSec % 3600) / 60
	s := totalSec % 60

	var parts []string
	if h > 0 {
		parts = append(parts, fmt.Sprintf("%dh", h))
	}
	if m > 0 {
		parts = append(parts, fmt.Sprintf("%dm", m))
	}
	if s > 0 || len(parts) == 0 {
		parts = append(parts, fmt.Sprintf("%ds", s))
	}
	return "reset after " + strings.Join(parts, " ")
}

// Kimchi quota exhaustion patterns.
var kimchiPatterns = []*regexp.Regexp{
	regexp.MustCompile(`(?i)credits?.{0,20}exhausted`),
	regexp.MustCompile(`(?i)quota.{0,20}exhausted`),
	regexp.MustCompile(`(?i)no remaining credits`),
	regexp.MustCompile(`(?i)insufficient[ _-]?credits`),
	regexp.MustCompile(`(?i)payment.{0,10}required`),
	regexp.MustCompile(`(?i)has exhausted its credits`),
}

// IsKimchiQuotaExhausted detects Kimchi credit exhaustion.
func IsKimchiQuotaExhausted(provider, errorText string) bool {
	if errorText == "" || provider != "kimchi" {
		return false
	}
	for _, p := range kimchiPatterns {
		if p.MatchString(errorText) {
			return true
		}
	}
	return false
}

// GetNextMonthReset returns the 1st of next month at 00:00 UTC.
// If today is the 1st, returns today's 00:00 UTC.
func GetNextMonthReset(now time.Time) time.Time {
	if now.UTC().Day() == 1 {
		return time.Date(now.UTC().Year(), now.UTC().Month(), 1, 0, 0, 0, 0, time.UTC)
	}
	return time.Date(now.UTC().Year(), now.UTC().Month()+1, 1, 0, 0, 0, 0, time.UTC)
}

// KimchiQuotaExhaustedUpdate holds the deactivation payload.
type KimchiQuotaExhaustedUpdate struct {
	IsActive          bool   `json:"isActive"`
	RateLimitedUntil  string `json:"rateLimitedUntil"`
	TestStatus        string `json:"testStatus"`
	LastErrorType     string `json:"lastErrorType"`
	ErrorCode         int    `json:"errorCode"`
	QuotaExhaustedAt  string `json:"quotaExhaustedAt"`
	QuotaResetsAt     string `json:"quotaResetsAt"`
}

// BuildKimchiQuotaExhaustedUpdate deactivates a Kimchi account.
func BuildKimchiQuotaExhaustedUpdate(now time.Time) KimchiQuotaExhaustedUpdate {
	reset := GetNextMonthReset(now)
	return KimchiQuotaExhaustedUpdate{
		IsActive:         false,
		RateLimitedUntil: reset.UTC().Format(time.RFC3339),
		TestStatus:       "quota_exhausted",
		LastErrorType:    "quota_exhausted",
		ErrorCode:        402,
		QuotaExhaustedAt: now.UTC().Format(time.RFC3339),
		QuotaResetsAt:    reset.UTC().Format(time.RFC3339),
	}
}

// KimchiQuotaReactivatedUpdate holds the reactivation payload.
type KimchiQuotaReactivatedUpdate struct {
	IsActive         bool   `json:"isActive"`
	RateLimitedUntil *string `json:"rateLimitedUntil"`
	TestStatus       string `json:"testStatus"`
}

// BuildKimchiQuotaReactivatedUpdate reactivates a quota-exhausted account.
func BuildKimchiQuotaReactivatedUpdate() KimchiQuotaReactivatedUpdate {
	return KimchiQuotaReactivatedUpdate{
		IsActive:         true,
		RateLimitedUntil: nil,
		TestStatus:       "active",
	}
}

// Classify429Result holds 429 classification.
type Classify429Result struct {
	Type        string // "quota" or "burst"
	CooldownMs  int
}

// Classify429 attempts to distinguish quota vs burst rate limits.
func Classify429(errorText string) Classify429Result {
	lower := strings.ToLower(errorText)
	if strings.Contains(lower, "quota") || strings.Contains(lower, "exceeded your current quota") {
		return Classify429Result{Type: "quota", CooldownMs: CooldownLong}
	}
	return Classify429Result{Type: "burst", CooldownMs: TransientCooldownMs}
}
