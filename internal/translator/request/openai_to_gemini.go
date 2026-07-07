package request

import (
	"strings"

	"github.com/9router/9router/internal/translator"
	"github.com/9router/9router/internal/translator/concerns"
	"github.com/9router/9router/internal/translator/schema"
)

// ponytail: Antigravity/CLI envelope wrappers, cleanJSONSchemaForAntigravity, and thinking signature injection are deferred.
// Only the standard OpenAI→Gemini (generateContent) request path is ported here.

func init() {
	translator.Register(string(translator.FormatOpenAI), string(translator.FormatGemini), openaiToGeminiRequest, nil)
}

// defaultSafetySettings mirrors DEFAULT_SAFETY_SETTINGS from the Node.js gemini format helpers.
var defaultSafetySettings = []map[string]any{
	{"category": "HARM_CATEGORY_HATE_SPEECH", "threshold": "OFF"},
	{"category": "HARM_CATEGORY_DANGEROUS_CONTENT", "threshold": "OFF"},
	{"category": "HARM_CATEGORY_SEXUALLY_EXPLICIT", "threshold": "OFF"},
	{"category": "HARM_CATEGORY_HARASSMENT", "threshold": "OFF"},
	{"category": "HARM_CATEGORY_CIVIC_INTEGRITY", "threshold": "OFF"},
}

