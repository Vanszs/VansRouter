package request

import (
	"strings"

	"github.com/9router/9router/internal/translator"
	"github.com/9router/9router/internal/translator/concerns"
	"github.com/9router/9router/internal/translator/formats"
	"github.com/9router/9router/internal/translator/schema"
)

const maxCallIDLen = 64

func init() {
	translator.Register(string(translator.FormatOpenAIResponses), string(translator.FormatOpenAI), openaiResponsesToOpenAIRequest, nil)
	translator.Register(string(translator.FormatOpenAI), string(translator.FormatOpenAIResponses), openaiToOpenAIResponsesRequest, nil)
}

// openaiResponsesToOpenAIRequest converts Responses API format (input[]) to Chat Completions (messages[])
func openaiResponsesToOpenAIRequest(model string, body map[string]any, stream bool, creds any) (map[string]any, error) {
	if body["input"] == nil {
		return body, nil
	}

	result := copyMap(body)
	result["messages"] = []map[string]any{}

	// Convert instructions to system message
	if instructions, ok := body["instructions"].(string); ok && instructions != "" {
		result["messages"] = append(result["messages"].([]map[string]any), map[string]any{
			"role":    schema.RoleSystem,
			"content": instructions,
		})
	}

	inputItems := normalizeResponsesInput(body["input"])
	if inputItems == nil {
		return body, nil
	}

	var messages []map[string]any
	var currentAssistantMsg map[string]any
	var pendingReasoning string

	for _, item := range inputItems {
		itemType, _ := item["type"].(string)
		if itemType == "" {
			if _, ok := item["role"]; ok {
				itemType = schema.ResponsesItemTypeMessage
			}
		}

		switch itemType {
		case schema.ResponsesItemTypeMessage:
			if currentAssistantMsg != nil {
				messages = append(messages, currentAssistantMsg)
				currentAssistantMsg = nil
			}
			content := convertResponsesContent(item["content"])
			msg := map[string]any{
				"role":    item["role"],
				"content": content,
			}
			if role, _ := item["role"].(string); role == schema.RoleAssistant && pendingReasoning != "" {
				msg["reasoning_content"] = pendingReasoning
			}
			pendingReasoning = ""
			messages = append(messages, msg)

		case schema.ResponsesItemTypeFunctionCall:
			if currentAssistantMsg == nil {
				currentAssistantMsg = map[string]any{
					"role":       schema.RoleAssistant,
					"content":    nil,
					"tool_calls": []map[string]any{},
				}
				if pendingReasoning != "" {
					currentAssistantMsg["reasoning_content"] = pendingReasoning
					pendingReasoning = ""
				}
			}
			name, _ := item["name"].(string)
			if name == "" || strings.TrimSpace(name) == "" {
				continue
			}
			callId, _ := item["call_id"].(string)
			args, _ := item["arguments"].(string)
			tcs := currentAssistantMsg["tool_calls"].([]map[string]any)
			tcs = append(tcs, map[string]any{
				"id":   clampCallId(callId),
				"type": schema.OpenAIBlockTypeFunction,
				"function": map[string]any{
					"name":      name,
					"arguments": args,
				},
			})
			currentAssistantMsg["tool_calls"] = tcs

		case schema.ResponsesItemTypeFunctionCallOutput:
			if currentAssistantMsg != nil {
				messages = append(messages, currentAssistantMsg)
				currentAssistantMsg = nil
			}
			callId, _ := item["call_id"].(string)
			output := item["output"]
			if s, ok := output.(string); ok {
				// already string
				_ = s
			} else {
				output = concerns.MarshalJSON(output)
			}
			messages = append(messages, map[string]any{
				"role":         schema.RoleTool,
				"tool_call_id": clampCallId(callId),
				"content":      output,
			})

		case schema.ResponsesItemTypeReasoning:
			txt := extractResponsesReasoning(item)
			if txt != "" {
				if pendingReasoning != "" {
					pendingReasoning += "\n" + txt
				} else {
					pendingReasoning = txt
				}
			}
		}
	}

	if currentAssistantMsg != nil {
		messages = append(messages, currentAssistantMsg)
	}

	result["messages"] = messages

	// Convert tools format
	if tools, ok := body["tools"].([]any); ok {
		var resultTools []map[string]any
		for _, t := range tools {
			tool, ok := t.(map[string]any)
			if !ok {
				continue
			}
			if tool["function"] != nil {
				resultTools = append(resultTools, tool)
				continue
			}
			name, _ := tool["name"].(string)
			if name == "" || strings.TrimSpace(name) == "" {
				continue
			}
			params := normalizeToolParameters(tool["parameters"])
			resultTools = append(resultTools, map[string]any{
				"type": schema.OpenAIBlockTypeFunction,
				"function": map[string]any{
					"name":        name,
					"description": stringOr(tool["description"], ""),
					"parameters":  params,
					"strict":      tool["strict"],
				},
			})
		}
		if len(resultTools) > 0 {
			result["tools"] = resultTools
		}
	}

	// Map max_output_tokens to max_tokens
	if mo, ok := body["max_output_tokens"]; ok {
		if result["max_tokens"] == nil {
			result["max_tokens"] = mo
		}
	}
	delete(result, "input")
	delete(result, "instructions")
	delete(result, "include")
	delete(result, "prompt_cache_key")
	delete(result, "store")
	delete(result, "reasoning")

	return result, nil
}

