package resilience

import (
	"fmt"
	"regexp"
	"strings"
	"sync"
	"time"
)

// now is a package-level clock hook so tests can pin time without an interface.
var now = time.Now

// ---------------------------------------------------------------------------
// Constants — mirror open-sse/config/errorConfig.js + accountFallback.js.
// ---------------------------------------------------------------------------

// Default error rules checked top-to-bottom (text first, then status).
// Each rule: { Text?, Status?, CooldownMs?, Backoff? }.
// Backoff = true means use exponential cooldown via GetQuotaCooldown.
type errorRule struct {
	Text       string
	Status     int
	CooldownMs int
	Backoff    bool
}

const (
	defaultBase          = 2_000
	defaultMaxBackoff    = 5 * 60 * 1000
	defaultMaxBackoffLvl = 15
	transientCooldownMs  = 30_000

	cooldownLong  = 2 * 60 * 1000
	cooldownShort = 5_000

	providerFailureDedupMs   = 5_000
	providerFailureDedupCap  = 10_000
	providerFailureDedupEvict = 1_000
)

// errorRules is checked in declaration order. Mirrors ERROR_RULES in JS.
var errorRules = []errorRule{
	{Text: "no credentials", CooldownMs: cooldownLong},
	{Text: "request not allowed", CooldownMs: cooldownShort},
	{Text: "improperly formed request", CooldownMs: cooldownLong},
	{Text: "rate limit", Backoff: true},
	{Text: "too many requests", Backoff: true},
	{Text: "quota exceeded", Backoff: true},
	{Text: "capacity", Backoff: true},
	{Text: "overloaded", Backoff: true},

	{Status: 401, CooldownMs: cooldownLong},
	{Status: 402, CooldownMs: cooldownLong},
	{Status: 403, CooldownMs: cooldownLong},
	{Status: 404, CooldownMs: cooldownLong},
	{Status: 429, Backoff: true},
}

// ProviderFailureCodes — only provider-level errors (5xx + timeout) count
// toward the circuit breaker. 429 is per-account rate limiting.
var providerFailureCodes = map[int]bool{
	408: true, 500: true, 502: true, 503: true, 504: true,
}

// ---------------------------------------------------------------------------
// Profile-aware provider registry: shared circuit breaker per (provider, proxyHash)
// ---------------------------------------------------------------------------

// profileCache caches Profile lookups per provider ID.
var (
	profileCacheMu sync.RWMutex
	profileCache   = map[string]*Profile{}
)

// ProviderInstance bundles the breaker + accounting state for one
// (provider, proxyHash) bucket.
type providerInstance struct {
	profile *Profile
	breaker *Breaker
}

// ProviderRegistry holds per-(provider, proxyHash) breakers configured
// from resilience profiles. Mirrors the global Map in JS getCircuitBreaker.
type ProviderRegistry struct {
	mu        sync.Mutex
	instances map[string]*providerInstance
	dedup     map[string]time.Time
}

// NewProviderRegistry creates a new registry.
func NewProviderRegistry() *ProviderRegistry {
	return &ProviderRegistry{
		instances: make(map[string]*providerInstance),
		dedup:     make(map[string]time.Time),
	}
}

// providerKey returns the shared breaker key for (provider, proxyHash).
func providerKey(provider, proxyHash string) string {
	if proxyHash == "" {
		proxyHash = "direct"
	}
	return provider + ":" + proxyHash
}

// getOrCreate returns the instance for (provider, proxyHash), creating it on
// first access using the provider's tuned Profile.
func (r *ProviderRegistry) getOrCreate(provider, proxyHash string) *providerInstance {
	key := providerKey(provider, proxyHash)
	r.mu.Lock()
	defer r.mu.Unlock()
	if inst, ok := r.instances[key]; ok {
		return inst
	}
	profile := profileForProvider(provider)
	breaker := NewBreaker(key, Options{
		FailureThreshold: profile.FailureThreshold,
		SuccessThreshold: profile.SuccessThreshold,
		FailureWindowMs:  profile.FailureWindowMs,
		TimeoutMs:        profile.TimeoutMs,
		HalfOpenMaxCalls: profile.HalfOpenMaxCalls,
	})
	inst := &providerInstance{profile: profile, breaker: breaker}
	r.instances[key] = inst
	return inst
}

