package resilience

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestProfiles(t *testing.T) {
	defaultProfile := DefaultProfile()
	assert.NotNil(t, defaultProfile)
	assert.Equal(t, 5, defaultProfile.FailureThreshold)
	assert.Equal(t, 1, defaultProfile.SuccessThreshold)
	assert.Equal(t, 0, defaultProfile.FailureWindowMs)
	assert.Equal(t, 30_000, defaultProfile.TimeoutMs)
	assert.Equal(t, 1, defaultProfile.HalfOpenMaxCalls)
	assert.Equal(t, 3, defaultProfile.MaxConcurrency)

	unknown := ProfileForProvider("some-unknown-provider")
	assert.Equal(t, defaultProfile.FailureThreshold, unknown.FailureThreshold)
	assert.Equal(t, defaultProfile.TimeoutMs, unknown.TimeoutMs)
	assert.Equal(t, defaultProfile.MaxConcurrency, unknown.MaxConcurrency)

	openai := ProfileForProvider("openai")
	assert.Equal(t, 3, openai.FailureThreshold)
	assert.Equal(t, 15_000, openai.TimeoutMs)
	assert.Equal(t, 2, openai.MaxConcurrency)

	anthropic := ProfileForProvider("anthropic")
	assert.Equal(t, 4, anthropic.FailureThreshold)
	assert.Equal(t, 2, anthropic.MaxConcurrency)

	gemini := ProfileForProvider("gemini")
	assert.Equal(t, 4, gemini.FailureThreshold)
	assert.Equal(t, 20_000, gemini.TimeoutMs)

	groq := ProfileForProvider("groq")
	assert.Equal(t, 3, groq.FailureThreshold)
	assert.Equal(t, 10_000, groq.TimeoutMs)
	assert.Equal(t, 5, groq.MaxConcurrency)

	ollama := ProfileForProvider("ollama-local")
	assert.Equal(t, 10, ollama.FailureThreshold)
	assert.Equal(t, 5_000, ollama.TimeoutMs)
	assert.Equal(t, 10, ollama.MaxConcurrency)

	// Each call should return a fresh copy, not the shared default pointer.
	assert.NotSame(t, defaultProfile, ProfileForProvider("openai"))
}