// openaiToOpenAIResponsesRequest converts Chat Completions (messages[]) to Responses API (input[])
func openaiToOpenAIResponsesRequest(model string, body map[string]any, stream bool, creds any) (map[string]any, error) {
	if body["input"] != nil {
		result := copyMap(body)
		result["model"] = model
		result["stream"] = true
		return result, nil
	}

	result := map[string]any{
		"model":  model,
		"input":  []map[string]any{},
		"stream": true,
		"store":  false,
	}

	hasSystemMessage := false
	var rawMsgs []map[string]any
	if msgs, ok := body["messages"].([]any); ok {
		for _, m := range msgs {
			if msg, ok := m.(map[string]any); ok {
				rawMsgs = append(rawMsgs, msg)
			}
		}
	} else if msgs, ok := body["messages"].([]map[string]any); ok {
		rawMsgs = msgs
	}

	for _, msg := range rawMsgs {
		role, _ := msg["role"].(string)

		if role == schema.RoleSystem {
			if !hasSystemMessage {
				if s, ok := msg["content"].(string); ok {
					result["instructions"] = s
				} else {
					result["instructions"] = ""
				}
				hasSystemMessage = true
			}
			continue
		}

		if role == schema.RoleUser || role == schema.RoleAssistant {
			contentType := schema.ResponsesItemTypeInputText
			if role == schema.RoleAssistant {
				contentType = schema.ResponsesItemTypeOutputText
			}
			var content []map[string]any
			if s, ok := msg["content"].(string); ok {
				content = []map[string]any{{"type": contentType, "text": s}}
			} else if arr, ok := msg["content"].([]any); ok {
				for _, c := range arr {
					if part, ok := c.(map[string]any); ok {
						if pt, _ := part["type"].(string); pt == schema.OpenAIBlockTypeText {
							if t, ok := part["text"].(string); ok {
								content = append(content, map[string]any{"type": contentType, "text": t})
							}
						} else if pt == schema.OpenAIBlockTypeImageURL {
							iu, _ := part["image_url"].(map[string]any)
							url := ""
							if s, ok := iu["url"].(string); ok {
								url = s
							}
							detail := "auto"
							if d, ok := iu["detail"].(string); ok {
								detail = d
							}
							content = append(content, map[string]any{"type": schema.ResponsesItemTypeInputImage, "image_url": url, "detail": detail})
						}
					}
				}
			}

			if len(content) > 0 {
				input := result["input"].([]map[string]any)
				input = append(input, map[string]any{
					"type":    schema.ResponsesItemTypeMessage,
					"role":    role,
					"content": content,
				})
				result["input"] = input
			}
		}

		// Convert tool calls
		if role == schema.RoleAssistant {
			if tcs, ok := msg["tool_calls"].([]any); ok {
				input := result["input"].([]map[string]any)
				for _, tc := range tcs {
					if m, ok := tc.(map[string]any); ok {
						fn, _ := m["function"].(map[string]any)
						if fn == nil {
							fn = map[string]any{}
						}
						input = append(input, map[string]any{
							"type":      schema.ResponsesItemTypeFunctionCall,
							"call_id":   clampCallId(stringOr(m["id"], "")),
							"name":      stringOr(fn["name"], "_unknown"),
							"arguments": stringOr(fn["arguments"], "{}"),
						})
					}
				}
				result["input"] = input
			}
		}

		// Convert tool results
		if role == schema.RoleTool {
			output := ""
			if s, ok := msg["content"].(string); ok {
				output = s
			} else {
				output = concerns.ExtractTextContent(msg["content"], "")
			}
			input := result["input"].([]map[string]any)
			input = append(input, map[string]any{
				"type":    schema.ResponsesItemTypeFunctionCallOutput,
				"call_id": clampCallId(stringOr(msg["tool_call_id"], "")),
				"output":  output,
			})
			result["input"] = input
		}
	}

	if !hasSystemMessage {
		result["instructions"] = ""
	}

	// Convert tools
	if tools, ok := body["tools"].([]any); ok {
		var resultTools []map[string]any
		for _, t := range tools {
			tool, ok := t.(map[string]any)
			if !ok {
				continue
			}
			if toolType, _ := tool["type"].(string); toolType == schema.OpenAIBlockTypeFunction {
				fn, _ := tool["function"].(map[string]any)
				if fn == nil {
					fn = map[string]any{}
				}
				resultTools = append(resultTools, map[string]any{
					"type":         schema.OpenAIBlockTypeFunction,
					"name":         stringOr(fn["name"], ""),
					"description":  stringOr(fn["description"], ""),
					"parameters":   normalizeToolParameters(fn["parameters"]),
					"strict":       fn["strict"],
				})
			} else {
				resultTools = append(resultTools, tool)
			}
		}
		if len(resultTools) > 0 {
			result["tools"] = resultTools
		}
	}

	// Pass through relevant fields
	if temp, ok := body["temperature"].(float64); ok {
		result["temperature"] = temp
	}
	if mt, ok := body["max_tokens"].(float64); ok {
		result["max_tokens"] = mt
	}
	if topP, ok := body["top_p"].(float64); ok {
		result["top_p"] = topP
	}
	if re, ok := body["reasoning"]; ok {
		result["reasoning"] = re
	}
	if re, ok := body["reasoning_effort"].(string); ok {
		result["reasoning"] = map[string]any{"effort": re, "summary": "auto"}
	}

	return result, nil
}

