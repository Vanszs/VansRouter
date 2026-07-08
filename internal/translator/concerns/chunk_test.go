package concerns

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestBuildChunk(t *testing.T) {
	t.Run("full meta fields", func(t *testing.T) {
		meta := map[string]any{
			"id":      "chatcmpl-123",
			"created": 1700000000,
			"model":   "gpt-4o",
		}
		delta := map[string]any{"content": "hello"}
		chunk := BuildChunk(meta, delta, "stop")

		assert.Equal(t, "chatcmpl-123", chunk["id"])
		assert.Equal(t, "chat.completion.chunk", chunk["object"])
		assert.Equal(t, 1700000000, chunk["created"])
		assert.Equal(t, "gpt-4o", chunk["model"])

		choices, ok := chunk["choices"].([]map[string]any)
		require.True(t, ok)
		require.Len(t, choices, 1)
		assert.Equal(t, 0, choices[0]["index"])
		assert.Equal(t, delta, choices[0]["delta"])
		assert.Equal(t, "stop", choices[0]["finish_reason"])
	})

	t.Run("empty finish reason sets nil", func(t *testing.T) {
		meta := map[string]any{
			"id":      "abc",
			"created": 100,
			"model":   "test-model",
		}
		chunk := BuildChunk(meta, map[string]any{}, "")
		choices := chunk["choices"].([]map[string]any)
		assert.Nil(t, choices[0]["finish_reason"])
	})

	t.Run("missing meta fields use defaults", func(t *testing.T) {
		meta := map[string]any{}
		chunk := BuildChunk(meta, nil, "length")
		assert.Equal(t, "", chunk["id"])
		assert.Equal(t, 0, chunk["created"])
		assert.Equal(t, "", chunk["model"])
	})

	t.Run("wrong type meta fields use defaults", func(t *testing.T) {
		meta := map[string]any{
			"id":      12345,
			"created": "not-an-int",
			"model":   true,
		}
		chunk := BuildChunk(meta, nil, "")
		assert.Equal(t, "", chunk["id"])
		assert.Equal(t, 0, chunk["created"])
		assert.Equal(t, "", chunk["model"])
	})

	t.Run("delta with multiple fields", func(t *testing.T) {
		meta := map[string]any{
			"id":      "x",
			"created": 1,
			"model":   "m",
		}
		delta := map[string]any{
			"content":          "hello",
			"reasoning_content": "thinking",
		}
		chunk := BuildChunk(meta, delta, "")
		choices := chunk["choices"].([]map[string]any)
		d := choices[0]["delta"].(map[string]any)
		assert.Equal(t, "hello", d["content"])
		assert.Equal(t, "thinking", d["reasoning_content"])
	})
}

func TestBuildClaudeChunk(t *testing.T) {
	t.Run("basic chunk", func(t *testing.T) {
		payload := map[string]any{
			"index": 0,
			"delta": map[string]any{"type": "text_delta", "text": "hi"},
		}
		chunk := BuildClaudeChunk("content_block_delta", payload)
		assert.Equal(t, "content_block_delta", chunk["type"])
		assert.Equal(t, 0, chunk["index"])
	})

	t.Run("empty payload", func(t *testing.T) {
		chunk := BuildClaudeChunk("message_start", map[string]any{})
		assert.Equal(t, "message_start", chunk["type"])
		assert.Len(t, chunk, 1)
	})

	t.Run("payload does not override type", func(t *testing.T) {
		payload := map[string]any{
			"type": "overridden",
		}
		chunk := BuildClaudeChunk("message_delta", payload)
		// payload["type"] overwrites out["type"] due to copy order
		assert.Equal(t, "overridden", chunk["type"])
	})

	t.Run("nil payload", func(t *testing.T) {
		chunk := BuildClaudeChunk("ping", nil)
		assert.Equal(t, "ping", chunk["type"])
		assert.Len(t, chunk, 1)
	})
}

func TestSplitChunk(t *testing.T) {
	t.Run("passthrough returns single element", func(t *testing.T) {
		chunk := map[string]any{"id": "test", "content": "hello"}
		result := SplitChunk("openai", chunk)
		assert.Len(t, result, 1)
		assert.Equal(t, chunk, result[0])
	})

	t.Run("different format still passthrough", func(t *testing.T) {
		chunk := map[string]any{"type": "delta"}
		result := SplitChunk("claude", chunk)
		assert.Len(t, result, 1)
		assert.Equal(t, chunk, result[0])
	})

	t.Run("nil chunk", func(t *testing.T) {
		result := SplitChunk("openai", nil)
		assert.Len(t, result, 1)
		assert.Nil(t, result[0])
	})
}

func TestReasoningDelta(t *testing.T) {
	t.Run("with text", func(t *testing.T) {
		result := ReasoningDelta("thinking about the problem")
		assert.Equal(t, "", result["content"])
		assert.Equal(t, "thinking about the problem", result["reasoning_content"])
		assert.Equal(t, "thinking about the problem", result["reasoning"])
		assert.Equal(t, "token", result["reasoning_type"])
	})

	t.Run("empty text", func(t *testing.T) {
		result := ReasoningDelta("")
		assert.Equal(t, "", result["content"])
		assert.Equal(t, "", result["reasoning_content"])
		assert.Equal(t, "", result["reasoning"])
		assert.Equal(t, "token", result["reasoning_type"])
	})
}
