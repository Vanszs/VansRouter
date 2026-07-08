package schema

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestRoleConstants(t *testing.T) {
	assert.Equal(t, "system", RoleSystem)
	assert.Equal(t, "user", RoleUser)
	assert.Equal(t, "assistant", RoleAssistant)
	assert.Equal(t, "tool", RoleTool)
}

func TestGeminiRoleConstants(t *testing.T) {
	assert.Equal(t, "user", GeminiRoleUser)
	assert.Equal(t, "model", GeminiRoleModel)
	assert.Equal(t, "function", GeminiRoleFunction)
}

func TestOpenAIBlockTypeConstants(t *testing.T) {
	assert.Equal(t, "text", OpenAIBlockTypeText)
	assert.Equal(t, "image_url", OpenAIBlockTypeImageURL)
	assert.Equal(t, "input_audio", OpenAIBlockTypeInputAudio)
	assert.Equal(t, "refusal", OpenAIBlockTypeRefusal)
	assert.Equal(t, "function", OpenAIBlockTypeFunction)
	assert.Equal(t, "image", OpenAIBlockTypeImage)
	assert.Equal(t, "file", OpenAIBlockTypeFile)
}

func TestClaudeBlockTypeConstants(t *testing.T) {
	assert.Equal(t, "text", ClaudeBlockTypeText)
	assert.Equal(t, "image", ClaudeBlockTypeImage)
	assert.Equal(t, "tool_use", ClaudeBlockTypeToolUse)
	assert.Equal(t, "tool_result", ClaudeBlockTypeToolResult)
	assert.Equal(t, "thinking", ClaudeBlockTypeThinking)
	assert.Equal(t, "document", ClaudeBlockTypeDocument)
}

func TestResponsesItemTypeConstants(t *testing.T) {
	assert.Equal(t, "message", ResponsesItemTypeMessage)
	assert.Equal(t, "thinking", ResponsesItemTypeThinking)
	assert.Equal(t, "function_call", ResponsesItemTypeFunctionCall)
	assert.Equal(t, "function_call_output", ResponsesItemTypeFunctionCallOutput)
	assert.Equal(t, "reasoning", ResponsesItemTypeReasoning)
	assert.Equal(t, "output_text", ResponsesItemTypeOutputText)
	assert.Equal(t, "input_text", ResponsesItemTypeInputText)
	assert.Equal(t, "input_image", ResponsesItemTypeInputImage)
	assert.Equal(t, "summary_text", ResponsesItemTypeSummaryText)
}

func TestValidOpenAIContentTypes(t *testing.T) {
	assert.Contains(t, ValidOpenAIContentTypes, "text")
	assert.Contains(t, ValidOpenAIContentTypes, "image_url")
	assert.Contains(t, ValidOpenAIContentTypes, "input_audio")
	assert.Contains(t, ValidOpenAIContentTypes, "refusal")
	assert.Len(t, ValidOpenAIContentTypes, 4)
}

func TestValidOpenAIMessageTypes(t *testing.T) {
	assert.Contains(t, ValidOpenAIMessageTypes, "system")
	assert.Contains(t, ValidOpenAIMessageTypes, "user")
	assert.Contains(t, ValidOpenAIMessageTypes, "assistant")
	assert.Contains(t, ValidOpenAIMessageTypes, "tool")
	assert.Len(t, ValidOpenAIMessageTypes, 4)
}

func TestModelFallback(t *testing.T) {
	assert.NotEmpty(t, ModelFallback["claude"])
	assert.NotEmpty(t, ModelFallback["openai"])
	assert.NotEmpty(t, ModelFallback["gemini"])
	assert.NotEmpty(t, ModelFallback["vertex"])
	assert.NotEmpty(t, ModelFallback["ollama"])
	assert.Equal(t, "claude-sonnet-4-20250514", ModelFallback["claude"])
	assert.Equal(t, "gpt-4o", ModelFallback["openai"])
	assert.Equal(t, "gemini-1.5-pro-latest", ModelFallback["gemini"])
	assert.Equal(t, "gemini-1.5-pro-latest", ModelFallback["vertex"])
	assert.Equal(t, "llama3", ModelFallback["ollama"])
}

func TestDefaultImageMIME(t *testing.T) {
	assert.Equal(t, "image/png", DefaultImageMIME)
}

func TestOpenAIFinishReasonMap(t *testing.T) {
	tests := []struct {
		key      string
		expected string
	}{
		{"stop", "stop"},
		{"length", "length"},
		{"tool_calls", "tool_calls"},
		{"content_filter", "content_filter"},
		{"function_call", "function_call"},
	}
	for _, tt := range tests {
		t.Run(tt.key, func(t *testing.T) {
			assert.Equal(t, tt.expected, OpenAIFinishReason[tt.key])
		})
	}
	assert.Len(t, OpenAIFinishReason, 5)
}

func TestClaudeStopReasonMap(t *testing.T) {
	tests := []struct {
		key      string
		expected string
	}{
		{"end_turn", "stop"},
		{"max_tokens", "length"},
		{"stop_sequence", "stop"},
		{"tool_use", "tool_calls"},
		{"content_filter", "content_filter"},
	}
	for _, tt := range tests {
		t.Run(tt.key, func(t *testing.T) {
			assert.Equal(t, tt.expected, ClaudeStopReason[tt.key])
		})
	}
	assert.Len(t, ClaudeStopReason, 5)
}

func TestGeminiFinishReasonMap(t *testing.T) {
	tests := []struct {
		key      string
		expected string
	}{
		{"STOP", "stop"},
		{"MAX_TOKENS", "length"},
		{"SAFETY", "content_filter"},
		{"RECITATION", "content_filter"},
		{"OTHER", "stop"},
		{"FINISH_REASON_UNSPECIFIED", "stop"},
	}
	for _, tt := range tests {
		t.Run(tt.key, func(t *testing.T) {
			assert.Equal(t, tt.expected, GeminiFinishReason[tt.key])
		})
	}
	assert.Len(t, GeminiFinishReason, 6)
}

func TestFinishReasonMissingKeys(t *testing.T) {
	_, ok := OpenAIFinishReason["unknown"]
	assert.False(t, ok)

	_, ok = ClaudeStopReason["unknown"]
	assert.False(t, ok)

	_, ok = GeminiFinishReason["UNKNOWN"]
	assert.False(t, ok)
}

func TestRoleOverlap(t *testing.T) {
	// GeminiRoleUser and RoleUser should be the same
	assert.Equal(t, RoleUser, GeminiRoleUser)
	// Gemini model role is different from assistant
	assert.NotEqual(t, RoleAssistant, GeminiRoleModel)
}
