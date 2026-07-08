package response

import (
	"testing"

	"github.com/9router/9router/internal/translator"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestCursorToOpenAIResponse_Passthrough(t *testing.T) {
	state := translator.InitState(translator.FormatCursor)
	chunk := map[string]any{"choices": []map[string]any{{"delta": map[string]any{"content": "hello"}}}}

	result, err := translator.TranslateResponse(
		translator.FormatCursor, translator.FormatOpenAI,
		chunk, state,
	)
	require.NoError(t, err)
	require.Len(t, result, 1)
	assert.Equal(t, chunk, result[0])
}

func TestCursorToOpenAIResponse_NilChunk(t *testing.T) {
	state := translator.InitState(translator.FormatCursor)
	result, err := translator.TranslateResponse(
		translator.FormatCursor, translator.FormatOpenAI,
		nil, state,
	)
	require.NoError(t, err)
	assert.Nil(t, result)
}

func TestOllamaToOpenAIResponse_ContentChunk(t *testing.T) {
	state := translator.InitState(translator.FormatOllama)
	chunk := map[string]any{
		"model":   "llama3",
		"message": map[string]any{"content": "Hello world"},
		"done":    false,
	}

	result, err := translator.TranslateResponse(
		translator.FormatOllama, translator.FormatOpenAI,
		chunk, state,
	)
	require.NoError(t, err)
	require.Len(t, result, 1)

	choices := result[0]["choices"].([]map[string]any)
	delta := choices[0]["delta"].(map[string]any)
	assert.Equal(t, "Hello world", delta["content"])
}

func TestOllamaToOpenAIResponse_DoneChunk(t *testing.T) {
	state := translator.InitState(translator.FormatOllama)
	state.MessageID = "test-id"
	state.Model = "llama3"

	chunk := map[string]any{
		"done":        true,
		"done_reason": "stop",
		"total_duration": 1000000000,
	}

	result, err := translator.TranslateResponse(
		translator.FormatOllama, translator.FormatOpenAI,
		chunk, state,
	)
	require.NoError(t, err)
	require.Len(t, result, 1)

	choices := result[0]["choices"].([]map[string]any)
	assert.NotNil(t, choices[0]["finish_reason"])
	assert.Equal(t, "stop", choices[0]["finish_reason"])
}

func TestOllamaToOpenAIResponse_ThinkingContent(t *testing.T) {
	state := translator.InitState(translator.FormatOllama)
	state.MessageID = "test-id"
	state.Model = "llama3"

	chunk := map[string]any{
		"model":   "llama3",
		"message": map[string]any{"content": "answer", "thinking": "reasoning"},
		"done":    false,
	}

	result, err := translator.TranslateResponse(
		translator.FormatOllama, translator.FormatOpenAI,
		chunk, state,
	)
	require.NoError(t, err)
	require.Len(t, result, 1)

	choices := result[0]["choices"].([]map[string]any)
	delta := choices[0]["delta"].(map[string]any)
	assert.Equal(t, "answer", delta["content"])
	assert.Equal(t, "reasoning", delta["reasoning_content"])
}

func TestOllamaToOpenAIResponse_ToolCalls(t *testing.T) {
	state := translator.InitState(translator.FormatOllama)
	state.MessageID = "test-id"
	state.Model = "llama3"

	chunk := map[string]any{
		"model": "llama3",
		"message": map[string]any{
			"tool_calls": []any{
				map[string]any{
					"id": "call_1",
					"function": map[string]any{
						"name":      "get_weather",
						"arguments": `{"city":"NYC"}`,
					},
				},
			},
		},
		"done": false,
	}

	result, err := translator.TranslateResponse(
		translator.FormatOllama, translator.FormatOpenAI,
		chunk, state,
	)
	require.NoError(t, err)
	require.Len(t, result, 1)

	choices := result[0]["choices"].([]map[string]any)
	delta := choices[0]["delta"].(map[string]any)
	tcs, ok := delta["tool_calls"].([]map[string]any)
	require.True(t, ok)
	require.Len(t, tcs, 1)
	assert.Equal(t, "call_1", tcs[0]["id"])
	assert.Equal(t, "get_weather", tcs[0]["function"].(map[string]any)["name"])
}

func TestOllamaToOpenAIResponse_NilChunk(t *testing.T) {
	state := translator.InitState(translator.FormatOllama)
	result, err := translator.TranslateResponse(
		translator.FormatOllama, translator.FormatOpenAI,
		nil, state,
	)
	require.NoError(t, err)
	assert.Nil(t, result)
}

func TestOllamaToOpenAIResponse_NoMessage(t *testing.T) {
	state := translator.InitState(translator.FormatOllama)
	state.MessageID = "test-id"
	state.Model = "llama3"

	chunk := map[string]any{"done": false}
	result, err := translator.TranslateResponse(
		translator.FormatOllama, translator.FormatOpenAI,
		chunk, state,
	)
	require.NoError(t, err)
	assert.Nil(t, result)
}

func TestGeminiToOpenAIResponse_Basic(t *testing.T) {
	state := translator.InitState(translator.FormatGemini)
	chunk := map[string]any{
		"candidates": []any{
			map[string]any{
				"content": map[string]any{
					"parts": []any{
						map[string]any{"text": "Hello from Gemini"},
					},
					"role": "model",
				},
			},
		},
	}

	result, err := translator.TranslateResponse(
		translator.FormatGemini, translator.FormatOpenAI,
		chunk, state,
	)
	require.NoError(t, err)
	// Should produce at least one chunk with content
	require.NotEmpty(t, result)

	// Find a content chunk
	var contentChunk map[string]any
	for _, r := range result {
		choices, ok := r["choices"].([]map[string]any)
		if !ok || len(choices) == 0 {
			continue
		}
		delta, ok := choices[0]["delta"].(map[string]any)
		if !ok {
			continue
		}
		if _, ok := delta["content"].(string); ok {
			contentChunk = r
			break
		}
	}
	require.NotNil(t, contentChunk, "should produce a content chunk")
}

func TestGeminiToOpenAIResponse_NilChunk(t *testing.T) {
	state := translator.InitState(translator.FormatGemini)
	result, err := translator.TranslateResponse(
		translator.FormatGemini, translator.FormatOpenAI,
		nil, state,
	)
	require.NoError(t, err)
	assert.Nil(t, result)
}

func TestGeminiToOpenAIResponse_NoCandidates(t *testing.T) {
	state := translator.InitState(translator.FormatGemini)
	chunk := map[string]any{"candidates": []any{}}
	result, err := translator.TranslateResponse(
		translator.FormatGemini, translator.FormatOpenAI,
		chunk, state,
	)
	require.NoError(t, err)
	assert.Nil(t, result)
}

func TestGeminiToOpenAIResponse_FinishReason(t *testing.T) {
	state := translator.InitState(translator.FormatGemini)
	state.MessageID = "test-id"
	state.Model = "gemini-1.5-pro"

	chunk := map[string]any{
		"candidates": []any{
			map[string]any{
				"content": map[string]any{
					"parts": []any{
						map[string]any{"text": "final answer"},
					},
				},
				"finishReason": "STOP",
			},
		},
	}

	result, err := translator.TranslateResponse(
		translator.FormatGemini, translator.FormatOpenAI,
		chunk, state,
	)
	require.NoError(t, err)
	require.NotEmpty(t, result)

	// Last chunk should have finish_reason
	last := result[len(result)-1]
	choices := last["choices"].([]map[string]any)
	if choices[0]["finish_reason"] != nil {
		assert.Equal(t, "stop", choices[0]["finish_reason"])
	}
}

func TestNoResponseTranslatorRegistered(t *testing.T) {
	state := translator.InitState(translator.FormatKiro)
	_, err := translator.TranslateResponse(
		translator.FormatKiro, translator.FormatCursor,
		map[string]any{}, state,
	)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "no response translator")
}

func TestAntigravityToOpenAIResponse_AntigravityWrapper(t *testing.T) {
	// Antigravity wraps Gemini responses in a "response" key
	state := translator.InitState(translator.FormatAntigravity)
	chunk := map[string]any{
		"response": map[string]any{
			"candidates": []any{
				map[string]any{
					"content": map[string]any{
						"parts": []any{
							map[string]any{"text": "from antigravity"},
						},
					},
				},
			},
		},
	}

	result, err := translator.TranslateResponse(
		translator.FormatAntigravity, translator.FormatOpenAI,
		chunk, state,
	)
	require.NoError(t, err)
	require.NotEmpty(t, result)
}
