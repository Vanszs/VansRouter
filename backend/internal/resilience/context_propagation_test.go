package resilience

import (
	"bytes"
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// upstreamRecorder tracks per-call context behavior from a mock upstream.
// `started` is closed the first time the handler enters the blocking select,
// so tests can synchronize on "upstream is now sleeping" without busy-polling.
type upstreamRecorder struct {
	mu     sync.Mutex
	calls  []callObservation
	started chan struct{}
	once   sync.Once
}

func newRecorder() *upstreamRecorder {
	return &upstreamRecorder{started: make(chan struct{})}
}

type callObservation struct {
	Got       string // ctx.Err() observed when handler returned: "canceled", "deadline_exceeded", or ""
	Body      string
	StartedAt time.Time
	EndedAt   time.Time
}

func (r *upstreamRecorder) record(o callObservation) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.calls = append(r.calls, o)
}

func (r *upstreamRecorder) snapshot() []callObservation {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := make([]callObservation, len(r.calls))
	copy(out, r.calls)
	return out
}

func (r *upstreamRecorder) notifyStarted() { r.once.Do(func() { close(r.started) }) }

// newObservingUpstream returns a server whose handler:
//  1. captures the request body
//  2. signals via recorder.started that it is about to block
//  3. blocks until ctx is done OR maxMs elapses
//  4. records ctx.Err() at return
//  5. returns 200 on natural completion, 499 on cancellation
func newObservingUpstream(r *upstreamRecorder, maxMs time.Duration) *httptest.Server {
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		body, _ := io.ReadAll(req.Body)
		obs := callObservation{Body: string(body), StartedAt: time.Now()}
		r.notifyStarted()

		select {
		case <-req.Context().Done():
			obs.Got = classifyCtxErr(req.Context().Err())
			obs.EndedAt = time.Now()
			r.record(obs)
			// Best-effort write — client may have already closed the connection.
			w.WriteHeader(499)
			_, _ = w.Write([]byte(`{"err":"client_disconnected"}`))
			return
		case <-time.After(maxMs):
			obs.Got = classifyCtxErr(req.Context().Err())
			obs.EndedAt = time.Now()
			r.record(obs)
			w.WriteHeader(200)
			_, _ = w.Write([]byte(`{"ok":true}`))
		}
	}))
}

func classifyCtxErr(err error) string {
	switch {
	case err == nil:
		return ""
	case errors.Is(err, context.Canceled):
		return "canceled"
	case errors.Is(err, context.DeadlineExceeded):
		return "deadline_exceeded"
	default:
		return err.Error()
	}
}

// httpDoJSON performs a POST with a fresh client (no DefaultClient reuse
// surprises). Body is a small JSON blob.
func httpDoJSON(ctx context.Context, url string, body string) (*http.Response, error) {
	client := &http.Client{}
	req, err := http.NewRequestWithContext(ctx, "POST", url, bytes.NewReader([]byte(body)))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	return client.Do(req)
}

// waitForUpstream blocks until the upstream signals it has started handling,
// or the timeout elapses. Returns whether the upstream actually started.
func waitForUpstream(rec *upstreamRecorder, max time.Duration) bool {
	select {
	case <-rec.started:
		return true
	case <-time.After(max):
		return false
	}
}

// waitForCalls polls the recorder until len >= want or timeout.
func waitForCalls(rec *upstreamRecorder, want int, max time.Duration) []callObservation {
	deadline := time.Now().Add(max)
	for time.Now().Before(deadline) {
		calls := rec.snapshot()
		if len(calls) >= want {
			return calls
		}
		time.Sleep(5 * time.Millisecond)
	}
	return rec.snapshot()
}

// ---- Combo layer -----------------------------------------------------