// profileForProvider returns a copy of the tuned profile (cached per provider).
func profileForProvider(providerID string) *Profile {
	profileCacheMu.RLock()
	if cached, ok := profileCache[providerID]; ok {
		profileCacheMu.RUnlock()
		return cloneProfile(cached)
	}
	profileCacheMu.RUnlock()

	p := ProfileForProvider(providerID)
	profileCacheMu.Lock()
	profileCache[providerID] = p
	profileCacheMu.Unlock()
	return cloneProfile(p)
}

func cloneProfile(p *Profile) *Profile {
	if p == nil {
		return DefaultProfile()
	}
	cp := *p
	return &cp
}

// IsProviderInCooldown reports whether the breaker for (provider, proxyHash)
// is currently OPEN.
func (r *ProviderRegistry) IsProviderInCooldown(provider, proxyHash string) bool {
	if provider == "" {
		return false
	}
	inst := r.getOrCreate(provider, proxyHash)
	return !inst.breaker.CanExecute()
}

// GetProviderCooldownRemainingMs returns the remaining ms before the breaker
// may transition to HALF_OPEN. nil when not blocked.
func (r *ProviderRegistry) GetProviderCooldownRemainingMs(provider, proxyHash string) *int64 {
	if provider == "" {
		return nil
	}
	inst := r.getOrCreate(provider, proxyHash)
	if inst.breaker.CanExecute() {
		return nil
	}
	remaining := inst.breaker.RetryAfterMs()
	if remaining <= 0 {
		return nil
	}
	return &remaining
}

// GetProviderBreakerState returns a copy of the breaker's status.
func (r *ProviderRegistry) GetProviderBreakerState(provider, proxyHash string) *Status {
	if provider == "" {
		return nil
	}
	inst := r.getOrCreate(provider, proxyHash)
	s := inst.breaker.Status()
	return &s
}

// RecordProviderFailure records a failure against the (provider, proxyHash)
// breaker, deduplicated per-connection within 5s.
func (r *ProviderRegistry) RecordProviderFailure(provider string, statusCode int, errorText, connectionID, proxyHash string) {
	if provider == "" {
		return
	}

	if connectionID != "" {
		dedupKey := fmt.Sprintf("%s:%s:%s", provider, proxyHashDefault(proxyHash), connectionID)
		nowTs := now()
		r.mu.Lock()
		if last, ok := r.dedup[dedupKey]; ok && nowTs.Sub(last) < providerFailureDedupMs*time.Millisecond {
			r.mu.Unlock()
			return
		}
		r.dedup[dedupKey] = nowTs
		if len(r.dedup) > providerFailureDedupCap {
			r.evictOldestLocked(nowTs)
		}
		r.mu.Unlock()
	}

	if statusCode != 0 && !IsProviderFailureCode(statusCode) {
		return
	}

	inst := r.getOrCreate(provider, proxyHash)
	if !inst.breaker.CanExecute() {
		return
	}
	inst.breaker.RecordFailure(fmt.Errorf("status=%d msg=%s", statusCode, truncate(errorText, 200)))
}

// evictOldestLocked drops the oldest ~10% of dedup entries. Caller holds r.mu.
func (r *ProviderRegistry) evictOldestLocked(nowTs time.Time) {
	type kv struct {
		k string
		t time.Time
	}
	entries := make([]kv, 0, len(r.dedup))
	for k, v := range r.dedup {
		entries = append(entries, kv{k, v})
	}
	// Partial sort: find the eviction threshold (the Nth oldest).
	// Simple approach: full sort for clarity (cap=10k, infrequent path).
	for i := 0; i < len(entries)-1; i++ {
		for j := i + 1; j < len(entries); j++ {
			if entries[j].t.Before(entries[i].t) {
				entries[i], entries[j] = entries[j], entries[i]
			}
		}
	}
	for i := 0; i < providerFailureDedupEvict && i < len(entries); i++ {
		delete(r.dedup, entries[i].k)
	}
	_ = nowTs
}

