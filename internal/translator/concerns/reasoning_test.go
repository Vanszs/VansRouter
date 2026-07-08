package concerns

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

// TestReasoningDelta is in chunk_test.go

func TestExtractReasoningText(t *testing.T) {
	tests := []struct {
		name   string
		delta  map[string]any
		expect string
	}{
		{
			name:   "reasoning_content key",
			delta:  map[string]any{"reasoning_content": "hello world"},
			expect: "hello world",
		},
		{
			name:   "reasoning key",
			delta:  map[string]any{"reasoning": "thought process"},
			expect: "thought process",
		},
		{
			name:   "reasoning_text key",
			delta:  map[string]any{"reasoning_text": "my reasoning"},
			expect: "my reasoning",
		},
		{
			name:   "thinking key",
			delta:  map[string]any{"thinking": "deep thoughts"},
			expect: "deep thoughts",
		},
		{
			name:   "first key wins (reasoning_content)",
			delta:  map[string]any{"reasoning_content": "first", "reasoning": "second"},
			expect: "first",
		},
		{
			name:   "empty string ignored",
			delta:  map[string]any{"reasoning_content": "  ", "reasoning": "real"},
			expect: "real",
		},
		{
			name:   "no reasoning keys",
			delta:  map[string]any{"content": "just text"},
			expect: "",
		},
		{
			name:   "non-string reasoning",
			delta:  map[string]any{"reasoning": 42},
			expect: "",
		},
		{
			name:   "nil delta",
			delta:  nil,
			expect: "",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.expect, ExtractReasoningText(tt.delta))
		})
	}
}

func TestNormalizeReasoning(t *testing.T) {
	chunk := map[string]any{"content": "test"}
	assert.Equal(t, chunk, NormalizeReasoning(chunk))
	assert.Nil(t, NormalizeReasoning(nil))
}

func TestFilterModality(t *testing.T) {
	body := map[string]any{"messages": []map[string]any{}}
	assert.Equal(t, body, FilterModality(body, []string{"text", "image"}))
}

func TestFilterUnsupportedParams(t *testing.T) {
	body := map[string]any{"temperature": 0.7}
	assert.Equal(t, body, FilterUnsupportedParams(body, map[string]bool{"temperature": true}))
}

func TestPrefetchImages(t *testing.T) {
	body := map[string]any{"messages": []map[string]any{}}
	assert.Equal(t, body, PrefetchImages(body))
}

func TestCaptureThinking(t *testing.T) {
	chunk := map[string]any{"content": "test"}
	assert.Equal(t, chunk, CaptureThinking(chunk))
}

func TestApplyThinking(t *testing.T) {
	body := map[string]any{"model": "gpt-4o"}
	think := map[string]any{"budget": 1024}
	assert.Equal(t, body, ApplyThinking(body, think))
}

func TestCaptureThinkingUnified(t *testing.T) {
	chunk := map[string]any{"content": "test"}
	state := map[string]bool{"thinking": true}
	result, changed := CaptureThinkingUnified(chunk, state)
	assert.Equal(t, chunk, result)
	assert.False(t, changed)
}

func TestApplyThinkingUnified(t *testing.T) {
	body := map[string]any{"model": "gpt-4o"}
	think := map[string]any{"budget": 1024}
	assert.Equal(t, body, ApplyThinkingUnified(body, think))
}
