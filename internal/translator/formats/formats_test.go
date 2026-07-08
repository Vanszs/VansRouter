package formats

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestPrepareClaudeRequest(t *testing.T) {
	t.Run("returns body unchanged", func(t *testing.T) {
		body := map[string]any{
			"model":      "claude-sonnet-4-20250514",
			"max_tokens": 1024,
			"messages":   []map[string]any{{"role": "user", "content": "Hello"}},
		}
		result := PrepareClaudeRequest(body, "claude-sonnet-4-20250514", true)
		assert.Equal(t, body, result)
	})

	t.Run("handles empty body", func(t *testing.T) {
		body := map[string]any{}
		result := PrepareClaudeRequest(body, "", false)
		assert.Equal(t, body, result)
	})

	t.Run("handles nil body", func(t *testing.T) {
		result := PrepareClaudeRequest(nil, "", false)
		assert.Nil(t, result)
	})
}

func TestFilterToOpenAIFormat(t *testing.T) {
	t.Run("returns body unchanged", func(t *testing.T) {
		body := map[string]any{
			"model":    "gpt-4o",
			"messages": []map[string]any{{"role": "user", "content": "Hello"}},
		}
		result := FilterToOpenAIFormat(body, true)
		assert.Equal(t, body, result)
	})

	t.Run("handles empty body", func(t *testing.T) {
		body := map[string]any{}
		result := FilterToOpenAIFormat(body, false)
		assert.Equal(t, body, result)
	})
}

func TestGeminiConstants(t *testing.T) {
	assert.Equal(t, "v1beta", GeminiAPIVersion)
	assert.Equal(t, "generateContent", GeminiGenerateContentPath)
	assert.Equal(t, "streamGenerateContent", GeminiStreamGenerateContentPath)
}

func TestResponsesAPIConstants(t *testing.T) {
	assert.Equal(t, "v1", OpenAIResponsesAPIVersion)
	assert.Equal(t, "responses", OpenAIResponsesEndpoint)
}
