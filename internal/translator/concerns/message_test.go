package concerns

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestCollapseTextParts(t *testing.T) {
	t.Run("empty parts returns empty string", func(t *testing.T) {
		result := CollapseTextParts([]map[string]any{})
		assert.Equal(t, "", result)
	})

	t.Run("single part returned as-is", func(t *testing.T) {
		part := map[string]any{"type": "text", "text": "hello"}
		result := CollapseTextParts([]map[string]any{part})
		assert.Equal(t, part, result)
	})

	t.Run("multiple text parts merged with newline", func(t *testing.T) {
		parts := []map[string]any{
			{"type": "text", "text": "line1"},
			{"type": "text", "text": "line2"},
		}
		result := CollapseTextParts(parts)
		m, ok := result.(map[string]any)
		require.True(t, ok)
		assert.Equal(t, "text", m["type"])
		assert.Equal(t, "line1\nline2", m["text"])
	})

	t.Run("non-text parts ignored", func(t *testing.T) {
		parts := []map[string]any{
			{"type": "image_url", "url": "http://example.com/img.png"},
			{"type": "text", "text": "hello"},
		}
		result := CollapseTextParts(parts)
		m, ok := result.(map[string]any)
		require.True(t, ok)
		assert.Equal(t, "text", m["type"])
		assert.Equal(t, "hello", m["text"])
	})

	t.Run("no text parts returns empty string", func(t *testing.T) {
		parts := []map[string]any{
			{"type": "image_url", "url": "http://example.com/img.png"},
		}
		result := CollapseTextParts(parts)
		// When no text parts found, returns the original parts slice
		// but as `any` — verify it's not a string (it's the original slice)
		_, isString := result.(string)
		assert.False(t, isString, "should not return string when no text parts")
	})

	t.Run("text part with missing text field", func(t *testing.T) {
		parts := []map[string]any{
			{"type": "text"},
			{"type": "text", "text": "hello"},
		}
		result := CollapseTextParts(parts)
		m, ok := result.(map[string]any)
		require.True(t, ok)
		assert.Equal(t, "text", m["type"])
		// Only "hello" has text
		assert.Equal(t, "hello", m["text"])
	})
}

func TestExtractTextContent(t *testing.T) {
	t.Run("string content", func(t *testing.T) {
		assert.Equal(t, "hello", ExtractTextContent("hello", ""))
	})

	t.Run("string content with sep ignored", func(t *testing.T) {
		assert.Equal(t, "hello", ExtractTextContent("hello", ", "))
	})

	t.Run("any array content", func(t *testing.T) {
		content := []any{
			map[string]any{"type": "text", "text": "line1"},
			map[string]any{"type": "image_url", "url": "..."},
			map[string]any{"type": "text", "text": "line2"},
		}
		result := ExtractTextContent(content, "\n")
		assert.Equal(t, "line1\nline2", result)
	})

	t.Run("map array content", func(t *testing.T) {
		content := []map[string]any{
			{"type": "text", "text": "hello"},
		}
		assert.Equal(t, "hello", ExtractTextContent(content, ""))
	})

	t.Run("empty array", func(t *testing.T) {
		assert.Equal(t, "", ExtractTextContent([]any{}, ""))
	})

	t.Run("non-text items in array", func(t *testing.T) {
		content := []any{
			map[string]any{"type": "image", "url": "..."},
		}
		assert.Equal(t, "", ExtractTextContent(content, ""))
	})

	t.Run("nil content", func(t *testing.T) {
		assert.Equal(t, "", ExtractTextContent(nil, ""))
	})

	t.Run("integer content returns empty", func(t *testing.T) {
		assert.Equal(t, "", ExtractTextContent(42, ""))
	})

	t.Run("custom separator", func(t *testing.T) {
		content := []any{
			map[string]any{"type": "text", "text": "a"},
			map[string]any{"type": "text", "text": "b"},
			map[string]any{"type": "text", "text": "c"},
		}
		assert.Equal(t, "a, b, c", ExtractTextContent(content, ", "))
	})

	t.Run("default separator when empty", func(t *testing.T) {
		content := []any{
			map[string]any{"type": "text", "text": "a"},
			map[string]any{"type": "text", "text": "b"},
		}
		assert.Equal(t, "a\nb", ExtractTextContent(content, ""))
	})
}

func TestNormalizeMessage(t *testing.T) {
	msg := map[string]any{"role": "user", "content": "hello"}
	assert.Equal(t, msg, NormalizeMessage(msg))
	assert.Nil(t, NormalizeMessage(nil))
}

func TestDeepCloneMessage(t *testing.T) {
	original := map[string]any{
		"role":    "user",
		"content": "hello",
		"nested":  map[string]any{"key": "value"},
	}
	clone := DeepCloneMessage(original)
	assert.Equal(t, original["role"], clone["role"])
	assert.Equal(t, original["content"], clone["content"])
	// Shallow clone — nested map is shared (same underlying pointer)
	nestedOrig := original["nested"].(map[string]any)
	nestedClone := clone["nested"].(map[string]any)
	nestedOrig["key"] = "changed"
	assert.Equal(t, "changed", nestedClone["key"], "shallow clone shares nested map")
	// Verify clone is a different map
	delete(clone, "role")
	_, exists := original["role"]
	assert.True(t, exists, "original should be unaffected by clone modification")
}

func TestDeepCloneMessage_Empty(t *testing.T) {
	clone := DeepCloneMessage(map[string]any{})
	assert.Empty(t, clone)
	assert.NotNil(t, clone)
}