func TestContextPropagation_Combo_PreCancelledNoUpstream(t *testing.T) {
	rec := newRecorder()
	srv := newObservingUpstream(rec, 200*time.Millisecond)
	defer srv.Close()

	ctx, cancel := context.WithCancel(context.Background())
	cancel() // pre-cancel — simulates disconnected client before request even started.

	handle := func(ctx context.Context, body map[string]any, model string) (*http.Response, error) {
		return httpDoJSON(ctx, srv.URL, `{"x":1}`)
	}

	resp, err := HandleComboChat(ctx, map[string]any{"hello": "world"},
		[]string{"openai/gpt-4o", "anthropic/claude-3.5"}, handle,
		func(level, msg string, fields ...any) {}, // logf
		"combo1", // comboName
		"",       // comboStrategy (fallback default)
		0,        // stickyLimit
		false,    // autoSwitch
		55_000,   // timeoutMs
	)
	// Pre-cancelled ctx → combo returns 499 without calling any handler.
	require.NoError(t, err)
	assert.Equal(t, 499, resp.StatusCode)
	assert.Empty(t, rec.snapshot(), "pre-cancelled ctx must not reach the upstream")
}

// TestContextPropagation_Combo_CancelMidCall simulates: client opens stream,
// upstream is mid-call, client disconnects. Combo's per-target ctx inherits
// from r.Context(), so the upstream HTTP call must observe Canceled.
func TestContextPropagation_Combo_CancelMidCall(t *testing.T) {
	rec := newRecorder()
	srv := newObservingUpstream(rec, 500*time.Millisecond)
	defer srv.Close()

	ctx, cancel := context.WithCancel(context.Background())

	handle := func(ctx context.Context, body map[string]any, model string) (*http.Response, error) {
		return httpDoJSON(ctx, srv.URL, `{"x":1}`)
	}

	// Run combo in a goroutine; cancel after upstream is sleeping.
	doneCh := make(chan struct{})
	go func() {
		defer close(doneCh)
		_, _ = HandleComboChat(ctx, map[string]any{},
			[]string{"openai/gpt-4o"}, handle,
			func(level, msg string, fields ...any) {},
			"combo2", "", 0, false, 55_000)
	}()

	require.True(t, waitForUpstream(rec, 2*time.Second), "upstream should start handling")
	cancel()
	select {
	case <-doneCh:
	case <-time.After(2 * time.Second):
		t.Fatal("combo did not return after cancel")
	}

	calls := waitForCalls(rec, 1, time.Second)
	require.Len(t, calls, 1, "exactly one upstream call expected (single target)")
	assert.Equal(t, "canceled", calls[0].Got, "upstream must observe context.Canceled")
}

// TestContextPropagation_Combo_PerTargetTimeout verifies per-target ctx derives
// a deadline from r.Context() so the upstream sees cancellation around the
// expected timeout. Go's net/http server reports the request ctx as Canceled
// when the client closes the connection — even when the client's cancellation
// came from a deadline — so we assert on timing and the combo's response code.
func TestContextPropagation_Combo_PerTargetTimeout(t *testing.T) {
	rec := newRecorder()
	srv := newObservingUpstream(rec, 500*time.Millisecond)
	defer srv.Close()

	handle := func(ctx context.Context, body map[string]any, model string) (*http.Response, error) {
		return httpDoJSON(ctx, srv.URL, `{"x":1}`)
	}

	const targetMs = 80
	start := time.Now()
	resp, err := HandleComboChat(context.Background(), map[string]any{},
		[]string{"openai/gpt-4o"}, handle,
		func(level, msg string, fields ...any) {},
		"combo3", "", 0, false, targetMs)
	require.NoError(t, err)
	elapsed := time.Since(start)

	calls := waitForCalls(rec, 1, time.Second)
	require.GreaterOrEqual(t, len(calls), 1, "upstream should have recorded at least one call")

	// Per-target 80ms timeout must cut the 500ms upstream call short.
	assert.NotEmpty(t, calls[0].Got, "upstream must observe a non-nil ctx error")
	assert.Less(t, calls[0].EndedAt.Sub(calls[0].StartedAt), 400*time.Millisecond,
		"upstream call must end before its 500ms sleep budget when per-target 80ms timeout fires")
	assert.Less(t, elapsed, time.Second, "per-target timeout should fire quickly")
	// Combo returns lastStatus=524 from context.DeadlineExceeded on the client side.
	assert.Equal(t, 524, resp.StatusCode, "combo must report lastStatus=524 on per-target timeout")
}

// ---- Breaker layer ---------------------------------------------------

