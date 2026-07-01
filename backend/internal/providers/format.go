package providers

import (
	"encoding/json"
	"strings"
)

// Format identifiers used by both detection and resolution.
const (
	FormatOpenAI          = "openai"
	FormatClaude          = "claude"
	FormatGemini          = "gemini"
	FormatAntigravity     = "antigravity"
	FormatOpenAIResponses = "openai-responses"
)

// Compatibility provider ID prefixes.
const (
	openAICompatiblePrefix     = "openai-compatible-"
	anthropicCompatiblePrefix  = "anthropic-compatible-"
)

// OpenAI-compatible API variants (chat vs responses).
const (
	openAICompatibleChat      = "chat"
	openAICompatibleResponses = "responses"
)

// Transport describes a single endpoint variant exposed by a provider
// (e.g. one for chat-format requests and another for responses-format).
type Transport struct {
	Format     string          `json:"format"`
	BaseURL    string          `json:"baseUrl"`
	APIKey     json.RawMessage `json:"apiKey"`
	AuthType   string          `json:"authType"`
	EndpointID string          `json:"endpointId"`
	Quirks     json.RawMessage `json:"quirks"`
}

func parseTransports(raw json.RawMessage) []Transport {
	if len(raw) == 0 {
		return nil
	}
	var transports []Transport
	if err := json.Unmarshal(raw, &transports); err != nil {
		return nil
	}
	return transports
}

// IsOpenAICompatible reports whether the provider id is an openai-compatible-* variant.
func IsOpenAICompatible(provider string) bool {
	return strings.HasPrefix(provider, openAICompatiblePrefix)
}

// IsAnthropicCompatible reports whether the provider id is an anthropic-compatible-* variant.
func IsAnthropicCompatible(provider string) bool {
	return strings.HasPrefix(provider, anthropicCompatiblePrefix)
}

// GetOpenAICompatibleType returns the API variant for an openai-compatible provider:
// "chat" for the chat completions endpoint, "responses" for the responses endpoint.
func GetOpenAICompatibleType(provider string) string {
	if !IsOpenAICompatible(provider) {
		return openAICompatibleChat
	}
	if strings.Contains(provider, "responses") {
		return openAICompatibleResponses
	}
	return openAICompatibleChat
}

// DetectFormat inspects a request body and returns the source format identifier.
// Detection order follows open-sse/services/provider.js:
//   1. openai-responses (body.input without body.messages)
//   2. antigravity (body.request.contents + userAgent)
//   3. gemini (body.contents array)
//   4. openai (OpenAI-specific fields like response_format, logprobs, n, presence_penalty, ...)
//   5. claude (body.system / anthropic_version, Claude content blocks)
//   6. openai (default)
func DetectFormat(body map[string]any) string {
	if body == nil {
		return FormatOpenAI
	}

	if _, hasInput := body["input"]; hasInput && body["messages"] == nil {
		if v, ok := body["input"]; ok {
			if _, isArr := v.([]any); isArr {
				return FormatOpenAIResponses
			}
			if _, isStr := v.(string); isStr {
				return FormatOpenAIResponses
			}
		}
	}

	if req, ok := body["request"].(map[string]any); ok {
		if _, hasContents := req["contents"]; hasContents {
			if ua, _ := body["userAgent"].(string); ua == "antigravity" {
				return FormatAntigravity
			}
		}
	}

	if contents, ok := body["contents"]; ok {
		if _, isArr := contents.([]any); isArr {
			return FormatGemini
		}
	}

	openAISpecific := []string{
		"stream_options", "response_format", "logit_bias", "user",
	}
	for _, key := range openAISpecific {
		if _, ok := body[key]; ok {
			return FormatOpenAI
		}
	}
	for _, key := range []string{"logprobs", "top_logprobs", "n", "presence_penalty", "frequency_penalty"} {
		if _, ok := body[key]; ok {
			return FormatOpenAI
		}
	}

	if msgs, ok := body["messages"].([]any); ok && len(msgs) > 0 {
		if first, ok := msgs[0].(map[string]any); ok {
			if content, ok := first["content"].([]any); ok && len(content) > 0 {
				if firstContent, ok := content[0].(map[string]any); ok {
					if t, _ := firstContent["type"].(string); t == "text" {
						if _, hasSystem := body["system"]; hasSystem {
							return FormatClaude
						}
						if _, hasVer := body["anthropic_version"]; hasVer {
							return FormatClaude
						}
						model, _ := body["model"].(string)
						if strings.Contains(model, "/") {
							// skip — model hints at OpenAI providers
						}
						for _, item := range content {
							if m, ok := item.(map[string]any); ok {
								t, _ := m["type"].(string)
								if t == "image" {
									if src, ok := m["source"].(map[string]any); ok {
										if st, _ := src["type"].(string); st == "base64" {
											return FormatClaude
										}
									}
								}
								if t == "image_url" {
									if iu, ok := m["image_url"].(map[string]any); ok {
										if _, ok := iu["url"].(string); ok {
											return FormatOpenAI
										}
									}
								}
								if t == "tool_use" || t == "tool_result" {
									return FormatClaude
								}
							}
						}
					}
				}
			}
		}
	}

	if _, hasSystem := body["system"]; hasSystem {
		return FormatClaude
	}
	if _, hasVer := body["anthropic_version"]; hasVer {
		return FormatClaude
	}

	return FormatOpenAI
}

