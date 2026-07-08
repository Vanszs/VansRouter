package response

import (
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/9router/9router/internal/translator"
)

func init() {
	translator.Register(string(translator.FormatKiro), string(translator.FormatClaude), nil, kiroToClaudeResponse)
}

// kiroToClaudeResponse converts a Kiro (OpenAI-shaped) streaming chunk into Claude SSE events.
// KiroExecutor already transforms raw AWS EventStream into OpenAI chat.completion.chunk objects,
// so this is essentially openai-to-claude but registered on the direct kiro:claude route.
func kiroToClaudeResponse(chunk map[string]any, state *translator.State) ([]map[string]any, error) {
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

	var results []map[string]any
	push := func(c map[string]any) {
		results = append(results, c)
	}

	// Track usage if present on the chunk.
	if usage, ok := chunk["usage"].(map[string]any); ok {
		promptTokens := 0
		if pt, ok := usage["prompt_tokens"].(float64); ok {
			promptTokens = int(pt)
		}
		outputTokens := 0
		if ct, ok := usage["completion_tokens"].(float64); ok {
			outputTokens = int(ct)
		}
		state.Usage = map[string]any{
			"input_tokens":  promptTokens,
			"output_tokens": outputTokens,
		}
	}

	// First chunk → emit message_start.
	if !state.MessageStartSent {
		state.MessageStartSent = true
		if id, ok := chunk["id"].(string); ok && strings.HasPrefix(id, "chatcmpl-") {
			state.MessageID = strings.TrimPrefix(id, "chatcmpl-")
		} else if id, ok := chunk["id"].(string); ok && id != "" {
			state.MessageID = id
		} else {
			state.MessageID = fmt.Sprintf("msg_%d", time.Now().UnixMilli())
		}
		state.Model, _ = chunk["model"].(string)
		if state.Model == "" {
			state.Model = "kiro"
		}
		state.NextBlockIndex = 0
		push(messageStart(state.MessageID, state.Model))
	}

	// Reasoning / thinking content.
	reasoningContent := ""
	if rc, ok := delta["reasoning_content"].(string); ok {
		reasoningContent = rc
	} else if r, ok := delta["reasoning"].(string); ok {
		reasoningContent = r
	}
	if reasoningContent != "" {
		stopTextBlock(state, push)
		if !state.ThinkingBlockStarted {
			state.ThinkingBlockIndex = state.NextBlockIndex
			state.NextBlockIndex++
			state.ThinkingBlockStarted = true
			push(map[string]any{
				"type":  "content_block_start",
				"index": state.ThinkingBlockIndex,
				"content_block": map[string]any{
					"type":    "thinking",
					"thinking": "",
				},
			})
		}
		push(map[string]any{
			"type":  "content_block_delta",
			"index": state.ThinkingBlockIndex,
			"delta": map[string]any{
				"type":     "thinking_delta",
				"thinking": reasoningContent,
			},
		})
	}

	// Regular text content.
	if content, ok := delta["content"].(string); ok && content != "" {
		stopThinkingBlock(state, push)
		if !state.TextBlockStarted {
			state.TextBlockIndex = state.NextBlockIndex
			state.NextBlockIndex++
			state.TextBlockStarted = true
			state.TextBlockClosed = false
			push(map[string]any{
				"type":  "content_block_start",
				"index": state.TextBlockIndex,
				"content_block": map[string]any{
					"type": "text",
					"text": "",
				},
			})
		}
		push(map[string]any{
			"type":  "content_block_delta",
			"index": state.TextBlockIndex,
			"delta": map[string]any{
				"type": "text_delta",
				"text": content,
			},
		})
	}

	// Tool calls.
	if toolCalls, ok := delta["tool_calls"].([]any); ok {
		if state.ToolCalls == nil {
			state.ToolCalls = map[string]any{}
		}
		if state.ToolArgBuffers == nil {
			state.ToolArgBuffers = map[string]any{}
		}
		for _, tcRaw := range toolCalls {
			tc, ok := tcRaw.(map[string]any)
			if !ok {
				continue
			}
			idx := "0"
			if i, ok := tc["index"].(float64); ok {
				idx = fmt.Sprintf("%d", int(i))
			}
			if tcID, ok := tc["id"].(string); ok && tcID != "" {
				stopThinkingBlock(state, push)
				stopTextBlock(state, push)
				toolBlockIndex := state.NextBlockIndex
				state.NextBlockIndex++
				fnName := ""
				if fn, ok := tc["function"].(map[string]any); ok {
					if n, ok := fn["name"].(string); ok {
						fnName = n
					}
				}
				state.ToolCalls[idx] = map[string]any{
					"id":         tcID,
					"name":       fnName,
					"blockIndex": toolBlockIndex,
				}
				push(map[string]any{
					"type":  "content_block_start",
					"index": toolBlockIndex,
					"content_block": map[string]any{
						"type":  "tool_use",
						"id":    tcID,
						"name":  fnName,
						"input": map[string]any{},
					},
				})
			}
			if fn, ok := tc["function"].(map[string]any); ok {
				if args, ok := fn["arguments"].(string); ok && args != "" {
					if existing, ok := state.ToolArgBuffers[idx].(string); ok {
						state.ToolArgBuffers[idx] = existing + args
					} else {
						state.ToolArgBuffers[idx] = args
					}
				}
			}
		}
	}

	// Finish.
	if finishReason, ok := choice["finish_reason"].(string); ok && finishReason != "" {
		stopThinkingBlock(state, push)
		stopTextBlock(state, push)

		if state.ToolCalls != nil {
			for _, idxRaw := range []string{} {
				_ = idxRaw
			}
			for idx, toolInfoRaw := range state.ToolCalls {
				toolInfo, ok := toolInfoRaw.(map[string]any)
				if !ok {
					continue
				}
				blockIndex, _ := toolInfo["blockIndex"].(int)
				if buffered, ok := state.ToolArgBuffers[idx].(string); ok && buffered != "" {
					push(map[string]any{
						"type":  "content_block_delta",
						"index": blockIndex,
						"delta": map[string]any{
							"type":         "input_json_delta",
							"partial_json": buffered,
						},
					})
				}
				push(map[string]any{
					"type":  "content_block_stop",
					"index": blockIndex,
				})
			}
		}

		state.FinishReason = finishReason
		finalUsage := state.Usage
		if finalUsage == nil {
			finalUsage = map[string]any{
				"input_tokens":  0,
				"output_tokens": 0,
			}
		}
		push(messageDelta(convertFinishReasonKiro(finishReason), finalUsage))
		push(messageStop())
	}

	if len(results) == 0 {
		return nil, nil
	}
	return results, nil
}