// TestContextPropagation_Breaker_CancelMidCall checks that a breaker-wrapped
// call propagates the parent ctx into the inner HTTP request. The breaker
// itself doesn't wrap Execute; the caller wires CanExecute → call → Record*.
func TestContextPropagation_Breaker_CancelMidCall(t *testing.T) {
	rec := newRecorder()
	srv := newObservingUpstream(rec, 500*time.Millisecond)
	defer srv.Close()

	br := NewBreaker("ctx-test", Options{FailureThreshold: 100}) // generous so cancel doesn't trip it
	ctx, cancel := context.WithCancel(context.Background())

	// Wire breaker like production: check CanExecute → call → Record*.
	brCanDo := func(ctx context.Context) (*http.Response, error) {
		if !br.CanExecute() {
			return nil, errors.New("breaker open")
		}
		resp, err := httpDoJSON(ctx, srv.URL, `{}`)
		if err != nil {
			br.RecordFailure(err)
			return resp, err
		}
		br.RecordSuccess()
		return resp, err
	}

	doneCh := make(chan struct{})
	go func() {
		defer close(doneCh)
		_, _ = brCanDo(ctx)
	}()
	require.True(t, waitForUpstream(rec, 2*time.Second), "upstream should start handling")
	cancel()
	select {
	case <-doneCh:
	case <-time.After(2 * time.Second):
		t.Fatal("breaker-wrapped call did not return after cancel")
	}

	calls := waitForCalls(rec, 1, time.Second)
	require.Len(t, calls, 1)
	assert.Equal(t, "canceled", calls[0].Got, "upstream must observe context.Canceled through breaker")
}

// ---- maybeWaitForCooldown --------------------------------------------

func TestContextPropagation_MaybeWaitForCooldown_CancelDuringSleep(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	go func() {
		time.Sleep(10 * time.Millisecond)
		cancel()
	}()
	future := time.Now().Add(200 * time.Millisecond)
	got := MaybeWaitForCooldown(ctx, future, 0)
	assert.False(t, got.ShouldRetry)
	assert.Equal(t, "client_disconnected", got.Reason)
	assert.Less(t, got.WaitedMs, int64(100), "should cancel before full wait")
}

// TestContextPropagation_MaybeWaitForCooldown_PreCancelled verifies that
// maybeWaitForCooldown honors a parent ctx that's already done. This is the
// path that r.Context() takes when the client has already disconnected before
// the combo handler starts.
func TestContextPropagation_MaybeWaitForCooldown_PreCancelled(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	got := MaybeWaitForCooldown(ctx, time.Now().Add(time.Second), 0)
	assert.False(t, got.ShouldRetry)
	assert.Equal(t, "client_disconnected", got.Reason)
}

// TestContextPropagation_SleepMs_CancelDuringSleep is a low-level smoke test
// of the SleepMs primitive used by MaybeWaitForCooldown.
func TestContextPropagation_SleepMs_CancelDuringSleep(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	go func() {
		time.Sleep(5 * time.Millisecond)
		cancel()
	}()
	start := time.Now()
	err := SleepMs(ctx, 5_000)
	elapsed := time.Since(start)
	require.Error(t, err)
	assert.Less(t, elapsed, 200*time.Millisecond)
	assert.True(t, errors.Is(err, context.Canceled))
}

// ---- Meta entry point ------------------------------------------------

func TestContextPropagation(t *testing.T) {
	t.Run("Combo_PreCancelledNoUpstream", TestContextPropagation_Combo_PreCancelledNoUpstream)
	t.Run("Combo_CancelMidCall", TestContextPropagation_Combo_CancelMidCall)
	t.Run("Combo_PerTargetTimeout", TestContextPropagation_Combo_PerTargetTimeout)
	t.Run("Breaker_CancelMidCall", TestContextPropagation_Breaker_CancelMidCall)
	t.Run("MaybeWaitForCooldown_CancelDuringSleep", TestContextPropagation_MaybeWaitForCooldown_CancelDuringSleep)
	t.Run("MaybeWaitForCooldown_PreCancelled", TestContextPropagation_MaybeWaitForCooldown_PreCancelled)
	t.Run("SleepMs_CancelDuringSleep", TestContextPropagation_SleepMs_CancelDuringSleep)
}
