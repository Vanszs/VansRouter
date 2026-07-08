package concerns

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestToOpenAIUsage_Claude(t *testing.T) {
	usage := map[string]any{
		"input_tokens":                 100,
		"output_tokens":                50,
		"cache_read_input_tokens":      20,
		"cache_creation_input_tokens":  10,
	}
	result := ToOpenAIUsage(usage, "claude")

	// prompt = input + cache_read + cache_creation = 100 + 20 + 10 = 130
	assert.Equal(t, 130, result["prompt_tokens"])
	assert.Equal(t, 50, result["completion_tokens"])
	assert.Equal(t, 180, result["total_tokens"])
	// Detail fields
	assert.Equal(t, 20, result["cache_read_input_tokens"])
	assert.Equal(t, 10, result["cache_creation_input_tokens"])
}

func TestToOpenAIUsage_OpenAI(t *testing.T) {
	usage := map[string]any{
		"prompt_tokens":     200,
		"completion_tokens": 80,
	}
	result := ToOpenAIUsage(usage, "openai")

	assert.Equal(t, 200, result["prompt_tokens"])
	assert.Equal(t, 80, result["completion_tokens"])
	assert.Equal(t, 280, result["total_tokens"])
}

func TestToOpenAIUsage_NilInput(t *testing.T) {
	result := ToOpenAIUsage(nil, "claude")
	assert.Nil(t, result)
}

func TestToOpenAIUsage_FallbackToPromptTokens(t *testing.T) {
	// When input_tokens is 0, fall back to prompt_tokens
	usage := map[string]any{
		"prompt_tokens":     150,
		"completion_tokens": 60,
	}
	result := ToOpenAIUsage(usage, "claude")

	assert.Equal(t, 150, result["prompt_tokens"])
	assert.Equal(t, 60, result["completion_tokens"])
	assert.Equal(t, 210, result["total_tokens"])
}

func TestToOpenAIUsage_ZeroTokens(t *testing.T) {
	usage := map[string]any{}
	result := ToOpenAIUsage(usage, "openai")

	assert.Equal(t, 0, result["prompt_tokens"])
	assert.Equal(t, 0, result["completion_tokens"])
	assert.Equal(t, 0, result["total_tokens"])
}

func TestToOpenAIUsage_FloatTokens(t *testing.T) {
	// JSON unmarshal produces float64
	usage := map[string]any{
		"input_tokens":  float64(100),
		"output_tokens": float64(50),
	}
	result := ToOpenAIUsage(usage, "claude")

	assert.Equal(t, 100, result["prompt_tokens"])
	assert.Equal(t, 50, result["completion_tokens"])
}

func TestMergeUsage(t *testing.T) {
	t.Run("merge into existing dst", func(t *testing.T) {
		dst := map[string]any{"prompt_tokens": 100}
		src := map[string]any{"completion_tokens": 50}
		result := MergeUsage(dst, src)
		assert.Equal(t, 100, result["prompt_tokens"])
		assert.Equal(t, 50, result["completion_tokens"])
	})

	t.Run("nil dst creates new map", func(t *testing.T) {
		src := map[string]any{"prompt_tokens": 100}
		result := MergeUsage(nil, src)
		assert.Equal(t, 100, result["prompt_tokens"])
	})
}

func TestIntNumber(t *testing.T) {
	tests := []struct {
		name  string
		input any
		expect int
	}{
		{"int", 42, 42},
		{"int64", int64(42), 42},
		{"float64", float64(42.7), 42},
		{"float32", float32(42.7), 42},
		{"string", "42", 0},
		{"nil", nil, 0},
		{"bool", true, 0},
		{"negative int", -5, -5},
		{"zero", 0, 0},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.expect, IntNumber(tt.input))
		})
	}
}

func TestBuildUsage(t *testing.T) {
	t.Run("basic usage", func(t *testing.T) {
		result := BuildUsage(100, 50, 150, 0, 0, 0)
		assert.Equal(t, 100, result["prompt_tokens"])
		assert.Equal(t, 50, result["completion_tokens"])
		assert.Equal(t, 150, result["total_tokens"])
		assert.NotContains(t, result, "prompt_tokens_details")
		assert.NotContains(t, result, "completion_tokens_details")
	})

	t.Run("with cached tokens", func(t *testing.T) {
		result := BuildUsage(100, 50, 150, 20, 0, 0)
		details, ok := result["prompt_tokens_details"].(map[string]any)
		require.True(t, ok)
		assert.Equal(t, 20, details["cached_tokens"])
		assert.NotContains(t, details, "cache_creation_tokens")
	})

	t.Run("with cache creation tokens", func(t *testing.T) {
		result := BuildUsage(100, 50, 150, 0, 15, 0)
		details, ok := result["prompt_tokens_details"].(map[string]any)
		require.True(t, ok)
		assert.Equal(t, 15, details["cache_creation_tokens"])
	})

	t.Run("with both cache types", func(t *testing.T) {
		result := BuildUsage(100, 50, 150, 20, 15, 0)
		details, ok := result["prompt_tokens_details"].(map[string]any)
		require.True(t, ok)
		assert.Equal(t, 20, details["cached_tokens"])
		assert.Equal(t, 15, details["cache_creation_tokens"])
	})

	t.Run("with reasoning tokens", func(t *testing.T) {
		result := BuildUsage(100, 50, 150, 0, 0, 30)
		details, ok := result["completion_tokens_details"].(map[string]any)
		require.True(t, ok)
		assert.Equal(t, 30, details["reasoning_tokens"])
	})

	t.Run("with all optional fields", func(t *testing.T) {
		result := BuildUsage(100, 50, 150, 20, 15, 30)
		assert.Contains(t, result, "prompt_tokens_details")
		assert.Contains(t, result, "completion_tokens_details")
	})
}
