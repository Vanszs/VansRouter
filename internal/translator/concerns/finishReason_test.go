package concerns

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestToOpenAIFinish_Claude(t *testing.T) {
	tests := []struct {
		name     string
		reason   string
		expected string
	}{
		{"end_turn → stop", "end_turn", "stop"},
		{"max_tokens → length", "max_tokens", "length"},
		{"stop_sequence → stop", "stop_sequence", "stop"},
		{"tool_use → tool_calls", "tool_use", "tool_calls"},
		{"content_filter → content_filter", "content_filter", "content_filter"},
		{"unknown claude reason passthrough", "unknown_reason", "unknown_reason"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.expected, ToOpenAIFinish(tt.reason, "claude"))
		})
	}
}

func TestToOpenAIFinish_Gemini(t *testing.T) {
	tests := []struct {
		name     string
		reason   string
		expected string
	}{
		{"STOP → stop", "STOP", "stop"},
		{"MAX_TOKENS → length", "MAX_TOKENS", "length"},
		{"SAFETY → content_filter", "SAFETY", "content_filter"},
		{"RECITATION → content_filter", "RECITATION", "content_filter"},
		{"OTHER → stop", "OTHER", "stop"},
		{"FINISH_REASON_UNSPECIFIED → stop", "FINISH_REASON_UNSPECIFIED", "stop"},
		{"unknown gemini reason passthrough", "UNKNOWN", "UNKNOWN"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.expected, ToOpenAIFinish(tt.reason, "gemini"))
		})
	}
}

func TestToOpenAIFinish_OpenAI(t *testing.T) {
	// OpenAI format maps through OpenAIFinishReason
	assert.Equal(t, "stop", ToOpenAIFinish("stop", "openai"))
	assert.Equal(t, "length", ToOpenAIFinish("length", "openai"))
	assert.Equal(t, "tool_calls", ToOpenAIFinish("tool_calls", "openai"))
	assert.Equal(t, "unknown", ToOpenAIFinish("unknown", "openai"))
}

func TestToOpenAIFinish_UnknownFormat(t *testing.T) {
	// Unknown format falls through to OpenAIFinishReason lookup, then passthrough
	assert.Equal(t, "stop", ToOpenAIFinish("stop", "unknown_format"))
	assert.Equal(t, "custom_reason", ToOpenAIFinish("custom_reason", "unknown_format"))
}

func TestFromOpenAIFinish_Claude(t *testing.T) {
	assert.Equal(t, "end_turn", FromOpenAIFinish("stop", "claude"))
	assert.Equal(t, "max_tokens", FromOpenAIFinish("length", "claude"))
	assert.Equal(t, "tool_use", FromOpenAIFinish("tool_calls", "claude"))
	assert.Equal(t, "content_filter", FromOpenAIFinish("content_filter", "claude"))
}

func TestFromOpenAIFinish_ClaudeStopSequenceAmbiguity(t *testing.T) {
	// Both "end_turn" and "stop_sequence" map to "stop" — FromOpenAIFinish returns
	// the first match found. Verify it returns one of the valid reverse mappings.
	result := FromOpenAIFinish("stop", "claude")
	assert.True(t, result == "end_turn" || result == "stop_sequence",
		"expected end_turn or stop_sequence, got %s", result)
}

func TestFromOpenAIFinish_Gemini(t *testing.T) {
	// Multiple Gemini reasons map to "stop" (STOP, OTHER, FINISH_REASON_UNSPECIFIED)
	// FromOpenAIFinish returns the first match found in map iteration order.
	// Verify it returns one of the valid reverse mappings.
	result := FromOpenAIFinish("stop", "gemini")
	assert.True(t, result == "STOP" || result == "OTHER" || result == "FINISH_REASON_UNSPECIFIED",
		"expected STOP/OTHER/FINISH_REASON_UNSPECIFIED, got %s", result)
	assert.Equal(t, "MAX_TOKENS", FromOpenAIFinish("length", "gemini"))
	// SAFETY and RECITATION both map to content_filter
	result = FromOpenAIFinish("content_filter", "gemini")
	assert.True(t, result == "SAFETY" || result == "RECITATION",
		"expected SAFETY or RECITATION, got %s", result)
}

func TestFromOpenAIFinish_UnknownFormat(t *testing.T) {
	assert.Equal(t, "stop", FromOpenAIFinish("stop", "unknown"))
	assert.Equal(t, "custom", FromOpenAIFinish("custom", "unknown"))
}

func TestMapFinishReason(t *testing.T) {
	// MapFinishReason is a thin alias around ToOpenAIFinish but with swapped args.
	assert.Equal(t, ToOpenAIFinish("end_turn", "claude"), MapFinishReason("claude", "end_turn"))
	assert.Equal(t, ToOpenAIFinish("STOP", "gemini"), MapFinishReason("gemini", "STOP"))
	assert.Equal(t, ToOpenAIFinish("stop", "openai"), MapFinishReason("openai", "stop"))
}