// GetTargetFormat returns the upstream format expected by the given provider.
// For compatibility prefixes it derives the format from the provider id.
// For named providers it reads the format field from the PROVIDERS map in the registry.
// Falls back to OpenAI when the provider is unknown.
func GetTargetFormat(provider string, r *Registry) string {
	if IsOpenAICompatible(provider) {
		if GetOpenAICompatibleType(provider) == openAICompatibleResponses {
			return FormatOpenAIResponses
		}
		return FormatOpenAI
	}
	if IsAnthropicCompatible(provider) {
		return FormatClaude
	}
	if r != nil {
		if raw, ok := r.PROVIDERS[provider]; ok {
			var p struct {
				Format string `json:"format"`
			}
			if err := json.Unmarshal(raw, &p); err == nil && p.Format != "" {
				return p.Format
			}
		}
	}
	return FormatOpenAI
}

// ResolveTransport picks a transport entry from the provider's `transports` array
// that matches the client source format. Returns nil when the provider has no
// transports array or no entry matches (callers fall back to the default transport).
func ResolveTransport(provider string, sourceFormat string, r *Registry) *Transport {
	if r == nil {
		return nil
	}
	p, ok := r.Providers[provider]
	if !ok {
		return nil
	}
	transports := parseTransports(p.Transports)
	for i := range transports {
		if transports[i].Format == sourceFormat {
			return &transports[i]
		}
	}
	return nil
}

// IsLastMessageFromUser reports whether the last message in the conversation
// is from the user. Used to decide when to strip thinking config.
func IsLastMessageFromUser(body map[string]any) bool {
	messages := body["messages"]
	if messages == nil {
		messages = body["contents"]
	}
	arr, ok := messages.([]any)
	if !ok || len(arr) == 0 {
		return true
	}
	last, ok := arr[len(arr)-1].(map[string]any)
	if !ok {
		return true
	}
	role, _ := last["role"].(string)
	return role == "user"
}

// HasThinkingConfig reports whether the body carries a thinking/reasoning config.
func HasThinkingConfig(body map[string]any) bool {
	if body == nil {
		return false
	}
	if _, ok := body["reasoning_effort"]; ok {
		return true
	}
	if t, ok := body["thinking"].(map[string]any); ok {
		if tp, _ := t["type"].(string); tp == "enabled" {
			return true
		}
	}
	return false
}

// NormalizeThinkingConfig removes thinking config when the last message is not from
// the user. Mirrors open-sse/services/provider.js#normalizeThinkingConfig.
func NormalizeThinkingConfig(body map[string]any) map[string]any {
	if body == nil {
		return nil
	}
	if !IsLastMessageFromUser(body) {
		delete(body, "thinking")
	}
	return body
}
