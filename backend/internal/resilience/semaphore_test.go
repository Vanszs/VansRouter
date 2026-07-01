package resilience

import (
	"context"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestAccountKey(t *testing.T) {
	assert.Equal(t, "openai:acc1:direct", AccountKey("openai", "acc1", ""))
	assert.Equal(t, "openai:acc1:proxy1", AccountKey("openai", "acc1", "proxy1"))
}

func TestSemaphoreBypassWhenMaxConcurrencyZero(t *testing.T) {
	s := NewSemaphore()
	release, err := s.Acquire(context.Background(), "k", 0)
	require.NoError(t, err)
	release()
}

func TestSemaphoreAcquireRelease(t *testing.T) {
	s := NewSemaphore()
	release, err := s.Acquire(context.Background(), "k", 1)
	require.NoError(t, err)

	// Second acquire should block until release.
	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()
	_, err = s.Acquire(ctx, "k", 1)
	assert.ErrorIs(t, err, context.DeadlineExceeded)

	release()

	// After release, another acquire should succeed quickly.
	ctx2, cancel2 := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel2()
	release2, err := s.Acquire(ctx2, "k", 1)
	require.NoError(t, err)
	release2()
}

func TestSemaphoreMaxConcurrency(t *testing.T) {
	s := NewSemaphore()
	key := "provider:account:direct"
	max := 2

	var running int32
	var maxObserved int32
	var wg sync.WaitGroup

	for i := 0; i < 5; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			release, err := s.Acquire(context.Background(), key, max)
			require.NoError(t, err)
			current := atomic.AddInt32(&running, 1)
			for {
				obs := atomic.LoadInt32(&maxObserved)
				if current > obs {
					if atomic.CompareAndSwapInt32(&maxObserved, obs, current) {
						break
					}
				} else {
					break
				}
			}
			time.Sleep(20 * time.Millisecond)
			atomic.AddInt32(&running, -1)
			release()
		}()
	}

	wg.Wait()
	assert.LessOrEqual(t, int(atomic.LoadInt32(&maxObserved)), max)
}

func TestSemaphoreQueueTimeout(t *testing.T) {
	s := NewSemaphore()
	key := "k"
	release, err := s.Acquire(context.Background(), key, 1)
	require.NoError(t, err)
	defer release()

	start := time.Now()
	_, err = s.AcquireWithOptions(context.Background(), key, 1, 50, 10)
	assert.ErrorIs(t, err, context.DeadlineExceeded)
	assert.WithinDuration(t, start.Add(50*time.Millisecond), time.Now(), 100*time.Millisecond)
}

func TestSemaphoreContextCancellation(t *testing.T) {
	s := NewSemaphore()
	key := "k"
	release, err := s.Acquire(context.Background(), key, 1)
	require.NoError(t, err)
	defer release()

	ctx, cancel := context.WithCancel(context.Background())
	go func() {
		time.Sleep(20 * time.Millisecond)
		cancel()
	}()
	_, err = s.Acquire(ctx, key, 1)
	assert.ErrorIs(t, err, context.Canceled)
}

func TestSemaphoreQueueFull(t *testing.T) {
	s := NewSemaphore()
	key := "k"
	release, err := s.Acquire(context.Background(), key, 1)
	require.NoError(t, err)
	defer release()

	// Fill the queue with blocked waiters.
	var wg sync.WaitGroup
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, _ = s.AcquireWithOptions(context.Background(), key, 1, 200, 20)
		}()
	}
	time.Sleep(10 * time.Millisecond)

	_, err = s.AcquireWithOptions(context.Background(), key, 1, 10, 20)
	assert.ErrorIs(t, err, ErrCapacity)
	wg.Wait()
}

func TestSemaphoreMarkBlocked(t *testing.T) {
	s := NewSemaphore()
	key := "k"
	s.MarkBlocked(key, 100)

	// The gate is created even with no running requests.
	stats := s.Stats()
	require.Contains(t, stats, key)
	assert.NotNil(t, stats[key].BlockedUntil)

	// A new acquire queues because the gate is blocked.
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Millisecond)
	defer cancel()
	_, err := s.Acquire(ctx, key, 1)
	assert.ErrorIs(t, err, context.DeadlineExceeded)
}

func TestSemaphoreStats(t *testing.T) {
	s := NewSemaphore()
	key := "p:a:direct"
	release, err := s.Acquire(context.Background(), key, 2)
	require.NoError(t, err)

	stats := s.Stats()
	require.Contains(t, stats, key)
	assert.Equal(t, 1, stats[key].Running)
	assert.Equal(t, 0, stats[key].Queued)
	assert.Equal(t, 2, stats[key].MaxConcurrency)

	release()
}

func TestSemaphoreIndependentKeys(t *testing.T) {
	s := NewSemaphore()
	r1, err := s.Acquire(context.Background(), "a", 1)
	require.NoError(t, err)
	r2, err := s.Acquire(context.Background(), "b", 1)
	require.NoError(t, err)
	r1()
	r2()
}