// ClearProviderFailure resets the breaker for (provider, proxyHash).
func (r *ProviderRegistry) ClearProviderFailure(provider, proxyHash string) {
	if provider == "" {
		return
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if inst, ok := r.instances[providerKey(provider, proxyHash)]; ok {
		inst.breaker.Reset()
	}
}

// ClearProviderFailureDedup clears the deduplication map (used by tests/resets).
func (r *ProviderRegistry) ClearProviderFailureDedup() {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.dedup = make(map[string]time.Time)
}

// IsProviderFullyBlocked returns true if every registered proxy bucket for
// provider is currently OPEN. Empty registry → false (no breaker registered).
func (r *ProviderRegistry) IsProviderFullyBlocked(provider string) bool {
	if provider == "" {
		return false
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	matched := 0
	for key, inst := range r.instances {
		if key != provider && !strings.HasPrefix(key, provider+":") {
			continue
		}
		matched++
		if inst.breaker.CanExecute() {
			return false
		}
	}
	return matched > 0
}

// GetProviderShortestCooldownMs returns the shortest remaining cooldown
// across all proxy buckets for provider. 0 when nothing is blocked.
func (r *ProviderRegistry) GetProviderShortestCooldownMs(provider string) int64 {
	if provider == "" {
		return 0
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	shortest := int64(0)
	for key, inst := range r.instances {
		if key != provider && !strings.HasPrefix(key, provider+":") {
			continue
		}
		if inst.breaker.CanExecute() {
			continue
		}
		remaining := inst.breaker.RetryAfterMs()
		if remaining > 0 && (shortest == 0 || remaining < shortest) {
			shortest = remaining
		}
	}
	return shortest
}

// GetProvidersInCooldown returns all registered buckets currently OPEN.
func (r *ProviderRegistry) GetProvidersInCooldown() []ProviderCooldown {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := make([]ProviderCooldown, 0)
	for key, inst := range r.instances {
		if inst.breaker.CanExecute() {
			continue
		}
		status := inst.breaker.Status()
		out = append(out, ProviderCooldown{
			Provider:          key,
			FailureCount:      status.FailureCount,
			CooldownRemainingMs: status.RetryAfterMs,
			LastFailureAt:     status.LastFailureAt,
		})
	}
	return out
}

// ProviderCooldown describes a blocked provider/proxy bucket.
type ProviderCooldown struct {
	Provider            string     `json:"provider"`
	FailureCount        int        `json:"failureCount"`
	CooldownRemainingMs int64      `json:"cooldownRemainingMs"`
	LastFailureAt       *time.Time `json:"lastFailureAt,omitempty"`
}

// IsProviderFailureCode reports whether status counts toward the provider
// failure threshold (5xx + timeout).
func IsProviderFailureCode(status int) bool {
	return providerFailureCodes[status]
}

// ---------------------------------------------------------------------------
// Account-level helpers — checkFallbackError / filter / cooldown / quota
// ---------------------------------------------------------------------------

// GetQuotaCooldown returns the exponential-backoff cooldown for backoffLevel.
// base=2s, doubling each level, capped at 5min. backoffLevel=1 → base.
func GetQuotaCooldown(backoffLevel int) int {
	level := backoffLevel - 1
	if level < 0 {
		level = 0
	}
	cooldown := float64(defaultBase) * pow2(level)
	if cooldown > float64(defaultMaxBackoff) {
		cooldown = float64(defaultMaxBackoff)
	}
	return int(cooldown)
}

func pow2(n int) float64 {
	v := 1.0
	for i := 0; i < n; i++ {
		v *= 2
	}
	return v
}

// FallbackDecision describes whether an error should trigger fallback and
// the cooldown to apply.
type FallbackDecision struct {
	ShouldFallback   bool
	CooldownMs       int
	NewBackoffLevel  *int
}

// CheckFallbackError checks status + errorText against the errorRules table
// top-to-bottom. Mirrors checkFallbackError in JS.
func CheckFallbackError(status int, errorText string, backoffLevel int) FallbackDecision {
	lower := strings.ToLower(errorText)
	for _, rule := range errorRules {
		if rule.Text != "" && lower != "" && strings.Contains(lower, rule.Text) {
			if rule.Backoff {
				return backoffDecision(backoffLevel)
			}
			return FallbackDecision{ShouldFallback: true, CooldownMs: rule.CooldownMs}
		}
		if rule.Status != 0 && rule.Status == status {
			if rule.Backoff {
				return backoffDecision(backoffLevel)
			}
			return FallbackDecision{ShouldFallback: true, CooldownMs: rule.CooldownMs}
		}
	}
	return FallbackDecision{ShouldFallback: true, CooldownMs: transientCooldownMs}
}

func backoffDecision(backoffLevel int) FallbackDecision {
	next := backoffLevel + 1
	if next > defaultMaxBackoffLvl {
		next = defaultMaxBackoffLvl
	}
	return FallbackDecision{
		ShouldFallback:  true,
		CooldownMs:      GetQuotaCooldown(next),
		NewBackoffLevel: &next,
	}
}

// IsAccountUnavailable reports whether the account's rateLimitedUntil is in
// the future.
func IsAccountUnavailable(rateLimitedUntil *time.Time) bool {
	if rateLimitedUntil == nil {
		return false
	}
	return rateLimitedUntil.After(now())
}

// GetUnavailableUntil returns a future timestamp cooldownMs ahead of now.
func GetUnavailableUntil(cooldownMs int) time.Time {
	return now().Add(time.Duration(cooldownMs) * time.Millisecond)
}

// FilterAvailableAccounts removes accounts in cooldown (and an optional
// excluded ID). Mirrors filterAvailableAccounts.
func FilterAvailableAccounts[T any](accounts []T, getID func(T) string, getRateLimitedUntil func(T) *time.Time, excludeID string) []T {
	nowTs := now()
	out := make([]T, 0, len(accounts))
	for _, a := range accounts {
		if id := getID(a); excludeID != "" && id == excludeID {
			continue
		}
		if until := getRateLimitedUntil(a); until != nil && until.After(nowTs) {
			continue
		}
		out = append(out, a)
	}
	return out
}

// AccountState is a minimal interface for account-shaped records used by
// ApplyErrorState / ResetAccountState. The full DB record satisfies it via
// field accessors (see helpers below).
type AccountState struct {
	RateLimitedUntil *time.Time
	BackoffLevel     int
	LastError        *LastError `json:"lastError,omitempty"`
	Status           string
}

// LastError describes the most recent failure on an account.
type LastError struct {
	Status    int       `json:"status"`
	Message   string    `json:"message"`
	Timestamp time.Time `json:"timestamp"`
}

// ResetAccountState returns a copy of the account with cooldown cleared and
// status reset to "active".
func ResetAccountState(account *AccountState) *AccountState {
	if account == nil {
		return nil
	}
	return &AccountState{
		BackoffLevel: 0,
		Status:       "active",
	}
}

// ApplyErrorState returns a copy of the account with the failure state applied.
func ApplyErrorState(account *AccountState, status int, errorText string) *AccountState {
	if account == nil {
		return nil
	}
	level := 0
	if account.BackoffLevel > 0 {
		level = account.BackoffLevel
	}
	dec := CheckFallbackError(status, errorText, level)
	out := &AccountState{
		BackoffLevel: level,
		LastError: &LastError{
			Status:    status,
			Message:   errorText,
			Timestamp: now(),
		},
		Status: "error",
	}
	if dec.NewBackoffLevel != nil {
		out.BackoffLevel = *dec.NewBackoffLevel
	}
	if dec.CooldownMs > 0 {
		t := GetUnavailableUntil(dec.CooldownMs)
		out.RateLimitedUntil = &t
	}
	return out
}

// GetEarliestRateLimitedUntil scans a slice for the earliest future
// rateLimitedUntil.
func GetEarliestRateLimitedUntil[T any](accounts []T, get func(T) *time.Time) *time.Time {
	var earliest time.Time
	nowTs := now()
	for _, a := range accounts {
		until := get(a)
		if until == nil {
			continue
		}
		if !until.After(nowTs) {
			continue
		}
		if earliest.IsZero() || until.Before(earliest) {
			earliest = *until
		}
	}
	if earliest.IsZero() {
		return nil
	}
	return &earliest
}

// FormatRetryAfter formats a future timestamp as "reset after Xh Ym Zs".
func FormatRetryAfter(rateLimitedUntil *time.Time) string {
	if rateLimitedUntil == nil {
		return ""
	}
	diff := rateLimitedUntil.Sub(now())
	if diff <= 0 {
		return "reset after 0s"
	}
	totalSec := int(diff / time.Second)
	if diff%time.Second != 0 {
		totalSec++
	}
	h := totalSec / 3600
	m := (totalSec % 3600) / 60
	s := totalSec % 60
	parts := make([]string, 0, 3)
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

// ---------------------------------------------------------------------------
// Quota exhaustion (Kimchi-specific + provider exhausted reason)
// ---------------------------------------------------------------------------

// kimchiQuotaPatterns are the patterns that indicate a Kimchi account has
// exhausted its monthly credits.
var kimchiQuotaPatterns = []*regexp.Regexp{
	regexp.MustCompile(`credits?.{0,20}exhausted`),
	regexp.MustCompile(`quota.{0,20}exhausted`),
	regexp.MustCompile(`no remaining credits`),
	regexp.MustCompile(`insufficient[ _-]?credits`),
	regexp.MustCompile(`payment.{0,10}required`),
	regexp.MustCompile(`has exhausted its credits`),
}

// IsKimchiQuotaExhausted reports whether errorText indicates the Kimchi
// account has exhausted its credits (monthly quota).
func IsKimchiQuotaExhausted(provider, errorText string) bool {
	if provider != "kimchi" || errorText == "" {
		return false
	}
	for _, p := range kimchiQuotaPatterns {
		if p.MatchString(errorText) {
			return true
		}
	}
	return false
}

// GetNextMonthReset returns the next month boundary at 00:00 UTC. If today
// is already the 1st at or after 00:00 UTC, returns today's boundary.
func GetNextMonthReset(at time.Time) time.Time {
	at = at.UTC()
	if at.Day() == 1 {
		return time.Date(at.Year(), at.Month(), 1, 0, 0, 0, 0, time.UTC)
	}
	return time.Date(at.Year(), at.Month()+1, 1, 0, 0, 0, 0, time.UTC)
}

// QuotaExhaustedUpdate is the partial update payload for deactivating a Kimchi
// account due to monthly quota exhaustion.
type QuotaExhaustedUpdate struct {
	IsActive         bool       `json:"isActive"`
	RateLimitedUntil *time.Time `json:"rateLimitedUntil"`
	TestStatus       string     `json:"testStatus"`
	LastErrorType    string     `json:"lastErrorType"`
	ErrorCode        int        `json:"errorCode"`
	QuotaExhaustedAt *time.Time `json:"quotaExhaustedAt"`
	QuotaResetsAt    *time.Time `json:"quotaResetsAt"`
}

// BuildKimchiQuotaExhaustedUpdate returns the update payload for deactivating
// a Kimchi account when it hits monthly quota exhaustion.
func BuildKimchiQuotaExhaustedUpdate(at time.Time) QuotaExhaustedUpdate {
	reset := GetNextMonthReset(at)
	return QuotaExhaustedUpdate{
		IsActive:         false,
		RateLimitedUntil: &reset,
		TestStatus:       "quota_exhausted",
		LastErrorType:    "quota_exhausted",
		ErrorCode:        402,
		QuotaExhaustedAt: &at,
		QuotaResetsAt:    &reset,
	}
}

// QuotaReactivatedUpdate reactivates a Kimchi account whose quota reset has passed.
type QuotaReactivatedUpdate struct {
	IsActive         bool    `json:"isActive"`
	RateLimitedUntil *string `json:"rateLimitedUntil"`
	TestStatus       string  `json:"testStatus"`
	QuotaExhaustedAt *string `json:"quotaExhaustedAt"`
	QuotaResetsAt    *string `json:"quotaResetsAt"`
}

// BuildKimchiQuotaReactivatedUpdate returns the update payload for reactivating
// a Kimchi account whose monthly reset has arrived.
func BuildKimchiQuotaReactivatedUpdate() QuotaReactivatedUpdate {
	nilStr := ""
	return QuotaReactivatedUpdate{
		IsActive:         true,
		RateLimitedUntil: &nilStr,
		TestStatus:       "active",
		QuotaExhaustedAt: &nilStr,
		QuotaResetsAt:    &nilStr,
	}
}

// providerExhaustedPattern matches provider-level quota exhaustion errors.
var providerExhaustedPattern = regexp.MustCompile(
	`credits?.{0,20}exhausted|quota.{0,20}exhausted|no remaining credits|insufficient.{0,20}credits|payment.{0,10}required|quota.{0,20}exceeded|rate.?limit.{0,20}reached`,
)

// IsProviderExhaustedReason reports whether an error message indicates
// provider-wide quota exhaustion (vs. a single-account rate limit).
func IsProviderExhaustedReason(reason any) bool {
	if reason == nil {
		return false
	}
	var text string
	switch v := reason.(type) {
	case string:
		text = v
	case error:
		text = v.Error()
	default:
		text = fmt.Sprintf("%v", reason)
	}
	if text == "" {
		return false
	}
	return providerExhaustedPattern.MatchString(text)
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

func proxyHashDefault(p string) string {
	if p == "" {
		return "direct"
	}
	return p
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "…"
}
