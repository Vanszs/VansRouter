package request

import (
	"github.com/9router/9router/internal/translator"
	"github.com/9router/9router/internal/translator/concerns"
	"github.com/9router/9router/internal/translator/formats"
	"github.com/9router/9router/internal/translator/schema"
)

// ponytail: Ollama supports tools in OpenAI format, so we pass them through with minimal conversion.

func init() {
	translator.Register(string(translator.FormatOpenAI), string(translator.FormatOllama), openaiToOllamaRequest, nil)
}

func openaiToOllamaRequest(model string, body map[string]any, stream bool, creds any) (map[string]any, error) {
	result := map[string]any{
		"model":    model,
		"messages": normalizeOllamaMessages(body["messages"]),
		"stream":   stream,
	}

	// Options object for Ollama-specific parameters
	var options map[string]any

	// Temperature
	if temp, ok := body["temperature"].(float64); ok {
		if options == nil {
			options = map[string]any{}
		}
		options["temperature"] = temp
	} else if temp, ok := body["temperature"].(int); ok {
		if options == nil {
			options = map[string]any{}
		}
		options["temperature"] = float64(temp)
	}

	// Max tokens (Ollama uses num_predict)
	if maxTokens := formats.AdjustMaxTokens(body); maxTokens > 0 {
		if options == nil {
			options = map[string]any{}
		}
		options["num_predict"] = maxTokens
	}

	// Top_p
	if topP, ok := body["top_p"].(float64); ok {
		if options == nil {
			options = map[string]any{}
		}
		options["top_p"] = topP
	} else if topP, ok := body["top_p"].(int); ok {
		if options == nil {
			options = map[string]any{}
		}
		options["top_p"] = float64(topP)
	}

	if options != nil {
		result["options"] = options
	}

	// Tools (Ollama supports tools in OpenAI format)
	if tools, ok := body["tools"].([]any); ok && len(tools) > 0 {
		result["tools"] = tools
	} else if tools, ok := body["tools"].([]map[string]any); ok && len(tools) > 0 {
		result["tools"] = tools
	}

	// Tool choice
	if tc, ok := body["tool_choice"]; ok && tc != nil {
		result["tool_choice"] = tc
	}

	return result, nil
}

// normalizeOllamaMessages converts OpenAI messages to Ollama format.
// Ollama requires:
// - content as string (not array)
// - tool messages use tool_name instead of tool_call_id
// - images extracted from multimodal content blocks
func normalizeOllamaMessages(messages any) []map[string]any {
	var msgs []map[string]any

	if arr, ok := messages.([]any); ok {
		for _, m := range arr {
			if msg, ok := m.(map[string]any); ok {
				msgs = append(msgs, msg)
			}
		}
	} else if arr, ok := messages.([]map[string]any); ok {
		msgs = arr
	}

	if len(msgs) == 0 {
		return msgs
	}

	var result []map[string]any

	// First pass: build tool_call_id -> tool_name map from assistant messages
	toolCallMap := map[string]string{}
	for _, msg := range msgs {
		if role, _ := msg["role"].(string); role == schema.RoleAssistant {
			if tcs, ok := msg["tool_calls"].([]any); ok {
				for _, tc := range tcs {
					if m, ok := tc.(map[string]any); ok {
						if id, _ := m["id"].(string); id != "" {
							if fn, ok := m["function"].(map[string]any); ok {
								if name, _ := fn["name"].(string); name != "" {
									toolCallMap[id] = name
								}
							}
						}
					}
				}
			} else if tcs, ok := msg["tool_calls"].([]map[string]any); ok {
				for _, m := range tcs {
					if id, _ := m["id"].(string); id != "" {
						if fn, ok := m["function"].(map[string]any); ok {
							if name, _ := fn["name"].(string); name != "" {
								toolCallMap[id] = name
							}
						}
					}
				}
			}
		}
	}

	// Second pass: convert messages
	for _, msg := range msgs {
		role, _ := msg["role"].(string)

		// Handle tool result messages
		if role == schema.RoleTool {
			toolResult := normalizeOllamaContent(msg["content"])
			if toolResult == "" {
				continue
			}

			// Get tool_name from map or use msg.name as fallback
			toolCallID, _ := msg["tool_call_id"].(string)
			toolName := toolCallMap[toolCallID]
			if toolName == "" {
				if name, ok := msg["name"].(string); ok {
					toolName = name
				} else {
					toolName = "unknown_tool"
				}
			}

			result = append(result, map[string]any{
				"role":      schema.RoleTool,
				"tool_name": toolName,
				"content":   toolResult,
			})
			continue
		}

		// Handle assistant messages with tool_calls
		if role == schema.RoleAssistant {
			if _, hasToolCalls := msg["tool_calls"]; hasToolCalls {
				content := normalizeOllamaContent(msg["content"])
				ollamaToolCalls := convertOllamaToolCalls(msg["tool_calls"])

				result = append(result, map[string]any{
					"role":       schema.RoleAssistant,
					"content":    content,
					"tool_calls": ollamaToolCalls,
				})
				continue
			}
		}

		// Normal messages
		content := normalizeOllamaContent(msg["content"])
		images := extractOllamaImages(msg["content"])

		// Skip empty messages (except assistant)
		if content == "" && role != schema.RoleAssistant {
			continue
		}

		out := map[string]any{
			"role":    role,
			"content": content,
		}

		if len(images) > 0 {
			out["images"] = images
		}

		result = append(result, out)
	}

	return result
}