func openaiToGeminiRequest(model string, body map[string]any, stream bool, creds any) (map[string]any, error) {
	result := map[string]any{
		"model":           model,
		"contents":        []map[string]any{},
		"generationConfig": map[string]any{},
		"safetySettings":  defaultSafetySettings,
	}

	genConfig := result["generationConfig"].(map[string]any)

	// Generation config parameters
	if temp, ok := body["temperature"].(float64); ok {
		genConfig["temperature"] = temp
	} else if temp, ok := body["temperature"].(int); ok {
		genConfig["temperature"] = float64(temp)
	}

	if topP, ok := body["top_p"].(float64); ok {
		genConfig["topP"] = topP
	} else if topP, ok := body["top_p"].(int); ok {
		genConfig["topP"] = float64(topP)
	}

	if topK, ok := body["top_k"].(float64); ok {
		genConfig["topK"] = topK
	} else if topK, ok := body["top_k"].(int); ok {
		genConfig["topK"] = topK
	}

	if maxTokens, ok := body["max_tokens"]; ok && maxTokens != nil {
		genConfig["maxOutputTokens"] = concerns.IntNumber(maxTokens)
	}

	// Collect messages into a slice we can iterate over with both []any and []map[string]any support.
	var msgs []map[string]any
	if arr, ok := body["messages"].([]any); ok {
		for _, m := range arr {
			if msg, ok := m.(map[string]any); ok {
				msgs = append(msgs, msg)
			}
		}
	} else if arr, ok := body["messages"].([]map[string]any); ok {
		msgs = arr
	}

	// Build tool_call_id -> name map from assistant messages
	tcID2Name := map[string]string{}
	for _, msg := range msgs {
		if role, _ := msg["role"].(string); role == schema.RoleAssistant {
			if tcs, ok := msg["tool_calls"].([]any); ok {
				for _, tc := range tcs {
					if m, ok := tc.(map[string]any); ok {
						if tcType, _ := m["type"].(string); tcType == schema.OpenAIBlockTypeFunction {
							if id, _ := m["id"].(string); id != "" {
								if fn, ok := m["function"].(map[string]any); ok {
									if name, _ := fn["name"].(string); name != "" {
										tcID2Name[id] = name
									}
								}
							}
						}
					}
				}
			} else if tcs, ok := msg["tool_calls"].([]map[string]any); ok {
				for _, m := range tcs {
					if tcType, _ := m["type"].(string); tcType == schema.OpenAIBlockTypeFunction {
						if id, _ := m["id"].(string); id != "" {
							if fn, ok := m["function"].(map[string]any); ok {
								if name, _ := fn["name"].(string); name != "" {
									tcID2Name[id] = name
								}
							}
						}
					}
				}
			}
		}
	}

	// Build tool responses cache (tool_call_id -> content)
	toolResponses := map[string]string{}
	for _, msg := range msgs {
		if role, _ := msg["role"].(string); role == schema.RoleTool {
			if tcID, _ := msg["tool_call_id"].(string); tcID != "" {
				if content, ok := msg["content"].(string); ok {
					toolResponses[tcID] = content
				}
			}
		}
	}

	var contents []map[string]any

	// Convert messages
	for _, msg := range msgs {
		role, _ := msg["role"].(string)
		content := msg["content"]

		switch role {
		case schema.RoleSystem:
			// If there's only one message (system only), treat as user content
			if len(msgs) > 1 {
				var sysText string
				if s, ok := content.(string); ok {
					sysText = s
				} else {
					sysText = concerns.ExtractTextContent(content, "\n")
				}
				result["systemInstruction"] = map[string]any{
					"role":  schema.GeminiRoleUser,
					"parts": []map[string]any{{"text": sysText}},
				}
			} else {
				parts := convertOpenAIContentToGeminiParts(content)
				if len(parts) > 0 {
					contents = append(contents, map[string]any{
						"role":  schema.GeminiRoleUser,
						"parts": parts,
					})
				}
			}

		case schema.RoleUser:
			parts := convertOpenAIContentToGeminiParts(content)
			if len(parts) > 0 {
				contents = append(contents, map[string]any{
					"role":  schema.GeminiRoleUser,
					"parts": parts,
				})
			}

		case schema.RoleAssistant:
			var parts []map[string]any

			// Thinking/reasoning → thought part
			if reasoning, ok := msg["reasoning_content"].(string); ok && reasoning != "" {
				parts = append(parts,
					map[string]any{"thought": true, "text": reasoning},
					map[string]any{"thoughtSignature": "", "text": ""},
				)
			}

			// Text content
			if content != nil {
				var text string
				if s, ok := content.(string); ok {
					text = s
				} else {
					text = concerns.ExtractTextContent(content, "\n")
				}
				if text != "" {
					parts = append(parts, map[string]any{"text": text})
				}
			}

			// Tool calls
			var toolCallIDs []string
			hasToolCalls := false

			if tcs, ok := msg["tool_calls"].([]any); ok {
				for _, tc := range tcs {
					if m, ok := tc.(map[string]any); ok {
						if tcType, _ := m["type"].(string); tcType != schema.OpenAIBlockTypeFunction {
							continue
						}
						fn, _ := m["function"].(map[string]any)
						if fn == nil {
							fn = map[string]any{}
						}
						argsStr := stringOr(fn["arguments"], "{}")
						args := concerns.SafeParseJSON(argsStr, "{}")
						tcID, _ := m["id"].(string)
						fnName, _ := fn["name"].(string)

						parts = append(parts, map[string]any{
							"thoughtSignature": "",
							"functionCall": map[string]any{
								"id":   tcID,
								"name": sanitizeGeminiFunctionName(fnName),
								"args": args,
							},
						})
						toolCallIDs = append(toolCallIDs, tcID)
						hasToolCalls = true
					}
				}
			} else if tcs, ok := msg["tool_calls"].([]map[string]any); ok {
				for _, m := range tcs {
					if tcType, _ := m["type"].(string); tcType != schema.OpenAIBlockTypeFunction {
						continue
					}
					fn, _ := m["function"].(map[string]any)
					if fn == nil {
						fn = map[string]any{}
					}
					argsStr := stringOr(fn["arguments"], "{}")
					args := concerns.SafeParseJSON(argsStr, "{}")
					tcID, _ := m["id"].(string)
					fnName, _ := fn["name"].(string)

					parts = append(parts, map[string]any{
						"thoughtSignature": "",
						"functionCall": map[string]any{
							"id":   tcID,
							"name": sanitizeGeminiFunctionName(fnName),
							"args": args,
						},
					})
					toolCallIDs = append(toolCallIDs, tcID)
					hasToolCalls = true
				}
			}

			if hasToolCalls {
				if len(parts) > 0 {
					contents = append(contents, map[string]any{
						"role":  schema.GeminiRoleModel,
						"parts": parts,
					})
				}

				// Check if there are actual tool responses for these tool call IDs
				hasActualResponses := false
				for _, fid := range toolCallIDs {
					if _, ok := toolResponses[fid]; ok {
						hasActualResponses = true
						break
					}
				}

				if hasActualResponses {
					var toolParts []map[string]any
					for _, fid := range toolCallIDs {
						resp, ok := toolResponses[fid]
						if !ok {
							continue
						}

						name := tcID2Name[fid]
						if name == "" {
							// Try to derive name from the tool call ID
							idParts := strings.Split(fid, "-")
							if len(idParts) > 2 {
								name = strings.Join(idParts[:len(idParts)-2], "-")
							} else {
								name = fid
							}
						}

						// Parse the tool response; wrap non-object responses in {result: ...}
						parsed := concerns.SafeParseJSON(resp, resp)
						switch p := parsed.(type) {
						case map[string]any:
							// keep as-is
							_ = p
						default:
							parsed = map[string]any{"result": parsed}
						}

						toolParts = append(toolParts, map[string]any{
							"functionResponse": map[string]any{
								"id":   fid,
								"name": sanitizeGeminiFunctionName(name),
								"response": map[string]any{
									"result": parsed,
								},
							},
						})
					}
					if len(toolParts) > 0 {
						contents = append(contents, map[string]any{
							"role":  schema.GeminiRoleUser,
							"parts": toolParts,
						})
					}
				}
			} else if len(parts) > 0 {
				contents = append(contents, map[string]any{
					"role":  schema.GeminiRoleModel,
					"parts": parts,
				})
			}

		case schema.RoleTool:
			// Tool messages are handled in the assistant tool_calls branch via toolResponses cache.
			// If we reach here with a standalone tool message, skip it.
		}
	}

	// Convert tools
	if tools, ok := body["tools"].([]any); ok && len(tools) > 0 {
		functionDeclarations := convertOpenAIToolsToGeminiDeclarations(tools)
		if len(functionDeclarations) > 0 {
			result["tools"] = []map[string]any{{"functionDeclarations": functionDeclarations}}
		}
	} else if tools, ok := body["tools"].([]map[string]any); ok && len(tools) > 0 {
		functionDeclarations := convertOpenAIToolsToGeminiDeclarationsMap(tools)
		if len(functionDeclarations) > 0 {
			result["tools"] = []map[string]any{{"functionDeclarations": functionDeclarations}}
		}
	}

	// Normalize contents: merge consecutive entries with the same role
	contents = normalizeGeminiContents(contents)
	result["contents"] = contents

	return result, nil
}

