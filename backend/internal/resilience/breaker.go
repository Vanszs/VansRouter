package resilience

import (
	"fmt"
	"math"
	"sync"
	"time"
)

// State is the circuit breaker state.
type State string

// Circuit breaker states.
const (
	StateClosed   State = "CLOSED"
	StateDegraded State = "DEGRADED"
	StateOpen     State = "OPEN"
	StateHalfOpen State = "HALF_OPEN"
)

// FailureKind classifies provider failures for kind-specific thresholds.
type FailureKind string

// Failure kind constants.
const (
	FailureKindTransient     FailureKind = "transient"
	FailureKindRateLimit     FailureKind = "rate_limit"
	FailureKindQuotaExhausted FailureKind = "quota_exhausted"
)

// KindThreshold overrides the global failure threshold for a specific kind.
type KindThreshold struct {
	Threshold    int
	ImmediateOpen bool
}

// Options configures a circuit breaker.
type Options struct {
	Name                   string
	FailureThreshold       int
	SuccessThreshold       int
	FailureWindowMs        int
	TimeoutMs              int
	HalfOpenMaxCalls       int
	MaxBackoffMultiplier   int
	BackoffEscalationCount int
	DegradationRatio       float64
	KindThresholds         map[FailureKind]KindThreshold
	ClassifyError          func(error) FailureKind
	IsFailure              func(error) bool
}

// Breaker is an in-memory circuit breaker with CLOSED/DEGRADED/OPEN/HALF_OPEN
// states, cumulative or sliding-window failure counting, and exponential
// backoff while OPEN.
type Breaker struct {
	mu      sync.RWMutex
	name    string
	state   State

	failureCount  int
	successCount  int
	lastFailureAt time.Time
	lastStateAt   time.Time
	openedAt      time.Time

	failureThreshold       int
	successThreshold       int
	failureWindow          time.Duration
	resetTimeout           time.Duration
	halfOpenMaxCalls       int
	halfOpenRemaining      int
	maxBackoffMultiplier   int
	backoffEscalationCount int
	degradationThreshold   int
	openProbeCycles        int

	failureTimestamps []time.Time
	kindThresholds    map[FailureKind]KindThreshold
	classifyError     func(error) FailureKind
	isFailure         func(error) bool

	transitions []Transition
}

// Transition records a state change.
type Transition struct {
	From string    `json:"from"`
	To   string    `json:"to"`
	At   time.Time `json:"at"`
}

// Status is a snapshot of the breaker state.
type Status struct {
	Name          string        `json:"name"`
	State         State         `json:"state"`
	FailureCount  int           `json:"failureCount"`
	SuccessCount  int           `json:"successCount"`
	LastFailureAt *time.Time    `json:"lastFailureAt,omitempty"`
	RetryAfterMs  int64         `json:"retryAfterMs"`
	OpenedAt      *time.Time    `json:"openedAt,omitempty"`
	Transitions   []Transition  `json:"transitions"`
}

// NewBreaker creates a new circuit breaker from the given options.
// Defaults are applied for any zero option values.
func NewBreaker(name string, opts Options) *Breaker {
	b := &Breaker{
		name:                   name,
		state:                  StateClosed,
		lastStateAt:            time.Now(),
		failureThreshold:       defaultInt(opts.FailureThreshold, 5),
		successThreshold:       defaultInt(opts.SuccessThreshold, 1),
		resetTimeout:           time.Duration(defaultInt(opts.TimeoutMs, 30_000)) * time.Millisecond,
		failureWindow:          time.Duration(defaultInt(opts.FailureWindowMs, 0)) * time.Millisecond,
		halfOpenMaxCalls:       defaultInt(opts.HalfOpenMaxCalls, 1),
		maxBackoffMultiplier:   defaultInt(opts.MaxBackoffMultiplier, 16),
		backoffEscalationCount: defaultInt(opts.BackoffEscalationCount, 3),
		kindThresholds:         opts.KindThresholds,
		classifyError:          opts.ClassifyError,
		isFailure:              opts.IsFailure,
		transitions:            make([]Transition, 0, 20),
	}
	if opts.DegradationRatio > 0 {
		b.degradationThreshold = int(math.Floor(float64(b.failureThreshold) * opts.DegradationRatio))
	} else {
		b.degradationThreshold = int(math.Floor(float64(b.failureThreshold) * 0.6))
	}
	return b
}

// Name returns the breaker name.
func (b *Breaker) Name() string { return b.name }

// State returns the current state.
func (b *Breaker) State() State {
	b.mu.RLock()
	defer b.mu.RUnlock()
	return b.state
}

// CanExecute returns true when the breaker allows a request. It also handles
// automatic OPEN -> HALF_OPEN transitions when the reset timeout has elapsed.
func (b *Breaker) CanExecute() bool {
	b.mu.Lock()
	defer b.mu.Unlock()

	switch b.state {
	case StateClosed, StateDegraded:
		return true
	case StateOpen:
		if b.openedAt.IsZero() {
			b.transition(StateHalfOpen)
			return true
		}
		elapsed := time.Since(b.openedAt)
		if elapsed >= b.effectiveTimeout() {
			b.transition(StateHalfOpen)
			if b.halfOpenRemaining > 0 {
				b.halfOpenRemaining--
				return true
			}
			return false
		}
		return false
	case StateHalfOpen:
		if b.halfOpenRemaining > 0 {
			b.halfOpenRemaining--
			return true
		}
		return false
	default:
		return true
	}
}

// RecordSuccess records a successful call.
func (b *Breaker) RecordSuccess() {
	b.mu.Lock()
	defer b.mu.Unlock()

	b.successCount++
	switch b.state {
	case StateHalfOpen:
		// Default JS behavior uses a single success to close the circuit.
		if b.successCount >= b.successThreshold {
			b.transition(StateClosed)
		}
	case StateDegraded:
		if b.successCount >= b.failureThreshold {
			b.transition(StateClosed)
		}
	}
}

