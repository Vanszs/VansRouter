package providers

import (
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestProviderResolution(t *testing.T) {
	t.Run("IsOpenAICompatible", func(t *testing.T) {
		assert.True(t, IsOpenAICompatible("openai-compatible-foo"))
		assert.True(t, IsOpenAICompatible("openai-compatible-bar"))
		assert.True(t, IsOpenAICompatible("openai-compatible-responses-foo"))
		assert.False(t, IsOpenAICompatible("openai"))
		assert.False(t, IsOpenAICompatible("anthropic-compatible-foo"))
		assert.False(t, IsOpenAICompatible(""))
	})

	t.Run("IsAnthropicCompatible", func(t *testing.T) {
		assert.True(t, IsAnthropicCompatible("anthropic-compatible-foo"))
		assert.True(t, IsAnthropicCompatible("anthropic-compatible-bar"))
		assert.False(t, IsAnthropicCompatible("anthropic"))
		assert.False(t, IsAnthropicCompatible("openai-compatible-foo"))
		assert.False(t, IsAnthropicCompatible(""))
	})

	t.Run("GetOpenAICompatibleType", func(t *testing.T) {
		assert.Equal(t, "chat", GetOpenAICompatibleType("openai-compatible-foo"))
		assert.Equal(t, "responses", GetOpenAICompatibleType("openai-compatible-responses-foo"))
		assert.Equal(t, "responses", GetOpenAICompatibleType("openai-compatible-responses"))
		assert.Equal(t, "chat", GetOpenAICompatibleType("openai-compatible-chat-foo"))
		// Non openai-compatible falls back to chat
		assert.Equal(t, "chat", GetOpenAICompatibleType("openai"))
	})

	t.Run("DetectFormat_OpenAIResponses", func(t *testing.T) {
		body := map[string]any{
			"input": []any{
				map[string]any{"role": "user", "content": "hi"},
			},
		}
		assert.Equal(t, FormatOpenAIResponses, DetectFormat(body))

		body2 := map[string]any{"input": "hello"}
		assert.Equal(t, FormatOpenAIResponses, DetectFormat(body2))

		// input without messages is responses, but input WITH messages is OpenAI chat
		body3 := map[string]any{
			"input":    []any{},
			"messages": []any{},
		}
		assert.Equal(t, FormatOpenAI, DetectFormat(body3))
	})

	t.Run("DetectFormat_Antigravity", func(t *testing.T) {
		body := map[string]any{
			"userAgent": "antigravity",
			"request": map[string]any{
				"contents": []any{},
			},
		}
		assert.Equal(t, FormatAntigravity, DetectFormat(body))

		// Missing userAgent should not be antigravity; body.request.contents is
		// not detected as gemini (gemini checks body.contents, not body.request.contents),
		// so it falls through to the openai default.
		body2 := map[string]any{
			"request": map[string]any{"contents": []any{}},
		}
		assert.Equal(t, FormatOpenAI, DetectFormat(body2))
	})

	t.Run("DetectFormat_Gemini", func(t *testing.T) {
		body := map[string]any{
			"contents": []any{
				map[string]any{"role": "user", "parts": []any{}},
			},
		}
		assert.Equal(t, FormatGemini, DetectFormat(body))
	})

	t.Run("DetectFormat_OpenAI_Indicators", func(t *testing.T) {
		cases := map[string]map[string]any{
			"stream_options": {"stream_options": map[string]any{}},
			"response_format": {"response_format": map[string]any{"type": "json_object"}},
			"logprobs":        {"logprobs": true},
			"top_logprobs":    {"top_logprobs": 5},
			"n":               {"n": 2},
			"presence_penalty": {"presence_penalty": 0.5},
			"frequency_penalty": {"frequency_penalty": 0.5},
			"logit_bias":      {"logit_bias": map[string]any{}},
			"user":            {"user": "alice"},
		}
		for name, body := range cases {
			body := body
			t.Run(name, func(t *testing.T) {
				assert.Equal(t, FormatOpenAI, DetectFormat(body))
			})
		}
	})

	t.Run("DetectFormat_Claude", func(t *testing.T) {
		// Claude by system field
		body := map[string]any{
			"system": "You are helpful.",
			"messages": []any{
				map[string]any{"role": "user", "content": "hi"},
			},
		}
		assert.Equal(t, FormatClaude, DetectFormat(body))

		// Claude by anthropic_version
		body2 := map[string]any{
			"anthropic_version": "2023-06-01",
			"messages":          []any{},
		}
		assert.Equal(t, FormatClaude, DetectFormat(body2))

		// Claude by image source.base64 (first content must be text for the
		// image check to fire, per open-sse/services/provider.js detection order)
		body3 := map[string]any{
			"messages": []any{
				map[string]any{
					"role": "user",
					"content": []any{
						map[string]any{"type": "text", "text": "look"},
						map[string]any{
							"type": "image",
							"source": map[string]any{
								"type":       "base64",
								"media_type": "image/png",
								"data":       "abc",
							},
						},
					},
				},
			},
		}
		assert.Equal(t, FormatClaude, DetectFormat(body3))

		// Claude by tool_use (first content must be text for the tool check to fire)
		body4 := map[string]any{
			"messages": []any{
				map[string]any{
					"role": "assistant",
					"content": []any{
						map[string]any{"type": "text", "text": "calling"},
						map[string]any{
							"type": "tool_use",
							"id":   "x",
							"name": "f",
						},
					},
				},
			},
		}
		assert.Equal(t, FormatClaude, DetectFormat(body4))

		// Claude by tool_result (first content must be text for the tool check to fire)
		body5 := map[string]any{
			"messages": []any{
				map[string]any{
					"role": "user",
					"content": []any{
						map[string]any{"type": "text", "text": "result"},
						map[string]any{
							"type":        "tool_result",
							"tool_use_id": "x",
						},
					},
				},
			},
		}
		assert.Equal(t, FormatClaude, DetectFormat(body5))
	})

	t.Run("DetectFormat_OpenAI_ImageURL", func(t *testing.T) {
		body := map[string]any{
			"messages": []any{
				map[string]any{
					"role": "user",
					"content": []any{
						map[string]any{
							"type": "image_url",
							"image_url": map[string]any{
								"url": "https://example.com/cat.png",
							},
						},
					},
				},
			},
		}
		assert.Equal(t, FormatOpenAI, DetectFormat(body))
	})

	t.Run("DetectFormat_Default", func(t *testing.T) {
		body := map[string]any{
			"messages": []any{
				map[string]any{"role": "user", "content": "hi"},
			},
		}
		assert.Equal(t, FormatOpenAI, DetectFormat(body))
	})

	t.Run("DetectFormat_NilBody", func(t *testing.T) {
		assert.Equal(t, FormatOpenAI, DetectFormat(nil))
	})
}

func TestGetTargetFormat(t *testing.T) {
	r := &Registry{
		PROVIDERS: map[string]json.RawMessage{
			"openai":    json.RawMessage(`{"format":"openai"}`),
			"claude":    json.RawMessage(`{"format":"claude"}`),
			"gemini":    json.RawMessage(`{"format":"gemini"}`),
			"vertex":    json.RawMessage(`{"format":"gemini"}`),
			"kiro":      json.RawMessage(`{"format":"claude"}`),
			"antigravity": json.RawMessage(`{"format":"antigravity"}`),
		},
	}

	t.Run("OpenAICompatible", func(t *testing.T) {
		assert.Equal(t, FormatOpenAI, GetTargetFormat("openai-compatible-foo", r))
		assert.Equal(t, FormatOpenAIResponses, GetTargetFormat("openai-compatible-responses-foo", r))
	})

	t.Run("AnthropicCompatible", func(t *testing.T) {
		assert.Equal(t, FormatClaude, GetTargetFormat("anthropic-compatible-foo", r))
	})

	t.Run("Named", func(t *testing.T) {
		assert.Equal(t, FormatClaude, GetTargetFormat("claude", r))
		assert.Equal(t, FormatGemini, GetTargetFormat("gemini", r))
		assert.Equal(t, FormatAntigravity, GetTargetFormat("antigravity", r))
	})

	t.Run("Unknown", func(t *testing.T) {
		assert.Equal(t, FormatOpenAI, GetTargetFormat("unknown-provider", r))
		assert.Equal(t, FormatOpenAI, GetTargetFormat("unknown-provider", nil))
	})
}

func TestResolveTransport(t *testing.T) {
	r := &Registry{
		Providers: map[string]Provider{
			"multi": {
				ID: "multi",
				Transports: json.RawMessage(`[
					{"format":"openai","baseUrl":"https://api.example.com/v1"},
					{"format":"claude","baseUrl":"https://api.example.com/claude"}
				]`),
			},
			"single": {
				ID:         "single",
				Transports: json.RawMessage(`[{"format":"openai","baseUrl":"https://x.example.com"}]`),
			},
			"empty": {
				ID: "empty",
			},
		},
	}

	t.Run("MatchByFormat", func(t *testing.T) {
		tr := ResolveTransport("multi", "claude", r)
		require.NotNil(t, tr)
		assert.Equal(t, "claude", tr.Format)
		assert.Equal(t, "https://api.example.com/claude", tr.BaseURL)
	})

	t.Run("FirstMatch", func(t *testing.T) {
		tr := ResolveTransport("multi", "openai", r)
		require.NotNil(t, tr)
		assert.Equal(t, "openai", tr.Format)
		assert.Equal(t, "https://api.example.com/v1", tr.BaseURL)
	})

	t.Run("NoMatchFallsBackToNil", func(t *testing.T) {
		assert.Nil(t, ResolveTransport("multi", "gemini", r))
	})

	t.Run("NoTransportsArray", func(t *testing.T) {
		assert.Nil(t, ResolveTransport("empty", "openai", r))
	})

	t.Run("UnknownProvider", func(t *testing.T) {
		assert.Nil(t, ResolveTransport("nope", "openai", r))
		assert.Nil(t, ResolveTransport("multi", "openai", nil))
	})

	t.Run("SingleTransport", func(t *testing.T) {
		tr := ResolveTransport("single", "openai", r)
		require.NotNil(t, tr)
		assert.Equal(t, "https://x.example.com", tr.BaseURL)
	})
}

func TestThinkingConfigHelpers(t *testing.T) {
	t.Run("HasThinkingConfig_ReasoningEffort", func(t *testing.T) {
		body := map[string]any{"reasoning_effort": "high"}
		assert.True(t, HasThinkingConfig(body))
	})

	t.Run("HasThinkingConfig_ThinkingBlock", func(t *testing.T) {
		body := map[string]any{"thinking": map[string]any{"type": "enabled"}}
		assert.True(t, HasThinkingConfig(body))
	})

	t.Run("HasThinkingConfig_ThinkingBlockDisabled", func(t *testing.T) {
		body := map[string]any{"thinking": map[string]any{"type": "disabled"}}
		assert.False(t, HasThinkingConfig(body))
	})

	t.Run("HasThinkingConfig_NilBody", func(t *testing.T) {
		assert.False(t, HasThinkingConfig(nil))
	})

	t.Run("IsLastMessageFromUser", func(t *testing.T) {
		body := map[string]any{
			"messages": []any{
				map[string]any{"role": "user", "content": "hi"},
				map[string]any{"role": "assistant", "content": "hello"},
			},
		}
		assert.False(t, IsLastMessageFromUser(body))

		body2 := map[string]any{
			"messages": []any{
				map[string]any{"role": "user", "content": "hi"},
			},
		}
		assert.True(t, IsLastMessageFromUser(body2))

		// Empty messages
		body3 := map[string]any{"messages": []any{}}
		assert.True(t, IsLastMessageFromUser(body3))

		// No messages key
		assert.True(t, IsLastMessageFromUser(map[string]any{}))
	})

	t.Run("NormalizeThinkingConfig_StripsWhenLastNotUser", func(t *testing.T) {
		body := map[string]any{
			"thinking": map[string]any{"type": "enabled"},
			"messages": []any{
				map[string]any{"role": "user", "content": "hi"},
				map[string]any{"role": "assistant", "content": "ok"},
			},
		}
		NormalizeThinkingConfig(body)
		_, hasThinking := body["thinking"]
		assert.False(t, hasThinking)
	})

	t.Run("NormalizeThinkingConfig_KeepsWhenLastUser", func(t *testing.T) {
		body := map[string]any{
			"thinking": map[string]any{"type": "enabled"},
			"messages": []any{
				map[string]any{"role": "user", "content": "hi"},
			},
		}
		NormalizeThinkingConfig(body)
		_, hasThinking := body["thinking"]
		assert.True(t, hasThinking)
	})
}
