package concerns

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestEnsureToolCallIds(t *testing.T) {
	t.Run("generates missing ids", func(t *testing.T) {
		tcs := []map[string]any{
			{"type": "function", "function": map[string]any{"name": "get_weather"}},
			{"id": "call_existing", "type": "function", "function": map[string]any{"name": "get_time"}},
		}
		result := EnsureToolCallIds(tcs)
		// First one gets generated id
		id1, ok := result[0]["id"].(string)
		require.True(t, ok)
		assert.True(t, strings.HasPrefix(id1, "call_"))
		assert.NotEqual(t, "call_existing", id1)
		// Second one keeps existing id
		assert.Equal(t, "call_existing", result[1]["id"])
	})

	t.Run("all missing ids", func(t *testing.T) {
		tcs := []map[string]any{
			{"type": "function", "function": map[string]any{"name": "tool1"}},
			{"type": "function", "function": map[string]any{"name": "tool2"}},
		}
		result := EnsureToolCallIds(tcs)
		id1, _ := result[0]["id"].(string)
		id2, _ := result[1]["id"].(string)
		assert.True(t, strings.HasPrefix(id1, "call_"))
		assert.True(t, strings.HasPrefix(id2, "call_"))
		assert.NotEqual(t, id1, id2)
	})

	t.Run("empty id string gets replaced", func(t *testing.T) {
		tcs := []map[string]any{
			{"id": "", "type": "function", "function": map[string]any{"name": "tool1"}},
		}
		result := EnsureToolCallIds(tcs)
		id, _ := result[0]["id"].(string)
		assert.NotEmpty(t, id)
		assert.True(t, strings.HasPrefix(id, "call_"))
	})

	t.Run("all ids present", func(t *testing.T) {
		tcs := []map[string]any{
			{"id": "call_abc", "type": "function", "function": map[string]any{"name": "tool1"}},
		}
		result := EnsureToolCallIds(tcs)
		assert.Equal(t, "call_abc", result[0]["id"])
	})

	t.Run("empty slice", func(t *testing.T) {
		result := EnsureToolCallIds([]map[string]any{})
		assert.Empty(t, result)
	})
}

func TestFixMissingToolResponses(t *testing.T) {
	t.Run("inserts missing tool responses", func(t *testing.T) {
		messages := []map[string]any{
			{"role": "user", "content": "hello"},
			{"role": "assistant", "tool_calls": []map[string]any{
				{"id": "call_1", "type": "function", "function": map[string]any{"name": "get_weather"}},
			}},
			{"role": "user", "content": "next message"},
		}
		result := FixMissingToolResponses(messages)
		// Should have inserted a tool response between assistant and user
		assert.Greater(t, len(result), len(messages))
		// Find the inserted tool message
		var toolMsgs []map[string]any
		for _, m := range result {
			if m["role"] == "tool" {
				toolMsgs = append(toolMsgs, m)
			}
		}
		require.Len(t, toolMsgs, 1)
		assert.Equal(t, "call_1", toolMsgs[0]["tool_call_id"])
		assert.Equal(t, "[No response received]", toolMsgs[0]["content"])
	})

	t.Run("no insertion when tool response exists", func(t *testing.T) {
		messages := []map[string]any{
			{"role": "assistant", "tool_calls": []map[string]any{
				{"id": "call_1", "type": "function", "function": map[string]any{"name": "get_weather"}},
			}},
			{"role": "tool", "tool_call_id": "call_1", "content": "sunny"},
		}
		result := FixMissingToolResponses(messages)
		assert.Equal(t, len(messages), len(result))
	})

	t.Run("no tool calls in assistant", func(t *testing.T) {
		messages := []map[string]any{
			{"role": "assistant", "content": "hello"},
			{"role": "user", "content": "bye"},
		}
		result := FixMissingToolResponses(messages)
		assert.Equal(t, len(messages), len(result))
	})

	t.Run("multiple missing tool calls", func(t *testing.T) {
		messages := []map[string]any{
			{"role": "assistant", "tool_calls": []map[string]any{
				{"id": "call_1", "type": "function", "function": map[string]any{"name": "tool1"}},
				{"id": "call_2", "type": "function", "function": map[string]any{"name": "tool2"}},
			}},
			{"role": "user", "content": "next"},
		}
		result := FixMissingToolResponses(messages)
		var toolMsgs []map[string]any
		for _, m := range result {
			if m["role"] == "tool" {
				toolMsgs = append(toolMsgs, m)
			}
		}
		assert.Len(t, toolMsgs, 2)
	})

	t.Run("partial tool responses", func(t *testing.T) {
		messages := []map[string]any{
			{"role": "assistant", "tool_calls": []map[string]any{
				{"id": "call_1", "type": "function", "function": map[string]any{"name": "tool1"}},
				{"id": "call_2", "type": "function", "function": map[string]any{"name": "tool2"}},
			}},
			{"role": "tool", "tool_call_id": "call_1", "content": "result1"},
		}
		result := FixMissingToolResponses(messages)
		// Should insert one missing tool response for call_2
		var toolMsgs []map[string]any
		for _, m := range result {
			if m["role"] == "tool" {
				toolMsgs = append(toolMsgs, m)
			}
		}
		assert.Len(t, toolMsgs, 2)
		// One should be the inserted one
		var inserted bool
		for _, m := range toolMsgs {
			if m["tool_call_id"] == "call_2" && m["content"] == "[No response received]" {
				inserted = true
			}
		}
		assert.True(t, inserted)
	})

	t.Run("empty messages", func(t *testing.T) {
		result := FixMissingToolResponses([]map[string]any{})
		assert.Empty(t, result)
	})
}

func TestEnsureToolCallIdsInBody(t *testing.T) {
	t.Run("ensures ids in body messages", func(t *testing.T) {
		body := map[string]any{
			"messages": []map[string]any{
				{"role": "assistant", "tool_calls": []map[string]any{
					{"type": "function", "function": map[string]any{"name": "tool1"}},
				}},
			},
		}
		EnsureToolCallIdsInBody(body)
		msgs := body["messages"].([]map[string]any)
		tcs := msgs[0]["tool_calls"].([]map[string]any)
		id, ok := tcs[0]["id"].(string)
		require.True(t, ok)
		assert.True(t, strings.HasPrefix(id, "call_"))
	})

	t.Run("no messages key", func(t *testing.T) {
		body := map[string]any{"model": "gpt-4o"}
		EnsureToolCallIdsInBody(body) // should not panic
	})

	t.Run("messages with wrong type", func(t *testing.T) {
		body := map[string]any{"messages": "not a slice"}
		EnsureToolCallIdsInBody(body) // should not panic
	})
}

func TestFallbackToolCallID(t *testing.T) {
	id := FallbackToolCallID()
	assert.NotEmpty(t, id)
	assert.True(t, strings.HasPrefix(id, "call_"))

	// Two calls should produce different ids
	id2 := FallbackToolCallID()
	assert.NotEqual(t, id, id2)
}

func TestGenerateToolCallID(t *testing.T) {
	id := generateToolCallID()
	assert.True(t, strings.HasPrefix(id, "call_"))
	// Should be call_ + 24 hex chars (12 bytes)
	assert.Equal(t, 5+24, len(id)) // "call_" (5) + 24 hex
}

// TestSplitChunk is in chunk_test.go