// RecordFailure records a failed call and may trip the breaker.
func (b *Breaker) RecordFailure(err error) {
	b.mu.Lock()
	defer b.mu.Unlock()

	if b.isFailure != nil && !b.isFailure(err) {
		return
	}

	b.failureCount++
	b.lastFailureAt = time.Now()

	if b.failureWindow > 0 {
		b.failureTimestamps = append(b.failureTimestamps, b.lastFailureAt)
		b.pruneFailureTimestamps()
	}

	switch b.state {
	case StateHalfOpen:
		b.openProbeCycles++
		b.transition(StateOpen)
		return
	case StateOpen:
		return
	}

	kind := b.classify(err)
	if threshold, ok := b.kindThresholds[kind]; ok && threshold.ImmediateOpen {
		b.transition(StateOpen)
		return
	}

	effectiveThreshold := b.failureThreshold
	if threshold, ok := b.kindThresholds[kind]; ok && threshold.Threshold > 0 {
		effectiveThreshold = threshold.Threshold
	}

	failureCount := b.countFailuresInWindow()
	if failureCount >= effectiveThreshold {
		b.transition(StateOpen)
	} else if failureCount >= b.degradationThreshold {
		if b.state == StateClosed {
			b.transition(StateDegraded)
		}
	}
}

// RetryAfterMs returns the remaining time in milliseconds before the breaker
// may transition to HALF_OPEN. Returns 0 when not OPEN.
func (b *Breaker) RetryAfterMs() int64 {
	b.mu.RLock()
	defer b.mu.RUnlock()

	if b.state != StateOpen || b.openedAt.IsZero() {
		return 0
	}
	remaining := b.effectiveTimeout() - time.Since(b.openedAt)
	if remaining < 0 {
		return 0
	}
	return int64(remaining / time.Millisecond)
}

// Reset forces the breaker to CLOSED.
func (b *Breaker) Reset() {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.transition(StateClosed)
}

// Status returns a snapshot of the breaker state.
func (b *Breaker) Status() Status {
	b.mu.RLock()
	defer b.mu.RUnlock()

	var lastFailure *time.Time
	if !b.lastFailureAt.IsZero() {
		t := b.lastFailureAt
		lastFailure = &t
	}
	var openedAt *time.Time
	if !b.openedAt.IsZero() {
		t := b.openedAt
		openedAt = &t
	}

	transitions := make([]Transition, len(b.transitions))
	copy(transitions, b.transitions)

	return Status{
		Name:          b.name,
		State:         b.state,
		FailureCount:  b.failureCount,
		SuccessCount:  b.successCount,
		LastFailureAt: lastFailure,
		RetryAfterMs:  b.retryAfterMsLocked(),
		OpenedAt:      openedAt,
		Transitions:   transitions,
	}
}

func (b *Breaker) retryAfterMsLocked() int64 {
	if b.state != StateOpen || b.openedAt.IsZero() {
		return 0
	}
	remaining := b.effectiveTimeout() - time.Since(b.openedAt)
	if remaining < 0 {
		return 0
	}
	return int64(remaining / time.Millisecond)
}

func (b *Breaker) effectiveTimeout() time.Duration {
	multiplier := math.Pow(2, math.Floor(float64(b.openProbeCycles)/float64(b.backoffEscalationCount)))
	if multiplier > float64(b.maxBackoffMultiplier) {
		multiplier = float64(b.maxBackoffMultiplier)
	}
	return time.Duration(float64(b.resetTimeout) * multiplier)
}

func (b *Breaker) transition(newState State) {
	old := b.state
	if old == newState {
		return
	}
	b.state = newState
	b.lastStateAt = time.Now()
	b.transitions = append(b.transitions, Transition{
		From: string(old),
		To:   string(newState),
		At:   b.lastStateAt,
	})
	if len(b.transitions) > 20 {
		b.transitions = b.transitions[1:]
	}

	switch newState {
	case StateOpen:
		b.openedAt = b.lastStateAt
		b.halfOpenRemaining = 0
	case StateHalfOpen:
		b.halfOpenRemaining = b.halfOpenMaxCalls
	case StateClosed:
		b.failureCount = 0
		b.successCount = 0
		b.openProbeCycles = 0
		b.openedAt = time.Time{}
		b.failureTimestamps = b.failureTimestamps[:0]
	}
}

func (b *Breaker) pruneFailureTimestamps() {
	if b.failureWindow <= 0 {
		return
	}
	cutoff := time.Now().Add(-b.failureWindow)
	idx := 0
	for i, ts := range b.failureTimestamps {
		if ts.After(cutoff) || ts.Equal(cutoff) {
			idx = i
			break
		}
		idx = i + 1
	}
	b.failureTimestamps = b.failureTimestamps[idx:]
}

func (b *Breaker) countFailuresInWindow() int {
	if b.failureWindow <= 0 {
		return b.failureCount
	}
	b.pruneFailureTimestamps()
	return len(b.failureTimestamps)
}

func (b *Breaker) classify(err error) FailureKind {
	if b.classifyError != nil {
		return b.classifyError(err)
	}
	return FailureKindTransient
}

func defaultInt(v, def int) int {
	if v == 0 {
		return def
	}
	return v
}

// OpenError is returned when a call is rejected because the breaker is OPEN.
type OpenError struct {
	BreakerName  string
	RetryAfterMs int64
}

func (e *OpenError) Error() string {
	return fmt.Sprintf("circuit breaker %q is OPEN — retry after %ds", e.BreakerName, (e.RetryAfterMs+999)/1000)
}
