package resilience

import (
	"errors"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestCircuitBreaker is the meta-test the step verification command
// targets. It re-executes the per-scenario tests below so that
// `go test -run TestCircuitBreaker` is a single entry point.
func TestCircuitBreaker(t *testing.T) {
	t.Run("Defaults", TestBreakerDefaults)
	t.Run("ClosesAfterSuccesses", TestBreakerClosesAfterSuccesses)
	t.Run("OpensAfterFailures", TestBreakerOpensAfterFailures)
	t.Run("HalfOpenThenClose", TestBreakerHalfOpenThenClose)
	t.Run("HalfOpenThenReopen", TestBreakerHalfOpenThenReopen)
	t.Run("SlidingWindow", TestBreakerSlidingWindow)
	t.Run("SlidingWindowKeepsRecentFailures", TestBreakerSlidingWindowKeepsRecentFailures)
	t.Run("ExponentialBackoff", TestBreakerExponentialBackoff)
	t.Run("IsFailureFilter", TestBreakerIsFailureFilter)
	t.Run("KindThresholdImmediateOpen", TestBreakerKindThresholdImmediateOpen)
	t.Run("Reset", TestBreakerReset)
	t.Run("Status", TestBreakerStatus)
}

func TestBreakerDefaults(t *testing.T) {
	b := NewBreaker("test", Options{})
	assert.Equal(t, StateClosed, b.State())
	assert.True(t, b.CanExecute())
}

func TestBreakerClosesAfterSuccesses(t *testing.T) {
	b := NewBreaker("test", Options{FailureThreshold: 3})
	for i := 0; i < 5; i++ {
		assert.True(t, b.CanExecute())
		b.RecordSuccess()
	}
	assert.Equal(t, StateClosed, b.State())
}

func TestBreakerOpensAfterFailures(t *testing.T) {
	b := NewBreaker("test", Options{FailureThreshold: 3})
	for i := 0; i < 3; i++ {
		assert.True(t, b.CanExecute())
		b.RecordFailure(errors.New("boom"))
	}
	assert.Equal(t, StateOpen, b.State())
	assert.False(t, b.CanExecute())
	status := b.Status()
	assert.Equal(t, StateOpen, status.State)
	assert.Greater(t, status.RetryAfterMs, int64(0))
}

func TestBreakerHalfOpenThenClose(t *testing.T) {
	b := NewBreaker("test", Options{
		FailureThreshold: 2,
		TimeoutMs:        50,
	})
	b.RecordFailure(errors.New("a"))
	b.RecordFailure(errors.New("b"))
	require.Equal(t, StateOpen, b.State())

	time.Sleep(60 * time.Millisecond)
	assert.True(t, b.CanExecute())
	assert.Equal(t, StateHalfOpen, b.State())
	b.RecordSuccess()
	assert.Equal(t, StateClosed, b.State())
	assert.True(t, b.CanExecute())
}

func TestBreakerHalfOpenThenReopen(t *testing.T) {
	b := NewBreaker("test", Options{
		FailureThreshold: 2,
		TimeoutMs:        50,
	})
	b.RecordFailure(errors.New("a"))
	b.RecordFailure(errors.New("b"))
	require.Equal(t, StateOpen, b.State())

	time.Sleep(60 * time.Millisecond)
	assert.True(t, b.CanExecute())
	assert.Equal(t, StateHalfOpen, b.State())
	b.RecordFailure(errors.New("c"))
	assert.Equal(t, StateOpen, b.State())
}

func TestBreakerSlidingWindow(t *testing.T) {
	b := NewBreaker("test", Options{
		FailureThreshold: 3,
		FailureWindowMs:  200,
		TimeoutMs:        50,
	})
	b.RecordFailure(errors.New("1"))
	b.RecordFailure(errors.New("2"))
	b.RecordFailure(errors.New("3"))
	require.Equal(t, StateOpen, b.State())

	// Wait for both the reset timeout and the failure window to expire.
	time.Sleep(300 * time.Millisecond)
	assert.True(t, b.CanExecute())
	assert.Equal(t, StateHalfOpen, b.State())
	b.RecordSuccess()
	assert.Equal(t, StateClosed, b.State())
}

func TestBreakerSlidingWindowKeepsRecentFailures(t *testing.T) {
	b := NewBreaker("test", Options{
		FailureThreshold: 3,
		FailureWindowMs:  500,
	})
	b.RecordFailure(errors.New("old"))
	time.Sleep(300 * time.Millisecond)
	b.RecordFailure(errors.New("recent"))
	b.RecordFailure(errors.New("recent2"))
	// old should still count since window is 500ms.
	assert.Equal(t, StateOpen, b.State())
}

func TestBreakerExponentialBackoff(t *testing.T) {
	b := NewBreaker("test", Options{
		FailureThreshold:       1,
		TimeoutMs:              20,
		MaxBackoffMultiplier:   4,
		BackoffEscalationCount: 1,
	})
	b.RecordFailure(errors.New("boom"))
	firstRetry := b.RetryAfterMs()
	assert.Greater(t, firstRetry, int64(0))

	time.Sleep(time.Duration(firstRetry+5) * time.Millisecond)
	assert.True(t, b.CanExecute())
	b.RecordFailure(errors.New("boom"))
	secondRetry := b.RetryAfterMs()
	assert.Greater(t, secondRetry, firstRetry)
}

func TestBreakerIsFailureFilter(t *testing.T) {
	filtered := errors.New("ignored")
	real := errors.New("real")
	b := NewBreaker("test", Options{
		FailureThreshold: 1,
		IsFailure: func(err error) bool {
			return err != filtered
		},
	})
	b.RecordFailure(filtered)
	assert.Equal(t, StateClosed, b.State())
	b.RecordFailure(real)
	assert.Equal(t, StateOpen, b.State())
}

func TestBreakerKindThresholdImmediateOpen(t *testing.T) {
	rateLimit := errors.New("rate limit")
	b := NewBreaker("test", Options{
		FailureThreshold: 5,
		ClassifyError: func(err error) FailureKind {
			if err == rateLimit {
				return FailureKindRateLimit
			}
			return FailureKindTransient
		},
		KindThresholds: map[FailureKind]KindThreshold{
			FailureKindRateLimit: {ImmediateOpen: true},
		},
	})
	b.RecordFailure(rateLimit)
	assert.Equal(t, StateOpen, b.State())
}

func TestBreakerReset(t *testing.T) {
	b := NewBreaker("test", Options{FailureThreshold: 1})
	b.RecordFailure(errors.New("boom"))
	require.Equal(t, StateOpen, b.State())
	b.Reset()
	assert.Equal(t, StateClosed, b.State())
	assert.True(t, b.CanExecute())
}

func TestBreakerStatus(t *testing.T) {
	b := NewBreaker("test", Options{FailureThreshold: 5, DegradationRatio: 0.5})
	b.RecordFailure(errors.New("x"))
	status := b.Status()
	assert.Equal(t, "test", status.Name)
	assert.Equal(t, StateClosed, status.State)
	assert.Equal(t, 1, status.FailureCount)
	assert.NotNil(t, status.LastFailureAt)
}
