package response

import (
	"strconv"
	"time"

	"github.com/9router/9router/internal/translator"
	"github.com/9router/9router/internal/translator/concerns"
	"github.com/9router/9router/internal/translator/schema"
)

func init() {
	translator.Register(string(translator.FormatOpenAI), string(translator.FormatAntigravity), nil, openaiToAntigravityResponse)
}

func openaiToAntigravityResponse(chunk map[string]any, state *translator.State) ([]map[string]any, error) {
	if chunk == nil {
		return nil, nil
	}

	choices, ok := chunk["choices"].([]any)
	if !ok || len(choices) == 0 {
		return nil, nil
	}
	choice, ok := choices[0].(map[string]any)
	if !ok {
		return nil, nil
	}

	delta, _ := choice["delta"].(map[string]any)
	finishReason, _ := choice["finish_reason"].(string)

	if state.MessageID == "" {
		if id, ok := chunk["id"].(string); ok && id != "" {
			state.MessageID = id
		} else {
			state.MessageID = "resp_" + strconv.FormatInt(time.Now().UnixMilli(), 10)
		}
		if m, ok := chunk["model"].(string); ok {
			state.Model = m
		}
	}

	var parts []map[string]any

	// Thinking/reasoning
	if rc, ok := delta["reasoning_content"].(string); ok && rc != "" {
		parts = append(parts, map[string]any{"thought": true, "text": rc})
	}

	// Text content
	if content, ok := delta["content"].(string); ok && content != "" {
		parts = append(parts, map[string]any{"text": content})
	}

	// Accumulate tool calls
	if tcs, ok := delta["tool_calls"].([]any); ok {
		for _, tc := range tcs {
			if m, ok := tc.(map[string]any); ok {
				idx := 0
				if n, ok := m["index"].(float64); ok {
					idx = int(n)
				}
				key := strconv.Itoa(idx)
				if state.ToolArgBuffers == nil {
					state.ToolArgBuffers = map[string]any{}
				}
				accum, _ := state.ToolArgBuffers[key].(map[string]any)
				if accum == nil {
					accum = map[string]any{"id": "", "name": "", "arguments": ""}
					state.ToolArgBuffers[key] = accum
				}
				if id, ok := m["id"].(string); ok && id != "" {
					accum["id"] = id
				}
				if fn, ok := m["function"].(map[string]any); ok {
					if name, ok := fn["name"].(string); ok && name != "" {
						accum["name"] = accum["name"].(string) + name
					}
					if args, ok := fn["arguments"].(string); ok && args != "" {
						accum["arguments"] = accum["arguments"].(string) + args
					}
				}
			}
		}
		if len(parts) == 0 && finishReason == "" {
			return nil, nil
		}
	}

	// On finish, emit accumulated tool calls
	if finishReason != "" {
		for _, v := range state.ToolArgBuffers {
			accum, ok := v.(map[string]any)
			if !ok {
				continue
			}
			args := concerns.SafeParseJSON(accum["arguments"].(string), "{}")
			name := accum["name"].(string)
			if state.ToolNameMap != nil {
				if orig, ok := state.ToolNameMap[name]; ok {
					name = orig
				}
			}
			parts = append(parts, map[string]any{
				"functionCall": map[string]any{
					"name": name,
					"args": args,
				},
			})
		}
	}

	if len(parts) == 0 && finishReason == "" {
		return nil, nil
	}
	if len(parts) == 0 && finishReason != "" {
		parts = append(parts, map[string]any{"text": ""})
	}

	candidate := map[string]any{
		"content": map[string]any{
			"role":  schema.GeminiRoleModel,
			"parts": parts,
		},
	}

	if finishReason != "" {
		reasonMap := map[string]string{
			"stop":           "STOP",
			"length":         "MAX_TOKENS",
			"tool_calls":     "STOP",
			"content_filter": "SAFETY",
		}
		if mapped, ok := reasonMap[finishReason]; ok {
			candidate["finishReason"] = mapped
		} else {
			candidate["finishReason"] = "STOP"
		}
	}

	response := map[string]any{
		"candidates":   []map[string]any{candidate},
		"modelVersion": state.Model,
		"responseId":   state.MessageID,
	}

	if usage, ok := chunk["usage"].(map[string]any); ok {
		usageMeta := map[string]any{
			"promptTokenCount":     concerns.IntNumber(usage["prompt_tokens"]),
			"candidatesTokenCount": concerns.IntNumber(usage["completion_tokens"]),
			"totalTokenCount":      concerns.IntNumber(usage["total_tokens"]),
		}
		if ptd, ok := usage["prompt_tokens_details"].(map[string]any); ok {
			if ct, ok := ptd["cached_tokens"]; ok {
				usageMeta["cachedContentTokenCount"] = concerns.IntNumber(ct)
			}
		}
		if ctd, ok := usage["completion_tokens_details"].(map[string]any); ok {
			if rt, ok := ctd["reasoning_tokens"]; ok {
				usageMeta["thoughtsTokenCount"] = concerns.IntNumber(rt)
			}
		}
		response["usageMetadata"] = usageMeta
	}

	return []map[string]any{{"response": response}}, nil
}