// normalizeOllamaContent converts content to string for Ollama.
func normalizeOllamaContent(content any) string {
	if text, ok := content.(string); ok {
		return text
	}

	if arr, ok := content.([]any); ok {
		var texts []string
		for _, item := range arr {
			if m, ok := item.(map[string]any); ok {
				if m["type"] == schema.OpenAIBlockTypeText {
					if t, ok := m["text"].(string); ok {
						texts = append(texts, t)
					}
				}
			}
		}
		return concerns.ExtractTextContent(arr, "\n")
	}

	if arr, ok := content.([]map[string]any); ok {
		var texts []string
		for _, m := range arr {
			if m["type"] == schema.OpenAIBlockTypeText {
				if t, ok := m["text"].(string); ok {
					texts = append(texts, t)
				}
			}
		}
		return concerns.ExtractTextContent(arr, "\n")
	}

	return ""
}

// extractOllamaImages extracts base64 images from OpenAI multimodal content.
// Ollama expects raw base64 strings in message.images[].
func extractOllamaImages(content any) []string {
	arr, ok := content.([]any)
	if !ok {
		return []string{}
	}

	var images []string
	for _, item := range arr {
		m, ok := item.(map[string]any)
		if !ok {
			continue
		}
		if m["type"] != schema.OpenAIBlockTypeImageURL {
			continue
		}

		url := ""
		if iu, ok := m["image_url"].(map[string]any); ok {
			if u, ok := iu["url"].(string); ok {
				url = u
			}
		} else if u, ok := m["image_url"].(string); ok {
			url = u
		}

		if url == "" {
			continue
		}

		if parsed := concerns.ParseDataUri(url); parsed != nil {
			images = append(images, parsed.Base64)
		}
	}

	return images
}

// convertOllamaToolCalls converts OpenAI tool_calls to Ollama format.
// Ollama expects arguments as parsed JSON object, not string.
func convertOllamaToolCalls(toolCalls any) []map[string]any {
	var tcs []map[string]any

	if arr, ok := toolCalls.([]any); ok {
		for _, tc := range arr {
			if m, ok := tc.(map[string]any); ok {
				tcs = append(tcs, m)
			}
		}
	} else if arr, ok := toolCalls.([]map[string]any); ok {
		tcs = arr
	}

	var result []map[string]any
	for _, tc := range tcs {
		fn := map[string]any{}
		if f, ok := tc["function"].(map[string]any); ok {
			fn = f
		}

		index := 0
		if idx, ok := tc["index"].(int); ok {
			index = idx
		} else if idx, ok := tc["index"].(float64); ok {
			index = int(idx)
		}

		name, _ := fn["name"].(string)

		// Convert arguments: if string, parse to object; if already object, use as-is
		var args any
		if argsStr, ok := fn["arguments"].(string); ok {
			args = concerns.SafeParseJSON(argsStr, argsStr)
		} else if fn["arguments"] != nil {
			args = fn["arguments"]
		} else {
			args = map[string]any{}
		}

		result = append(result, map[string]any{
			"type": schema.OpenAIBlockTypeFunction,
			"function": map[string]any{
				"index":     index,
				"name":      name,
				"arguments": args,
			},
		})
	}

	return result
}