// convertOpenAIContentToGeminiParts converts OpenAI message content (string or array) to Gemini parts.
func convertOpenAIContentToGeminiParts(content any) []map[string]any {
	var parts []map[string]any

	switch v := content.(type) {
	case string:
		if v != "" {
			parts = append(parts, map[string]any{"text": v})
		}
	case []any:
		for _, item := range v {
			if m, ok := item.(map[string]any); ok {
				if p := convertOpenAIContentPartToGemini(m); p != nil {
					parts = append(parts, p...)
				}
			}
		}
	case []map[string]any:
		for _, m := range v {
			if p := convertOpenAIContentPartToGemini(m); p != nil {
				parts = append(parts, p...)
			}
		}
	}

	return parts
}

// convertOpenAIContentPartToGemini converts a single OpenAI content part to Gemini part(s).
func convertOpenAIContentPartToGemini(part map[string]any) []map[string]any {
	partType, _ := part["type"].(string)

	switch partType {
	case schema.OpenAIBlockTypeText:
		if text, ok := part["text"].(string); ok && text != "" {
			return []map[string]any{{"text": text}}
		}

	case schema.OpenAIBlockTypeImageURL:
		if iu, ok := part["image_url"].(map[string]any); ok {
			url := stringOr(iu["url"], "")
			if parsed := concerns.ParseDataUri(url); parsed != nil {
				return []map[string]any{{
					"inlineData": map[string]any{
						"mimeType": parsed.MimeType,
						"data":     parsed.Base64,
					},
				}}
			}
			if strings.HasPrefix(url, "http://") || strings.HasPrefix(url, "https://") {
				return []map[string]any{{
					"fileData": map[string]any{
						"fileUri":  url,
						"mimeType": "image/*",
					},
				}}
			}
		}
	}

	return nil
}

