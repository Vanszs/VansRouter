package request

import (
	"strings"

	"github.com/google/uuid"
	"github.com/9router/9router/internal/translator"
	"github.com/9router/9router/internal/translator/concerns"
	"github.com/9router/9router/internal/translator/schema"
)

// ponytail: config fields (workingDir, date, environment, gitStatus) are stubbed — will be wired when config package is ported.

func init() {
	translator.Register(string(translator.FormatOpenAI), string(translator.FormatCommandCode), openaiToCommandCodeRequest, nil)
}

func openaiToCommandCodeRequest(model string, body map[string]any, stream bool, creds any) (map[string]any, error) {
	converted := convertCommandCodeMessages(body)

	params := map[string]any{
		"model":       model,
		"messages":    converted.messages,
		"stream":      stream,
		"max_tokens":  8192,
		"temperature": 0.3,
	}

	if mt, ok := body["max_tokens"].(float64); ok {
		params["max_tokens"] = int(mt)
	}
	if mt, ok := body["max_output_tokens"].(float64); ok {
		params["max_tokens"] = int(mt)
	}
	if temp, ok := body["temperature"].(float64); ok {
		params["temperature"] = temp
	}
	if converted.system != "" {
		params["system"] = converted.system
	}
	if tools, ok := body["tools"]; ok {
		if ct := convertCommandCodeTools(tools); ct != nil {
			params["tools"] = ct
		}
	}
	if topP, ok := body["top_p"].(float64); ok {
		params["top_p"] = topP
	}

	return map[string]any{
		"threadId": uuid.New().String(),
		"memory":   "",
		"config": map[string]any{
			"workingDir":   ".",
			"date":         "",
			"environment":  "linux",
			"structure":    []any{},
			"isGitRepo":    false,
			"currentBranch": "",
			"mainBranch":    "",
			"gitStatus":     "",
			"recentCommits": []any{},
		},
		"params": params,
	}, nil
}

type ccMessages struct {
	messages []map[string]any
	system   string
}

func convertCommandCodeMessages(body map[string]any) ccMessages {
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

	var out []map[string]any
	var systemParts []string

	for _, msg := range rawMsgs {
		role, _ := msg["role"].(string)

		if role == schema.RoleSystem {
			t := concerns.ExtractTextContent(msg["content"], "\n")
			if t != "" {
				systemParts = append(systemParts, t)
			}
			continue
		}

		if role == schema.RoleTool {
			value := concerns.ExtractTextContent(msg["content"], "\n")
			out = append(out, map[string]any{
				"role": schema.RoleTool,
				"content": []map[string]any{{
					"type":       "tool-result",
					"toolCallId": stringOr(msg["tool_call_id"], ""),
					"toolName":   stringOr(msg["name"], ""),
					"output":     map[string]any{"type": "text", "value": value},
				}},
			})
			continue
		}

		if role == schema.RoleAssistant {
			var blocks []map[string]any
			text := concerns.ExtractTextContent(msg["content"], "\n")
			if text != "" {
				blocks = append(blocks, map[string]any{"type": schema.OpenAIBlockTypeText, "text": text})
			}
			if tcs, ok := msg["tool_calls"].([]any); ok {
				for _, tc := range tcs {
					if m, ok := tc.(map[string]any); ok {
						fn, _ := m["function"].(map[string]any)
						if fn == nil {
							fn = map[string]any{}
						}
						blocks = append(blocks, map[string]any{
							"type":       "tool-call",
							"toolCallId": stringOr(m["id"], ""),
							"toolName":   stringOr(fn["name"], ""),
							"input":      concerns.SafeParseJSON(stringOr(fn["arguments"], "{}"), "{}"),
						})
					}
				}
			}
			if len(blocks) == 0 {
				blocks = []map[string]any{{"type": schema.OpenAIBlockTypeText, "text": ""}}
			}
			out = append(out, map[string]any{"role": schema.RoleAssistant, "content": blocks})
			continue
		}

		out = append(out, map[string]any{"role": schema.RoleUser, "content": toContentBlocksCC(msg["content"])})
	}

	system := ""
	if len(systemParts) > 0 {
		system = strings.Join(systemParts, "\n\n")
	}
	return ccMessages{messages: out, system: system}
}

func toContentBlocksCC(content any) []map[string]any {
	if content == nil {
		return []map[string]any{{"type": schema.OpenAIBlockTypeText, "text": ""}}
	}
	if s, ok := content.(string); ok {
		return []map[string]any{{"type": schema.OpenAIBlockTypeText, "text": s}}
	}
	if arr, ok := content.([]any); ok {
		var blocks []map[string]any
		for _, p := range arr {
			if part, ok := p.(map[string]any); ok {
				if t, _ := part["type"].(string); t == schema.OpenAIBlockTypeText {
					if text, ok := part["text"].(string); ok {
						blocks = append(blocks, map[string]any{"type": schema.OpenAIBlockTypeText, "text": text})
					}
				} else if t == schema.OpenAIBlockTypeImageURL || t == schema.OpenAIBlockTypeImage {
					blocks = append(blocks, map[string]any{"type": schema.OpenAIBlockTypeText, "text": "[image omitted]"})
				} else if text, ok := part["text"].(string); ok {
					blocks = append(blocks, map[string]any{"type": schema.OpenAIBlockTypeText, "text": text})
				}
			}
		}
		if len(blocks) == 0 {
			return []map[string]any{{"type": schema.OpenAIBlockTypeText, "text": ""}}
		}
		return blocks
	}
	return []map[string]any{{"type": schema.OpenAIBlockTypeText, "text": ""}}
}

func convertCommandCodeTools(tools any) []map[string]any {
	var raw []any
	switch v := tools.(type) {
	case []any:
		raw = v
	case []map[string]any:
		for _, m := range v {
			raw = append(raw, m)
		}
	default:
		return nil
	}

	var result []map[string]any
	for _, t := range raw {
		tool, ok := t.(map[string]any)
		if !ok {
			continue
		}
		if toolType, _ := tool["type"].(string); toolType == schema.OpenAIBlockTypeFunction {
			if fn, ok := tool["function"].(map[string]any); ok {
				params := fn["parameters"]
				if params == nil {
					params = map[string]any{"type": "object"}
				}
				result = append(result, map[string]any{
					"name":         stringOr(fn["name"], ""),
					"description":  stringOr(fn["description"], ""),
					"input_schema": params,
				})
			}
		} else if name, _ := tool["name"].(string); name != "" {
			params := tool["input_schema"]
			if params == nil {
				params = tool["parameters"]
			}
			if params == nil {
				params = map[string]any{"type": "object"}
			}
			result = append(result, map[string]any{
				"name":         name,
				"description":  stringOr(tool["description"], ""),
				"input_schema": params,
			})
		}
	}
	if len(result) == 0 {
		return nil
	}
	return result
}
