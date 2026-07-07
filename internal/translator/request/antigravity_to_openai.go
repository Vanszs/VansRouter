package request

import (
	"strings"

	"github.com/9router/9router/internal/translator"
	"github.com/9router/9router/internal/translator/concerns"
	"github.com/9router/9router/internal/translator/formats"
	"github.com/9router/9router/internal/translator/schema"
)

func init() {
	translator.Register(string(translator.FormatAntigravity), string(translator.FormatOpenAI), antigravityToOpenAIRequest, nil)
}

func antigravityToOpenAIRequest(model string, body map[string]any, stream bool, creds any) (map[string]any, error) {
	req := body
	if r, ok := body["request"].(map[string]any); ok {
		req = r
	}

	result := map[string]any{
		"model":    model,
		"messages": []map[string]any{},
		"stream":   stream,
	}

	// Generation config
	if gc, ok := req["generationConfig"].(map[string]any); ok {
		if mot, ok := gc["maxOutputTokens"].(float64); ok {
			result["max_tokens"] = formats.AdjustMaxTokens(map[string]any{"max_tokens": int(mot), "tools": req["tools"]})
		}
		if temp, ok := gc["temperature"].(float64); ok {
			result["temperature"] = temp
		}
		if topP, ok := gc["topP"].(float64); ok {
			result["top_p"] = topP
		}
	}

	// System instruction
	if si, ok := req["systemInstruction"]; ok {
		systemText := extractAntigravityText(si)
		if systemText != "" {
			result["messages"] = append(result["messages"].([]map[string]any), map[string]any{
				"role":    schema.RoleSystem,
				"content": systemText,
			})
		}
	}

	// Convert contents to messages
	if contents, ok := req["contents"].([]any); ok {
		msgs := result["messages"].([]map[string]any)
		for _, c := range contents {
			if content, ok := c.(map[string]any); ok {
				converted := convertAntigravityContent(content)
				if converted != nil {
					msgs = append(msgs, converted...)
				}
			}
		}
		result["messages"] = msgs
	}

	// Tools
	if tools, ok := req["tools"].([]any); ok && len(tools) > 0 {
		var resultTools []map[string]any
		for _, t := range tools {
			tool, ok := t.(map[string]any)
			if !ok {
				continue
			}
			if fds, ok := tool["functionDeclarations"].([]any); ok {
				for _, fd := range fds {
					if fn, ok := fd.(map[string]any); ok {
						params := normalizeSchemaTypes(fn["parameters"])
						if params == nil {
							params = map[string]any{"type": "object", "properties": map[string]any{}}
						}
						resultTools = append(resultTools, map[string]any{
							"type": schema.OpenAIBlockTypeFunction,
							"function": map[string]any{
								"name":        stringOr(fn["name"], ""),
								"description": stringOr(fn["description"], ""),
								"parameters":  params,
							},
						})
					}
				}
			}
		}
		if len(resultTools) > 0 {
			result["tools"] = resultTools
		}
	}

	return result, nil
}

func extractAntigravityText(instruction any) string {
	if s, ok := instruction.(string); ok {
		return s
	}
	m, ok := instruction.(map[string]any)
	if !ok {
		return ""
	}
	if parts, ok := m["parts"].([]any); ok {
		var texts []string
		for _, p := range parts {
			if part, ok := p.(map[string]any); ok {
				if t, ok := part["text"].(string); ok {
					texts = append(texts, t)
				}
			}
		}
		return strings.Join(texts, "")
	}
	return ""
}