// convertOpenAIToolsToGeminiDeclarations converts OpenAI tools ([]any) to Gemini functionDeclarations.
func convertOpenAIToolsToGeminiDeclarations(tools []any) []map[string]any {
	out := make([]map[string]any, 0, len(tools))
	for _, t := range tools {
		if m, ok := t.(map[string]any); ok {
			if fd := convertOpenAIToolToGeminiDeclaration(m); fd != nil {
				out = append(out, fd)
			}
		}
	}
	return out
}

// convertOpenAIToolsToGeminiDeclarationsMap converts OpenAI tools ([]map[string]any) to Gemini functionDeclarations.
func convertOpenAIToolsToGeminiDeclarationsMap(tools []map[string]any) []map[string]any {
	out := make([]map[string]any, 0, len(tools))
	for _, m := range tools {
		if fd := convertOpenAIToolToGeminiDeclaration(m); fd != nil {
			out = append(out, fd)
		}
	}
	return out
}

// convertOpenAIToolToGeminiDeclaration converts a single OpenAI tool definition to a Gemini functionDeclaration.
func convertOpenAIToolToGeminiDeclaration(tool map[string]any) map[string]any {
	// Check if already in Claude/Anthropic format (has name + input_schema, no type field)
	if name, ok := tool["name"].(string); ok && name != "" {
		if _, hasInputSchema := tool["input_schema"]; hasInputSchema {
			params := tool["input_schema"]
			if params == nil {
				params = map[string]any{"type": "object", "properties": map[string]any{}}
			}
			return map[string]any{
				"name":        sanitizeGeminiFunctionName(name),
				"description": stringOr(tool["description"], ""),
				"parameters":  params,
			}
		}
	}

	// OpenAI format: type === "function" with a function sub-object
	toolType, _ := tool["type"].(string)
	if toolType == "" || toolType == schema.OpenAIBlockTypeFunction {
		if fn, ok := tool["function"].(map[string]any); ok {
			fnName, _ := fn["name"].(string)
			params := fn["parameters"]
			if params == nil {
				params = map[string]any{"type": "object", "properties": map[string]any{}}
			}
			return map[string]any{
				"name":        sanitizeGeminiFunctionName(fnName),
				"description": stringOr(fn["description"], ""),
				"parameters":  params,
			}
		}
	}

	return nil
}

// sanitizeGeminiFunctionName sanitizes a function name for the Gemini API.
// Gemini requires: starts with [a-zA-Z_], followed by [a-zA-Z0-9_.:-], max 64 chars.
func sanitizeGeminiFunctionName(name string) string {
	if name == "" {
		return "_unknown"
	}

	// Replace any char not in [a-zA-Z0-9_.:-] with '_'
	var b strings.Builder
	for _, r := range name {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') ||
			(r >= '0' && r <= '9') || r == '_' || r == '.' || r == ':' || r == '-' {
			b.WriteRune(r)
		} else {
			b.WriteByte('_')
		}
	}
	sanitized := b.String()

	// First char must be a letter or underscore
	if len(sanitized) > 0 {
		first := sanitized[0]
		if !((first >= 'a' && first <= 'z') || (first >= 'A' && first <= 'Z') || first == '_') {
			sanitized = "_" + sanitized
		}
	}

	// Truncate to 64 chars
	if len(sanitized) > 64 {
		sanitized = sanitized[:64]
	}

	return sanitized
}

// normalizeGeminiContents merges consecutive contents with the same role.
func normalizeGeminiContents(contents []map[string]any) []map[string]any {
	var out []map[string]any
	for _, c := range contents {
		role, _ := c["role"].(string)
		parts, _ := c["parts"].([]map[string]any)
		if role == "" || len(parts) == 0 {
			continue
		}

		if len(out) > 0 {
			last := out[len(out)-1]
			if lastRole, _ := last["role"].(string); lastRole == role {
				if lastParts, ok := last["parts"].([]map[string]any); ok {
					last["parts"] = append(lastParts, parts...)
					continue
				}
			}
		}

		// Clone to avoid aliasing
		clonedParts := make([]map[string]any, len(parts))
		copy(clonedParts, parts)
		out = append(out, map[string]any{
			"role":  role,
			"parts": clonedParts,
		})
	}
	return out
}