func normalizeResponsesInput(input any) []map[string]any {
	if arr, ok := input.([]any); ok {
		out := make([]map[string]any, 0, len(arr))
		for _, item := range arr {
			if m, ok := item.(map[string]any); ok {
				out = append(out, m)
			}
		}
		return out
	}
	if arr, ok := input.([]map[string]any); ok {
		return arr
	}
	if s, ok := input.(string); ok {
		return []map[string]any{{"type": schema.ResponsesItemTypeMessage, "role": schema.RoleUser, "content": []map[string]any{{"type": schema.ResponsesItemTypeInputText, "text": s}}}}
	}
	return nil
}

func convertResponsesContent(content any) any {
	if content == nil {
		return nil
	}
	if s, ok := content.(string); ok {
		return s
	}
	if arr, ok := content.([]any); ok {
		var parts []map[string]any
		for _, c := range arr {
			if m, ok := c.(map[string]any); ok {
				ct, _ := m["type"].(string)
				switch ct {
				case schema.ResponsesItemTypeInputText, schema.ResponsesItemTypeOutputText:
					if t, ok := m["text"].(string); ok {
						parts = append(parts, map[string]any{"type": schema.OpenAIBlockTypeText, "text": t})
					}
				case schema.ResponsesItemTypeInputImage:
					url := stringOr(m["image_url"], "")
					if url == "" {
						url = stringOr(m["file_id"], "")
					}
					detail := "auto"
					if d, ok := m["detail"].(string); ok {
						detail = d
					}
					parts = append(parts, map[string]any{"type": schema.OpenAIBlockTypeImageURL, "image_url": map[string]any{"url": url, "detail": detail}})
				default:
					parts = append(parts, m)
				}
			}
		}
		return parts
	}
	return content
}

func extractResponsesReasoning(item map[string]any) string {
	if summary, ok := item["summary"].([]any); ok {
		var texts []string
		for _, s := range summary {
			if m, ok := s.(map[string]any); ok {
				if t, ok := m["text"].(string); ok && t != "" {
					texts = append(texts, t)
				}
			}
		}
		if len(texts) > 0 {
			return strings.Join(texts, "\n")
		}
	}
	if content, ok := item["content"].([]any); ok {
		var texts []string
		for _, c := range content {
			if m, ok := c.(map[string]any); ok {
				if t, ok := m["text"].(string); ok && t != "" {
					texts = append(texts, t)
				}
			}
		}
		if len(texts) > 0 {
			return strings.Join(texts, "\n")
		}
	}
	return ""
}

func normalizeToolParameters(params any) map[string]any {
	if params == nil {
		return map[string]any{"type": "object", "properties": map[string]any{}}
	}
	m, ok := params.(map[string]any)
	if !ok {
		return map[string]any{"type": "object", "properties": map[string]any{}}
	}
	if t, _ := m["type"].(string); t == "object" {
		if m["properties"] == nil {
			result := copyMap(m)
			result["properties"] = map[string]any{}
			return result
		}
	}
	return m
}

func clampCallId(id string) string {
	if len(id) > maxCallIDLen {
		return id[:maxCallIDLen]
	}
	return id
}

func copyMap(m map[string]any) map[string]any {
	result := make(map[string]any, len(m))
	for k, v := range m {
		result[k] = v
	}
	return result
}

var _ = formats.AdjustMaxTokens
