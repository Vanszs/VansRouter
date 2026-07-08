package formats

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestAdjustMaxTokens(t *testing.T) {
	tests := []struct {
		name     string
		body     map[string]any
		expected int
	}{
		{
			name:     "no max_tokens provided",
			body:     map[string]any{},
			expected: DefaultMaxTokens,
		},
		{
			name:     "max_tokens below default",
			body:     map[string]any{"max_tokens": 1000},
			expected: 1000,
		},
		{
			name:     "max_tokens above default",
			body:     map[string]any{"max_tokens": 100000},
			expected: DefaultMaxTokens,
		},
		{
			name: "with tools and max_tokens below minimum",
			body: map[string]any{
				"max_tokens": 1000,
				"tools": []any{
					map[string]any{"type": "function", "function": map[string]any{"name": "test"}},
				},
			},
			expected: DefaultMinTokens,
		},
		{
			name: "with tools and max_tokens above minimum",
			body: map[string]any{
				"max_tokens": 40000,
				"tools": []any{
					map[string]any{"type": "function", "function": map[string]any{"name": "test"}},
				},
			},
			expected: 40000,
		},
		{
			name: "with thinking and max_tokens less than budget",
			body: map[string]any{
				"max_tokens": 1000,
				"thinking": map[string]any{
					"budget_tokens": 5000,
				},
			},
			expected: 6024, // budget + 1024
		},
		{
			name: "with thinking and max_tokens equal to budget",
			body: map[string]any{
				"max_tokens": 5000,
				"thinking": map[string]any{
					"budget_tokens": 5000,
				},
			},
			expected: 6024, // budget + 1024
		},
		{
			name: "with thinking and max_tokens greater than budget",
			body: map[string]any{
				"max_tokens": 10000,
				"thinking": map[string]any{
					"budget_tokens": 5000,
				},
			},
			expected: 10000,
		},
		{
			name: "complex case with tools and thinking",
			body: map[string]any{
				"max_tokens": 1000,
				"tools": []any{
					map[string]any{"type": "function", "function": map[string]any{"name": "test"}},
				},
				"thinking": map[string]any{
					"budget_tokens": 50000,
				},
			},
			expected: DefaultMaxTokens, // capped at default
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := AdjustMaxTokens(tt.body)
			assert.Equal(t, tt.expected, result)
		})
	}
}

func TestConstants(t *testing.T) {
	assert.Equal(t, 64000, DefaultMaxTokens)
	assert.Equal(t, 32000, DefaultMinTokens)
}
