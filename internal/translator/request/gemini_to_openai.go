package request

import (
	"github.com/9router/9router/internal/translator"
	"github.com/9router/9router/internal/translator/concerns"
	"github.com/9router/9router/internal/translator/formats"
	"github.com/9router/9router/internal/translator/schema"
)

func init() {
	translator.Register(string(translator.FormatGemini), string(translator.FormatOpenAI), geminiToOpenAIRequest, nil)
}

// geminiToOpenAIRequest converts Gemini generateContent format to OpenAI chat completions format.
func geminiToOpenAIRequest(model string, body map[string]any, stream bool, creds any) (map[string]any, error) {
	result := map[string]any{
		"model":    model,
		"messages": []map[string]any{},
		"stream":   stream,
	}

	// Generation config
	if config, ok := body["generationConfig"].(map[string]any); ok {
		if maxOutput, ok := config["maxOutputTokens"]; ok && maxOutput != nil {
			tempBody := map[string]any{"max_tokens": maxOutput, "tools": body["tools"]}
			result["max_tokens"] = formats.AdjustMaxTokens(tempBody)
		}
		if temp, ok := config["temperature"]; ok {
			result["temperature"] = temp
		}
		if topP, ok := config["topP"]; ok {
			result["top_p"] = topP
		}
	}

	var messages []map[string]any

	// System instruction
	if sysInstruction, ok := body["systemInstruction"]; ok {
		if text := extractGeminiText(sysInstruction); text != "" {
			messages = append(messages, map[string]any{
				"role":    schema.RoleSystem,
				"content": text,
			})
		}
	}

	// Convert contents to messages
	if contents, ok := body["contents"].([]any); ok {
		for _, c := range contents {
			if content, ok := c.(map[string]any); ok {
				if converted := convertGeminiContent(content); converted != nil {
					messages = append(messages, converted)
				}
			}
		}
	} else if contents, ok := body["contents"].([]map[string]any); ok {
		for _, content := range contents {
			if converted := convertGeminiContent(content); converted != nil {
				messages = append(messages, converted)
			}
		}
	}

	result["messages"] = messages

	// Tools
	if tools, ok := body["tools"].([]any); ok {
		result["tools"] = convertGeminiTools(tools)
	} else if tools, ok := body["tools"].([]map[string]any); ok {
		result["tools"] = convertGeminiToolsMap(tools)
	}

	return result, nil
}

// convertGeminiContent converts a single Gemini content entry to an OpenAI message.
func convertGeminiContent(content map[string]any) map[string]any {
	role := schema.RoleAssistant
	if r, _ := content["role"].(string); r == schema.GeminiRoleUser {
		role = schema.RoleUser
	}

	parts, ok := content["parts"].([]any)
	if !ok {
		return nil
	}

	var textParts []map[string]any
	var toolCalls []map[string]any

	for _, p := range parts {
		part, ok := p.(map[string]any)
		if !ok {
			continue
		}

		// Text part
		if text, ok := part["text"].(string); ok {
			textParts = append(textParts, map[string]any{
				"type": schema.OpenAIBlockTypeText,
				"text": text,
			})
		}

		// Inline data (image)
		if inlineData, ok := part["inlineData"].(map[string]any); ok {
			mime, _ := inlineData["mimeType"].(string)
			data, _ := inlineData["data"].(string)
			textParts = append(textParts, map[string]any{
				"type": schema.OpenAIBlockTypeImageURL,
				"image_url": map[string]any{
					"url": concerns.EncodeDataUri(mime, data),
				},
			})
		}

		// Function call
		if fc, ok := part["functionCall"].(map[string]any); ok {
			name, _ := fc["name"].(string)
			args := fc["args"]
			if args == nil {
				args = map[string]any{}
			}
			id, _ := fc["id"].(string)
			if id == "" {
				id = "call_" + name
			}
			toolCalls = append(toolCalls, map[string]any{
				"id":   id,
				"type": schema.OpenAIBlockTypeFunction,
				"function": map[string]any{
					"name":      name,
					"arguments": concerns.MarshalJSON(args),
				},
			})
		}

		// Function response → tool message
		if fr, ok := part["functionResponse"].(map[string]any); ok {
			name, _ := fr["name"].(string)
			id, _ := fr["id"].(string)
			if id == "" {
				id = "call_" + name
			}
			response := fr["response"]
			if response == nil {
				response = map[string]any{}
			}
			// Extract result from response
			resultContent := response
			if respMap, ok := response.(map[string]any); ok {
				if result, ok := respMap["result"]; ok {
					resultContent = result
				}
			}
			return map[string]any{
				"role":         schema.RoleTool,
				"tool_call_id": id,
				"content":      concerns.MarshalJSON(resultContent),
			}
		}
	}

	// If there are tool calls, return assistant message with tool_calls
	if len(toolCalls) > 0 {
		result := map[string]any{"role": schema.RoleAssistant}
		if len(textParts) > 0 {
			if len(textParts) == 1 {
				result["content"] = textParts[0]["text"]
			} else {
				result["content"] = textParts
			}
		}
		result["tool_calls"] = toolCalls
		return result
	}

	if len(textParts) > 0 {
		return map[string]any{
			"role":    role,
			"content": concerns.CollapseTextParts(textParts),
		}
	}

	return nil
}

// extractGeminiText extracts text from a Gemini systemInstruction or content block.
func extractGeminiText(content any) string {
	switch v := content.(type) {
	case string:
		return v
	case map[string]any:
		if parts, ok := v["parts"].([]any); ok {
			var texts []string
			for _, p := range parts {
				if m, ok := p.(map[string]any); ok {
					if t, ok := m["text"].(string); ok {
						texts = append(texts, t)
					}
				}
			}
			return joinStr(texts, "")
		}
	}
	return ""
}

// convertGeminiTools converts Gemini tools to OpenAI format.
func convertGeminiTools(tools []any) []map[string]any {
	var out []map[string]any
	for _, t := range tools {
		if m, ok := t.(map[string]any); ok {
			if decls, ok := m["functionDeclarations"].([]any); ok {
				for _, d := range decls {
					if fd, ok := d.(map[string]any); ok {
						out = append(out, convertGeminiFuncDecl(fd))
					}
				}
			}
		}
	}
	return out
}

// convertGeminiToolsMap converts Gemini tools ([]map[string]any) to OpenAI format.
func convertGeminiToolsMap(tools []map[string]any) []map[string]any {
	var out []map[string]any
	for _, m := range tools {
		if decls, ok := m["functionDeclarations"].([]any); ok {
			for _, d := range decls {
				if fd, ok := d.(map[string]any); ok {
					out = append(out, convertGeminiFuncDecl(fd))
				}
			}
		}
	}
	return out
}

// convertGeminiFuncDecl converts a Gemini functionDeclaration to an OpenAI tool.
func convertGeminiFuncDecl(fd map[string]any) map[string]any {
	name, _ := fd["name"].(string)
	desc, _ := fd["description"].(string)
	params := fd["parameters"]
	if params == nil {
		params = map[string]any{"type": "object", "properties": map[string]any{}}
	}
	return map[string]any{
		"type": schema.OpenAIBlockTypeFunction,
		"function": map[string]any{
			"name":        name,
			"description": desc,
			"parameters":  params,
		},
	}
}

func joinStr(parts []string, sep string) string {
	if len(parts) == 0 {
		return ""
	}
	result := parts[0]
	for _, p := range parts[1:] {
		result += sep + p
	}
	return result
}
