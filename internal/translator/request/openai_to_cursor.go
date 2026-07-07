package request

import (
	"strings"

	"github.com/9router/9router/internal/translator"
	"github.com/9router/9router/internal/translator/concerns"
	"github.com/9router/9router/internal/translator/schema"
)

func init() {
	translator.Register(string(translator.FormatOpenAI), string(translator.FormatCursor), openaiToCursorRequest, nil)
}

func openaiToCursorRequest(model string, body map[string]any, stream bool, creds any) (map[string]any, error) {
	messages := convertCursorMessages(body)

	result := map[string]any{
		"model":      model,
		"stream":     stream,
		"messages":   messages,
		"max_tokens": 16384, // DEFAULT_MIN_TOKENS
	}

	if temp, ok := body["temperature"].(float64); ok {
		result["temperature"] = temp
	}
	if topP, ok := body["top_p"].(float64); ok {
		result["top_p"] = topP
	}

	// Pass through tools
	if tools, ok := body["tools"]; ok {
		result["tools"] = tools
	}

	return result, nil
}

func convertCursorMessages(body map[string]any) []map[string]any {
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

	// Build tool_call_id -> tool name map
	toolCallMeta := map[string]string{}
	for _, msg := range rawMsgs {
		role, _ := msg["role"].(string)
		if role == schema.RoleAssistant {
			if tcs, ok := msg["tool_calls"].([]any); ok {
				for _, tc := range tcs {
					if m, ok := tc.(map[string]any); ok {
						id, _ := m["id"].(string)
						fn, _ := m["function"].(map[string]any)
						name, _ := fn["name"].(string)
						if id != "" && name != "" {
							toolCallMeta[id] = name
						}
					}
				}
			}
		}
	}

	var result []map[string]any
	for _, msg := range rawMsgs {
		role, _ := msg["role"].(string)

		if role == schema.RoleSystem {
			result = append(result, map[string]any{
				"role":    schema.RoleUser,
				"content": "[System Instructions]\n" + extractCursorContent(msg["content"]),
			})
			continue
		}

		if role == schema.RoleTool {
			toolCallId, _ := msg["tool_call_id"].(string)
			toolName := toolCallMeta[toolCallId]
			if toolName == "" {
				toolName = "tool"
			}
			if n, ok := msg["name"].(string); ok && n != "" {
				toolName = n
			}
			result = append(result, map[string]any{
				"role":    schema.RoleUser,
				"content": buildToolResultBlock(toolName, toolCallId, extractCursorContent(msg["content"])),
			})
			continue
		}

		if role == schema.RoleUser || role == schema.RoleAssistant {
			// Handle user messages with array content (tool_results)
			if role == schema.RoleUser {
				if arr, ok := msg["content"].([]any); ok {
					var parts []string
					for _, b := range arr {
						if block, ok := b.(map[string]any); ok {
							bt, _ := block["type"].(string)
							if bt == schema.OpenAIBlockTypeText || bt == schema.ClaudeBlockTypeText {
								if t, ok := block["text"].(string); ok {
									parts = append(parts, t)
								}
							} else if bt == schema.ClaudeBlockTypeToolResult {
								id, _ := block["tool_use_id"].(string)
								tn := toolCallMeta[id]
								if tn == "" {
									tn = "tool"
								}
								parts = append(parts, buildToolResultBlock(tn, id, extractCursorContent(block["content"])))
							}
						}
					}
					joined := strings.Join(parts, "\n")
					if joined != "" {
						result = append(result, map[string]any{"role": schema.RoleUser, "content": joined})
					}
					continue
				}
			}

			content := extractCursorContent(msg["content"])

			// Assistant with tool_calls
			if role == schema.RoleAssistant {
				if tcs, ok := msg["tool_calls"].([]any); ok && len(tcs) > 0 {
					assistantMsg := map[string]any{
						"role":    schema.RoleAssistant,
						"content": content,
					}
					var converted []map[string]any
					for _, tc := range tcs {
						if m, ok := tc.(map[string]any); ok {
							converted = append(converted, m)
						}
					}
					assistantMsg["tool_calls"] = converted
					result = append(result, assistantMsg)
					continue
				}
			}

			if content != "" {
				result = append(result, map[string]any{"role": role, "content": content})
			}
		}
	}

	return result
}

func extractCursorContent(content any) string {
	return concerns.ExtractTextContent(content, "\n")
}

func buildToolResultBlock(toolName, toolCallId, resultText string) string {
	var b strings.Builder
	b.WriteString("<tool_result>\n")
	b.WriteString("<tool_name>" + escapeXML(toolName) + "</tool_name>\n")
	b.WriteString("<tool_call_id>" + escapeXML(toolCallId) + "</tool_call_id>\n")
	b.WriteString("<result>" + escapeXML(resultText) + "</result>\n")
	b.WriteString("</tool_result>")
	return b.String()
}

func escapeXML(s string) string {
	s = strings.ReplaceAll(s, "&", "&amp;")
	s = strings.ReplaceAll(s, "<", "&lt;")
	s = strings.ReplaceAll(s, ">", "&gt;")
	return s
}
