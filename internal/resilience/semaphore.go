package resilience

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"time"
)

// AccountKey builds the per-account concurrency key used by the JS
// accountSemaphore: provider:accountKey:proxyHash.
func AccountKey(provider, accountKey, proxyHash string) string {
	if proxyHash == "" {
		proxyHash = "direct"
	}
	return fmt.Sprintf("%s:%s:%s", provider, accountKey, proxyHash)
}

// ErrCapacity is returned when a semaphore queue is full or the acquire times out.
var ErrCapacity = errors.New("semaphore capacity reached")

// default concurrency constants.
const (
	defaultMaxConcurrency = 3
	defaultTimeout        = 30 * time.Second
	defaultMaxQueueSize   = 20
)

// ReleaseFunc releases the acquired semaphore slot.
type ReleaseFunc func()

// waiter represents a queued request waiting for a slot.
type waiter struct {
	ch     chan struct{}
	done   bool
	next   *waiter
}

// gate holds the running count and FIFO wait queue for one key.
type gate struct {
	maxConcurrency int
	running        int
	blockedUntil   time.Time
	mu             sync.Mutex
	queueHead      *waiter
	queueTail      *waiter
}

// Semaphore is an in-memory per-key concurrency limiter. It mirrors the
// behavior of the JS accountSemaphore without idle cleanup timers.
type Semaphore struct {
	mu    sync.RWMutex
	gates map[string]*gate
}

// NewSemaphore creates a new Semaphore.
func NewSemaphore() *Semaphore {
	return &Semaphore{gates: make(map[string]*gate)}
}

// Acquire attempts to acquire a slot for key. If maxConcurrency <= 0, it
// returns a no-op release function immediately. If no slot is available, the
// caller is queued with FIFO ordering until a slot frees, the context is
// cancelled, or timeoutMs elapses. If the queue is full, ErrCapacity is
// returned immediately.
func (s *Semaphore) Acquire(ctx context.Context, key string, maxConcurrency int) (ReleaseFunc, error) {
	return s.acquire(ctx, key, maxConcurrency, defaultTimeout, defaultMaxQueueSize)
}

// AcquireWithOptions is like Acquire but allows overriding timeout and queue size.
func (s *Semaphore) AcquireWithOptions(ctx context.Context, key string, maxConcurrency int, timeoutMs int, maxQueueSize int) (ReleaseFunc, error) {
	timeout := time.Duration(timeoutMs) * time.Millisecond
	if timeout <= 0 {
		timeout = defaultTimeout
	}
	if maxQueueSize <= 0 {
		maxQueueSize = defaultMaxQueueSize
	}
	return s.acquire(ctx, key, maxConcurrency, timeout, maxQueueSize)
}

func (s *Semaphore) acquire(ctx context.Context, key string, maxConcurrency int, timeout time.Duration, maxQueueSize int) (ReleaseFunc, error) {
	if maxConcurrency <= 0 {
		return func() {}, nil
	}

	s.mu.Lock()
	g := s.gates[key]
	if g == nil {
		g = &gate{maxConcurrency: maxConcurrency}
		s.gates[key] = g
	}
	s.mu.Unlock()

	g.mu.Lock()
	// Update maxConcurrency under g.mu to avoid data race:
	// the value is read below while holding only g.mu.
	g.maxConcurrency = maxConcurrency
	if g.running < g.maxConcurrency && (g.blockedUntil.IsZero() || time.Now().After(g.blockedUntil)) {
		g.running++
		g.mu.Unlock()
		return s.releaseFn(key, g), nil
	}
	if g.queueLength() >= maxQueueSize {
		g.mu.Unlock()
		return nil, fmt.Errorf("%w for %s", ErrCapacity, key)
	}
	w := &waiter{ch: make(chan struct{})}
	g.enqueue(w)
	g.mu.Unlock()

	timer := time.NewTimer(timeout)
	defer timer.Stop()

	select {
	case <-ctx.Done():
		g.remove(w)
		return nil, ctx.Err()
	case <-timer.C:
		g.remove(w)
		return nil, context.DeadlineExceeded
	case <-w.ch:
		return s.releaseFn(key, g), nil
	}
}