func convertAntigravityContent(content map[string]any) []map[string]any {
	role, _ := content["role"].(string)
	if role == schema.GeminiRoleModel {
		role = schema.RoleAssistant
	} else if role == schema.GeminiRoleUser {
		role = schema.RoleUser
	}

	parts, ok := content["parts"].([]any)
	if !ok {
		return nil
	}

	var textParts []map[string]any
	var toolCalls []map[string]any
	var toolResults []map[string]any
	var reasoningContent string

	for _, p := range parts {
		part, ok := p.(map[string]any)
		if !ok {
			continue
		}

		// Thinking content
		if thought, _ := part["thought"].(bool); thought {
			if t, ok := part["text"].(string); ok {
				reasoningContent += t
			}
			continue
		}

		// Text with thoughtSignature
		if part["thoughtSignature"] != nil {
			if t, ok := part["text"].(string); ok {
				textParts = append(textParts, map[string]any{"type": schema.OpenAIBlockTypeText, "text": t})
			}
			continue
		}

		// Regular text
		if t, ok := part["text"].(string); ok {
			textParts = append(textParts, map[string]any{"type": schema.OpenAIBlockTypeText, "text": t})
		}

		// Inline data
		if inlineData, ok := part["inlineData"].(map[string]any); ok {
			mimeType, _ := inlineData["mimeType"].(string)
			data, _ := inlineData["data"].(string)
			textParts = append(textParts, map[string]any{
				"type":      schema.OpenAIBlockTypeImageURL,
				"image_url": map[string]any{"url": concerns.EncodeDataUri(mimeType, data)},
			})
		}

		// Function call
		if fc, ok := part["functionCall"].(map[string]any); ok {
			id := stringOr(fc["id"], "call_"+stringOr(fc["name"], ""))
			toolCalls = append(toolCalls, map[string]any{
				"id":   id,
				"type": schema.OpenAIBlockTypeFunction,
				"function": map[string]any{
					"name":      stringOr(fc["name"], ""),
					"arguments": concerns.MarshalJSON(fc["args"]),
				},
			})
		}

		// Function response
		if fr, ok := part["functionResponse"].(map[string]any); ok {
			id := stringOr(fr["id"], "call_"+stringOr(fr["name"], ""))
			respContent := fr["response"]
			if resp, ok := respContent.(map[string]any); ok {
				if r, ok := resp["result"]; ok {
					respContent = r
				}
			}
			toolResults = append(toolResults, map[string]any{
				"role":          schema.RoleTool,
				"tool_call_id":  id,
				"content":       concerns.MarshalJSON(respContent),
			})
		}
	}

	if len(toolResults) > 0 {
		return toolResults
	}

	if len(toolCalls) > 0 {
		msg := map[string]any{"role": schema.RoleAssistant}
		if len(textParts) > 0 {
			msg["content"] = concerns.CollapseTextParts(textParts)
		}
		if reasoningContent != "" {
			msg["reasoning_content"] = reasoningContent
		}
		msg["tool_calls"] = toolCalls
		return []map[string]any{msg}
	}

	if len(textParts) > 0 || reasoningContent != "" {
		msg := map[string]any{"role": role}
		if len(textParts) > 0 {
			msg["content"] = concerns.CollapseTextParts(textParts)
		}
		if reasoningContent != "" {
			msg["reasoning_content"] = reasoningContent
		}
		return []map[string]any{msg}
	}

	return nil
}

func normalizeSchemaTypes(s any) map[string]any {
	if s == nil {
		return nil
	}
	m, ok := s.(map[string]any)
	if !ok {
		return nil
	}
	result := make(map[string]any, len(m))
	for k, v := range m {
		if k == "enumDescriptions" {
			continue
		}
		if k == "type" {
			if ts, ok := v.(string); ok {
				result[k] = strings.ToLower(ts)
				continue
			}
		}
		if k == "properties" {
			if props, ok := v.(map[string]any); ok {
				normalized := make(map[string]any, len(props))
				for pk, pv := range props {
					normalized[pk] = normalizeSchemaTypes(pv)
				}
				result[k] = normalized
				continue
			}
		}
		if k == "items" {
			result[k] = normalizeSchemaTypes(v)
			continue
		}
		result[k] = v
	}
	return result
}
