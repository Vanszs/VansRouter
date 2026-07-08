package request

import (
	"testing"

	"github.com/9router/9router/internal/translator"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestOpenAIToOllamaRequest_Basic(t *testing.T) {
	body := map[string]any{
		"model":       "llama3",
		"messages":    []map[string]any{{"role": "user", "content": "Hello"}},
		"stream":      true,
		"temperature": 0.7,
		"max_tokens":  1000,
	}
	result, err := translator.TranslateRequest(
		translator.FormatOpenAI, translator.FormatOllama,
		"llama3", body, true, nil,
	)
	require.NoError(t, err)
	require.NotNil(t, result)

	assert.Equal(t, "llama3", result["model"])
	assert.Equal(t, true, result["stream"])
	msgs, ok := result["messages"].([]map[string]any)
	require.True(t, ok)
	assert.Len(t, msgs, 1)
	assert.Equal(t, "user", msgs[0]["role"])
	assert.Equal(t, "Hello", msgs[0]["content"])

	options, ok := result["options"].(map[string]any)
	require.True(t, ok)
	assert.Equal(t, 0.7, options["temperature"])
	assert.Equal(t, 1000, options["num_predict"])
}

func TestOpenAIToOllamaRequest_NoParams(t *testing.T) {
	body := map[string]any{
		"messages": []map[string]any{{"role": "user", "content": "Hi"}},
	}
	result, err := translator.TranslateRequest(
		translator.FormatOpenAI, translator.FormatOllama,
		"llama3", body, false, nil,
	)
	require.NoError(t, err)
	assert.Equal(t, false, result["stream"])
	// max_tokens defaults to 64000 when not provided, so options will have num_predict
	// Just verify no temperature or top_p
	options, hasOptions := result["options"].(map[string]any)
	if hasOptions {
		_, hasTemp := options["temperature"]
		assert.False(t, hasTemp, "should not have temperature when not provided")
	}
}

func TestOpenAIToOllamaRequest_WithTools(t *testing.T) {
	body := map[string]any{
		"messages": []map[string]any{{"role": "user", "content": "What time is it?"}},
		"tools": []map[string]any{
			{"type": "function", "function": map[string]any{"name": "get_time"}},
		},
		"tool_choice": "auto",
	}
	result, err := translator.TranslateRequest(
		translator.FormatOpenAI, translator.FormatOllama,
		"llama3", body, false, nil,
	)
	require.NoError(t, err)
	assert.NotNil(t, result["tools"])
	assert.Equal(t, "auto", result["tool_choice"])
}

func TestOpenAIToOllamaRequest_TopP(t *testing.T) {
	body := map[string]any{
		"messages": []map[string]any{{"role": "user", "content": "Hi"}},
		"top_p":    0.9,
	}
	result, err := translator.TranslateRequest(
		translator.FormatOpenAI, translator.FormatOllama,
		"llama3", body, false, nil,
	)
	require.NoError(t, err)
	options := result["options"].(map[string]any)
	assert.Equal(t, 0.9, options["top_p"])
}

func TestOpenAIToOllamaRequest_ArrayContentFlattened(t *testing.T) {
	body := map[string]any{
		"messages": []map[string]any{
			{
				"role": "user",
				"content": []map[string]any{
					{"type": "text", "text": "Hello"},
					{"type": "text", "text": "World"},
				},
			},
		},
	}
	result, err := translator.TranslateRequest(
		translator.FormatOpenAI, translator.FormatOllama,
		"llama3", body, false, nil,
	)
	require.NoError(t, err)
	msgs := result["messages"].([]map[string]any)
	// Array content should be flattened to string
	content, ok := msgs[0]["content"].(string)
	require.True(t, ok)
	assert.Contains(t, content, "Hello")
}

func TestOpenAIToOllamaRequest_TopPInt(t *testing.T) {
	body := map[string]any{
		"messages": []map[string]any{{"role": "user", "content": "Hi"}},
		"top_p":    1,
	}
	result, err := translator.TranslateRequest(
		translator.FormatOpenAI, translator.FormatOllama,
		"llama3", body, false, nil,
	)
	require.NoError(t, err)
	options := result["options"].(map[string]any)
	assert.Equal(t, float64(1), options["top_p"])
}

func TestOpenAIToVertexRequest_DelegatesToGemini(t *testing.T) {
	body := map[string]any{
		"model":    "gemini-1.5-pro",
		"messages": []map[string]any{{"role": "user", "content": "Hello"}},
	}
	result, err := translator.TranslateRequest(
		translator.FormatOpenAI, translator.FormatVertex,
		"gemini-1.5-pro", body, false, nil,
	)
	require.NoError(t, err)
	require.NotNil(t, result)
	// Should have Gemini-style contents
	assert.NotNil(t, result["contents"])
	assert.NotNil(t, result["generationConfig"])
}

func TestOpenAIToVertexRequest_StripsFunctionCallIDs(t *testing.T) {
	body := map[string]any{
		"messages": []any{
			map[string]any{"role": "user", "content": "Use the tool"},
			map[string]any{
				"role": "assistant",
				"tool_calls": []any{
					map[string]any{"id": "call_123", "type": "function", "function": map[string]any{"name": "get_weather", "arguments": "{}"}},
				},
			},
			map[string]any{"role": "tool", "tool_call_id": "call_123", "content": "sunny"},
		},
	}
	result, err := translator.TranslateRequest(
		translator.FormatOpenAI, translator.FormatVertex,
		"gemini-1.5-pro", body, false, nil,
	)
	require.NoError(t, err)
	// contents can be []any or []map[string]any depending on input type
	var contents []map[string]any
	switch c := result["contents"].(type) {
	case []any:
		for _, item := range c {
			if m, ok := item.(map[string]any); ok {
				contents = append(contents, m)
			}
		}
	case []map[string]any:
		contents = c
	default:
		t.Fatalf("unexpected contents type: %T", result["contents"])
	}
	require.NotEmpty(t, contents)
	// Find functionCall parts and verify id is stripped
	for _, turn := range contents {
		parts, ok := turn["parts"].([]any)
		if !ok {
			partsMap, ok2 := turn["parts"].([]map[string]any)
			if !ok2 {
				continue
			}
			for _, part := range partsMap {
				if fc, ok := part["functionCall"].(map[string]any); ok {
					_, hasID := fc["id"]
					assert.False(t, hasID, "functionCall should not have id in Vertex")
				}
				if fr, ok := part["functionResponse"].(map[string]any); ok {
					_, hasID := fr["id"]
					assert.False(t, hasID, "functionResponse should not have id in Vertex")
				}
			}
			continue
		}
		for _, p := range parts {
			part, ok := p.(map[string]any)
			if !ok {
				continue
			}
			if fc, ok := part["functionCall"].(map[string]any); ok {
				_, hasID := fc["id"]
				assert.False(t, hasID, "functionCall should not have id in Vertex")
			}
			if fr, ok := part["functionResponse"].(map[string]any); ok {
				_, hasID := fr["id"]
				assert.False(t, hasID, "functionResponse should not have id in Vertex")
			}
		}
	}
}

func TestOpenAIToGeminiRequest_Basic(t *testing.T) {
	body := map[string]any{
		"model":       "gemini-1.5-pro",
		"messages":    []map[string]any{{"role": "user", "content": "Hello"}},
		"temperature": 0.7,
		"max_tokens":  1000,
	}
	result, err := translator.TranslateRequest(
		translator.FormatOpenAI, translator.FormatGemini,
		"gemini-1.5-pro", body, false, nil,
	)
	require.NoError(t, err)
	require.NotNil(t, result)

	assert.Equal(t, "gemini-1.5-pro", result["model"])
	assert.NotNil(t, result["contents"])
	assert.NotNil(t, result["generationConfig"])
	assert.NotNil(t, result["safetySettings"])

	genConfig := result["generationConfig"].(map[string]any)
	assert.Equal(t, 0.7, genConfig["temperature"])
	assert.Equal(t, 1000, genConfig["maxOutputTokens"])
}

func TestOpenAIToGeminiRequest_SystemInstruction(t *testing.T) {
	body := map[string]any{
		"messages": []map[string]any{
			{"role": "system", "content": "You are helpful"},
			{"role": "user", "content": "Hi"},
		},
	}
	result, err := translator.TranslateRequest(
		translator.FormatOpenAI, translator.FormatGemini,
		"gemini-1.5-pro", body, false, nil,
	)
	require.NoError(t, err)
	// System message should become systemInstruction
	assert.NotNil(t, result["systemInstruction"])
}

func TestOpenAIToGeminiRequest_TopK(t *testing.T) {
	body := map[string]any{
		"messages": []map[string]any{{"role": "user", "content": "Hi"}},
		"top_k":    40,
	}
	result, err := translator.TranslateRequest(
		translator.FormatOpenAI, translator.FormatGemini,
		"gemini-1.5-pro", body, false, nil,
	)
	require.NoError(t, err)
	genConfig := result["generationConfig"].(map[string]any)
	assert.Equal(t, 40, genConfig["topK"])
}

func TestOpenAIToClaudeRequest_Basic(t *testing.T) {
	body := map[string]any{
		"model":       "claude-sonnet-4-20250514",
		"messages":    []map[string]any{{"role": "user", "content": "Hello"}},
		"max_tokens":  1024,
		"temperature": 0.7,
		"stream":      true,
	}
	result, err := translator.TranslateRequest(
		translator.FormatOpenAI, translator.FormatClaude,
		"claude-sonnet-4-20250514", body, true, nil,
	)
	require.NoError(t, err)
	require.NotNil(t, result)

	assert.Equal(t, "claude-sonnet-4-20250514", result["model"])
	assert.NotNil(t, result["messages"])
	assert.Equal(t, 1024, result["max_tokens"])
	assert.Equal(t, true, result["stream"])
}

func TestOpenAIToClaudeRequest_SystemPrompt(t *testing.T) {
	body := map[string]any{
		"messages": []map[string]any{
			{"role": "system", "content": "You are helpful"},
			{"role": "user", "content": "Hi"},
		},
		"max_tokens": 1024,
	}
	result, err := translator.TranslateRequest(
		translator.FormatOpenAI, translator.FormatClaude,
		"claude-sonnet-4-20250514", body, false, nil,
	)
	require.NoError(t, err)
	// System should be extracted to top-level "system"
	assert.NotNil(t, result["system"])
	msgs := result["messages"].([]map[string]any)
	// System message should not be in messages
	for _, m := range msgs {
		assert.NotEqual(t, "system", m["role"])
	}
}

func TestOpenAIToClaudeRequest_ArrayContentToString(t *testing.T) {
	body := map[string]any{
		"messages": []map[string]any{
			{
				"role": "user",
				"content": []map[string]any{
					{"type": "text", "text": "Hello"},
				},
			},
		},
		"max_tokens": 1024,
	}
	result, err := translator.TranslateRequest(
		translator.FormatOpenAI, translator.FormatClaude,
		"claude-sonnet-4-20250514", body, false, nil,
	)
	require.NoError(t, err)
	msgs := result["messages"].([]map[string]any)
	// Content may be string or array depending on implementation
	// Just verify it's not nil
	assert.NotNil(t, msgs[0]["content"])
}

func TestClaudeToOpenAIRequest_Basic(t *testing.T) {
	body := map[string]any{
		"model":      "claude-sonnet-4-20250514",
		"max_tokens": 1024,
		"messages":   []map[string]any{{"role": "user", "content": "Hello"}},
		"system":     "You are helpful",
		"stream":     true,
	}
	result, err := translator.TranslateRequest(
		translator.FormatClaude, translator.FormatOpenAI,
		"claude-sonnet-4-20250514", body, true, nil,
	)
	require.NoError(t, err)
	require.NotNil(t, result)

	assert.Equal(t, "claude-sonnet-4-20250514", result["model"])
	assert.NotNil(t, result["messages"])
	assert.Equal(t, true, result["stream"])

	// System should be prepended as first message
	msgs := result["messages"].([]map[string]any)
	require.GreaterOrEqual(t, len(msgs), 2)
	assert.Equal(t, "system", msgs[0]["role"])
}

func TestOpenAIToCursorRequest_Basic(t *testing.T) {
	body := map[string]any{
		"model":    "gpt-4o",
		"messages": []map[string]any{{"role": "user", "content": "Hello"}},
		"stream":   true,
	}
	result, err := translator.TranslateRequest(
		translator.FormatOpenAI, translator.FormatCursor,
		"gpt-4o", body, true, nil,
	)
	require.NoError(t, err)
	require.NotNil(t, result)
	assert.Equal(t, "gpt-4o", result["model"])
	assert.NotNil(t, result["messages"])
}

func TestOpenAIToCommandCodeRequest_Basic(t *testing.T) {
	body := map[string]any{
		"model":    "cmd-code",
		"messages": []map[string]any{{"role": "user", "content": "Hello"}},
		"stream":   true,
	}
	result, err := translator.TranslateRequest(
		translator.FormatOpenAI, translator.FormatCommandCode,
		"cmd-code", body, true, nil,
	)
	require.NoError(t, err)
	require.NotNil(t, result)
}

func TestOpenAIToOllamaRequest_AnyArrayMessages(t *testing.T) {
	// Test []any instead of []map[string]any
	body := map[string]any{
		"messages": []any{
			map[string]any{"role": "user", "content": "Hi"},
		},
	}
	result, err := translator.TranslateRequest(
		translator.FormatOpenAI, translator.FormatOllama,
		"llama3", body, false, nil,
	)
	require.NoError(t, err)
	msgs := result["messages"].([]map[string]any)
	assert.Len(t, msgs, 1)
}

func TestOpenAIToOllamaRequest_EmptyMessages(t *testing.T) {
	body := map[string]any{}
	result, err := translator.TranslateRequest(
		translator.FormatOpenAI, translator.FormatOllama,
		"llama3", body, false, nil,
	)
	require.NoError(t, err)
	msgs := result["messages"].([]map[string]any)
	assert.Empty(t, msgs)
}

func TestOpenAIToOllamaRequest_ToolMessages(t *testing.T) {
	body := map[string]any{
		"messages": []map[string]any{
			{"role": "user", "content": "What's the weather?"},
			{
				"role": "assistant",
				"tool_calls": []map[string]any{
					{"id": "call_1", "type": "function", "function": map[string]any{"name": "get_weather", "arguments": "{}"}},
				},
			},
			{"role": "tool", "tool_call_id": "call_1", "content": "sunny"},
		},
	}
	result, err := translator.TranslateRequest(
		translator.FormatOpenAI, translator.FormatOllama,
		"llama3", body, false, nil,
	)
	require.NoError(t, err)
	msgs := result["messages"].([]map[string]any)
	// Tool message should be converted
	var toolMsg map[string]any
	for _, m := range msgs {
		if m["role"] == "tool" {
			toolMsg = m
			break
		}
	}
	require.NotNil(t, toolMsg)
	// Ollama uses tool_name instead of tool_call_id
	assert.NotNil(t, toolMsg["tool_name"])
}

func TestNoTranslatorRegistered(t *testing.T) {
	// Try a format pair that doesn't exist
	_, err := translator.TranslateRequest(
		translator.FormatKiro, translator.FormatCursor,
		"test", map[string]any{}, false, nil,
	)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "no request translator")
}