// MarkBlocked temporarily blocks all requests to key for durationMs.
// If no gate exists for key, an empty gate is created so that subsequent
// Acquire calls observe the block.
func (s *Semaphore) MarkBlocked(key string, durationMs int) {
	s.mu.Lock()
	g := s.gates[key]
	if g == nil {
		g = &gate{maxConcurrency: defaultMaxConcurrency}
		s.gates[key] = g
	}
	s.mu.Unlock()
	g.mu.Lock()
	defer g.mu.Unlock()
	until := time.Now().Add(time.Duration(durationMs) * time.Millisecond)
	if g.blockedUntil.IsZero() || g.blockedUntil.Before(until) {
		g.blockedUntil = until
	}
}

// Stats returns a snapshot of running/queued/max for each active key.
func (s *Semaphore) Stats() map[string]struct {
	Running      int
	Queued       int
	MaxConcurrency int
	BlockedUntil *time.Time
} {
	s.mu.RLock()
	defer s.mu.RUnlock()

	out := make(map[string]struct {
		Running        int
		Queued         int
		MaxConcurrency int
		BlockedUntil   *time.Time
	}, len(s.gates))
	for k, g := range s.gates {
		g.mu.Lock()
		var bt *time.Time
		if !g.blockedUntil.IsZero() {
			t := g.blockedUntil
			bt = &t
		}
		out[k] = struct {
			Running        int
			Queued         int
			MaxConcurrency int
			BlockedUntil   *time.Time
		}{
			Running:        g.running,
			Queued:         g.queueLength(),
			MaxConcurrency: g.maxConcurrency,
			BlockedUntil:   bt,
		}
		g.mu.Unlock()
	}
	return out
}

func (s *Semaphore) releaseFn(key string, g *gate) ReleaseFunc {
	released := false
	return func() {
		if released {
			return
		}
		released = true
		g.mu.Lock()
		if g.running > 0 {
			g.running--
		}
		g.drain()
		cleanup := g.running == 0 && g.queueLength() == 0 && (g.blockedUntil.IsZero() || time.Now().After(g.blockedUntil))
		g.mu.Unlock()

		if cleanup {
			s.mu.Lock()
			if sg := s.gates[key]; sg == g {
				sg.mu.Lock()
				stillIdle := sg.running == 0 && sg.queueLength() == 0 && (sg.blockedUntil.IsZero() || time.Now().After(sg.blockedUntil))
				sg.mu.Unlock()
				if stillIdle {
					delete(s.gates, key)
				}
			}
			s.mu.Unlock()
		}
	}
}

func (g *gate) drain() {
	for g.queueHead != nil && g.running < g.maxConcurrency {
		if !g.blockedUntil.IsZero() && time.Now().Before(g.blockedUntil) {
			break
		}
		g.blockedUntil = time.Time{}
		w := g.dequeue()
		if w == nil {
			break
		}
		g.running++
		close(w.ch)
	}
}

func (g *gate) enqueue(w *waiter) {
	if g.queueTail == nil {
		g.queueHead = w
		g.queueTail = w
		return
	}
	g.queueTail.next = w
	g.queueTail = w
}

func (g *gate) dequeue() *waiter {
	if g.queueHead == nil {
		return nil
	}
	w := g.queueHead
	g.queueHead = w.next
	if g.queueHead == nil {
		g.queueTail = nil
	}
	w.next = nil
	return w
}

func (g *gate) remove(w *waiter) {
	g.mu.Lock()
	defer g.mu.Unlock()
	if w.done {
		return
	}
	w.done = true

	var prev *waiter
	for cur := g.queueHead; cur != nil; cur = cur.next {
		if cur == w {
			if prev == nil {
				g.queueHead = cur.next
			} else {
				prev.next = cur.next
			}
			if g.queueTail == cur {
				g.queueTail = prev
			}
			return
		}
		prev = cur
	}
}

func (g *gate) queueLength() int {
	n := 0
	for cur := g.queueHead; cur != nil; cur = cur.next {
		n++
	}
	return n
}