func convertFinishReasonKiro(reason string) string {
	switch reason {
	case "stop":
		return "end_turn"
	case "length":
		return "max_tokens"
	case "tool_calls":
		return "tool_use"
	default:
		return "end_turn"
	}
}

// kiroToClaudeNonStreaming converts a non-streaming Kiro (OpenAI-shaped) response to Claude format.
func kiroToClaudeNonStreaming(data map[string]any) map[string]any {
	content := []map[string]any{}
	choices, ok := data["choices"].([]any)
	var message map[string]any
	if ok && len(choices) > 0 {
		if c, ok := choices[0].(map[string]any); ok {
			if m, ok := c["message"].(map[string]any); ok {
				message = m
			}
		}
	}
	if message == nil {
		message = map[string]any{}
	}

	if text, ok := message["content"].(string); ok && text != "" {
		content = append(content, map[string]any{
			"type": "text",
			"text": text,
		})
	}

	if toolCalls, ok := message["tool_calls"].([]any); ok {
		for _, tcRaw := range toolCalls {
			tc, ok := tcRaw.(map[string]any)
			if !ok {
				continue
			}
			var input map[string]any
			if fn, ok := tc["function"].(map[string]any); ok {
				if args, ok := fn["arguments"].(string); ok {
					_ = json.Unmarshal([]byte(args), &input)
				}
			}
			if input == nil {
				input = map[string]any{}
			}
			id, _ := tc["id"].(string)
			if id == "" {
				id = fmt.Sprintf("toolu_%d", time.Now().UnixMilli())
			}
			name := ""
			if fn, ok := tc["function"].(map[string]any); ok {
				name, _ = fn["name"].(string)
			}
			content = append(content, map[string]any{
				"type":  "tool_use",
				"id":    id,
				"name":  name,
				"input": input,
			})
		}
	}

	usage, _ := data["usage"].(map[string]any)
	promptTokens := 0
	if pt, ok := usage["prompt_tokens"].(float64); ok {
		promptTokens = int(pt)
	}
	completionTokens := 0
	if ct, ok := usage["completion_tokens"].(float64); ok {
		completionTokens = int(ct)
	}

	finishReason := "stop"
	if choices != nil {
		if c, ok := choices[0].(map[string]any); ok {
			if fr, ok := c["finish_reason"].(string); ok && fr != "" {
				finishReason = fr
			}
		}
	}

	return map[string]any{
		"id":           fmt.Sprintf("msg_%d", time.Now().UnixMilli()),
		"type":         "message",
		"role":         "assistant",
		"content":      content,
		"model":        defaultStr(data["model"], "kiro"),
		"stop_reason":  convertFinishReasonKiro(finishReason),
		"usage": map[string]any{
			"input_tokens":  promptTokens,
			"output_tokens": completionTokens,
		},
	}
}

func defaultStr(v any, d string) string {
	if s, ok := v.(string); ok && s != "" {
		return s
	}
	return d
}
