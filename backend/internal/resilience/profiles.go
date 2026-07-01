package resilience

// Profile is a tuned resilience profile for a provider, account, or proxy.
// It contains circuit-breaker thresholds and concurrency limits.
type Profile struct {
	// FailureThreshold is the number of failures (within the window) that
	// trips the circuit breaker to OPEN.
	FailureThreshold int

	// SuccessThreshold is the number of consecutive successes in HALF_OPEN
	// required to close the circuit. The JS breaker uses a single probe by
	// default, so this field is kept for future use.
	SuccessThreshold int

	// FailureWindowMs is the sliding window duration for failure counting.
	// 0 means cumulative counting (legacy behavior).
	FailureWindowMs int

	// TimeoutMs is the base duration the circuit stays OPEN before allowing
	// probe requests (HALF_OPEN).
	TimeoutMs int

	// HalfOpenMaxCalls is the number of probe requests allowed while HALF_OPEN.
	HalfOpenMaxCalls int

	// MaxConcurrency limits concurrent requests per account key. Values <= 0
	// bypass the semaphore entirely.
	MaxConcurrency int
}

// DefaultProfile returns the baseline resilience profile matching the Node.js
// circuit breaker defaults.
func DefaultProfile() *Profile {
	return &Profile{
		FailureThreshold: 5,
		SuccessThreshold: 1,
		FailureWindowMs:  0,
		TimeoutMs:        30_000,
		HalfOpenMaxCalls: 1,
		MaxConcurrency:   3,
	}
}

// providerOverrides maps known provider IDs to slightly tuned profiles.
// Values that are not overridden keep the default.
var providerOverrides = map[string]func(*Profile){
	"openai": func(p *Profile) {
		// OpenAI is strict on rate limits; fail faster and retry sooner.
		p.FailureThreshold = 3
		p.TimeoutMs = 15_000
		p.MaxConcurrency = 2
	},
	"anthropic": func(p *Profile) {
		p.FailureThreshold = 4
		p.MaxConcurrency = 2
	},
	"gemini": func(p *Profile) {
		p.FailureThreshold = 4
		p.TimeoutMs = 20_000
	},
	"groq": func(p *Profile) {
		p.FailureThreshold = 3
		p.TimeoutMs = 10_000
		p.MaxConcurrency = 5
	},
	"ollama-local": func(p *Profile) {
		// Local providers should not be penalized for transient load.
		p.FailureThreshold = 10
		p.TimeoutMs = 5_000
		p.MaxConcurrency = 10
	},
}

// ProfileForProvider returns a copy of the default profile, optionally tuned
// for the given provider ID. Unknown providers receive the default profile.
func ProfileForProvider(providerID string) *Profile {
	p := DefaultProfile()
	if providerID == "" {
		return p
	}
	if override, ok := providerOverrides[providerID]; ok {
		override(p)
	}
	return p
}
