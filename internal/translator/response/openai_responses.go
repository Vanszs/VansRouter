package response

import (
	"strconv"
	"time"

	"github.com/9router/9router/internal/translator"
	"github.com/9router/9router/internal/translator/concerns"
	"github.com/9router/9router/internal/translator/schema"
)

// ponytail: Full Responses API streaming event sequence (response.created, response.in_progress, response.output_item.added, etc.) is simplified to the key content/tool/finish events. The full event sequence can be added when the dashboard translator playground is ported.

func init() {
	translator.Register(string(translator.FormatOpenAI), string(translator.FormatOpenAIResponses), nil, openaiToOpenAIResponsesResponse)
	translator.Register(string(translator.FormatOpenAIResponses), string(translator.FormatOpenAI), nil, openaiResponsesToOpenAIResponse)
}

// openaiToOpenAIResponsesResponse converts Chat Completions chunks to Responses API events
func openaiToOpenAIResponsesResponse(chunk map[string]any, state *translator.State) ([]map[string]any, error) {
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
		if id, ok := chunk["id"].(string); ok {
			state.MessageID = "resp_" + id
		} else {
			state.MessageID = "resp_" + strconv.FormatInt(time.Now().UnixMilli(), 10)
		}
		if m, ok := chunk["model"].(string); ok {
			state.Model = m
		}
	}

	var results []map[string]any

	// Reasoning content
	if rc, ok := delta["reasoning_content"].(string); ok && rc != "" {
		results = append(results, map[string]any{
			"event": "response.reasoning_summary_text.delta",
			"data": map[string]any{
				"type":           "response.reasoning_summary_text.delta",
				"item_id":        state.MessageID,
				"output_index":   0,
				"summary_index":  0,
				"delta":          rc,
			},
		})
	}

	// Text content
	if content, ok := delta["content"].(string); ok && content != "" {
		results = append(results, map[string]any{
			"event": "response.output_text.delta",
			"data": map[string]any{
				"type":          "response.output_text.delta",
				"item_id":       "msg_" + state.MessageID,
				"output_index":  0,
				"content_index": 0,
				"delta":         content,
				"logprobs":      []any{},
			},
		})
	}

	// Tool calls
	if tcs, ok := delta["tool_calls"].([]any); ok {
		for _, tc := range tcs {
			if m, ok := tc.(map[string]any); ok {
				if id, ok := m["id"].(string); ok && id != "" {
					fn, _ := m["function"].(map[string]any)
					if fn == nil {
						fn = map[string]any{}
					}
					results = append(results, map[string]any{
						"event": "response.output_item.added",
						"data": map[string]any{
							"type":          "response.output_item.added",
							"output_index":  state.ToolCallIndex,
							"item": map[string]any{
								"id":      "fc_" + id,
								"type":    schema.ResponsesItemTypeFunctionCall,
								"arguments": "",
								"call_id": id,
								"name":   stringOr(fn["name"], ""),
							},
						},
					})
				}
				if fn, ok := m["function"].(map[string]any); ok {
					if args, ok := fn["arguments"].(string); ok && args != "" {
						results = append(results, map[string]any{
							"event": "response.function_call_arguments.delta",
							"data": map[string]any{
								"type":          "response.function_call_arguments.delta",
								"item_id":       "fc_" + state.MessageID,
								"output_index":  state.ToolCallIndex,
								"delta":         args,
							},
						})
					}
				}
			}
		}
		state.ToolCallIndex++
	}

	// Finish
	if finishReason != "" {
		if state.ToolCallIndex > 0 {
			finishReason = "tool_calls"
		}
		results = append(results, map[string]any{
			"event": "response.completed",
			"data": map[string]any{
				"type": "response.completed",
				"response": map[string]any{
					"id":         state.MessageID,
					"object":     "response",
					"created_at": int(time.Now().Unix()),
					"status":     "completed",
					"background": false,
					"error":      nil,
				},
			},
		})
	}

	return results, nil
}

// openaiResponsesToOpenAIResponse converts Responses API events to Chat Completions chunks
func openaiResponsesToOpenAIResponse(chunk map[string]any, state *translator.State) ([]map[string]any, error) {
	if chunk == nil {
		return nil, nil
	}

	if state.MessageID == "" {
		state.MessageID = "chatcmpl-" + strconv.FormatInt(time.Now().UnixMilli(), 10)
		state.Model = schema.ModelFallback["openai"]
	}

	meta := func() map[string]any {
		return map[string]any{
			"id":      state.MessageID,
			"created": int(time.Now().Unix()),
			"model":   state.Model,
		}
	}

	eventType, _ := chunk["type"].(string)
	if eventType == "" {
		eventType, _ = chunk["event"].(string)
	}
	data := chunk
	if d, ok := chunk["data"].(map[string]any); ok {
		data = d
	}

	switch eventType {
	case "response.output_text.delta":
		delta, _ := data["delta"].(string)
		if delta == "" {
			return nil, nil
		}
		return []map[string]any{concerns.BuildChunk(meta(), map[string]any{"content": delta}, "")}, nil

	case "response.output_item.added":
		item, _ := data["item"].(map[string]any)
		if item == nil {
			return nil, nil
		}
		itemType, _ := item["type"].(string)
		if itemType != schema.ResponsesItemTypeFunctionCall && itemType != "custom_tool_call" {
			return nil, nil
		}
		callId, _ := item["call_id"].(string)
		if callId == "" {
			callId = concerns.FallbackToolCallID()
		}
		name, _ := item["name"].(string)
		idx := state.ToolCallIndex
		state.ToolCallIndex++
		return []map[string]any{concerns.BuildChunk(meta(), map[string]any{
			"tool_calls": []map[string]any{{
				"index":    idx,
				"id":       callId,
				"type":     schema.OpenAIBlockTypeFunction,
				"function": map[string]any{"name": name, "arguments": ""},
			}},
		}, "")}, nil

	case "response.function_call_arguments.delta", "response.custom_tool_call_input.delta":
		delta, _ := data["delta"].(string)
		if delta == "" {
			return nil, nil
		}
		return []map[string]any{concerns.BuildChunk(meta(), map[string]any{
			"tool_calls": []map[string]any{{
				"index":    state.ToolCallIndex - 1,
				"function": map[string]any{"arguments": delta},
			}},
		}, "")}, nil

	case "response.output_item.done":
		item, _ := data["item"].(map[string]any)
		if item == nil {
			return nil, nil
		}
		itemType, _ := item["type"].(string)
		if itemType != schema.ResponsesItemTypeFunctionCall && itemType != "custom_tool_call" {
			return nil, nil
		}
		// Tool call completed — no output needed, index already incremented
		return nil, nil

	case "response.completed", "response.done":
		if state.FinishReasonSent {
			return nil, nil
		}
		finishReason := "stop"
		if state.ToolCallIndex > 0 {
			finishReason = "tool_calls"
		}
		// Extract usage
		if resp, ok := data["response"].(map[string]any); ok {
			if usage, ok := resp["usage"].(map[string]any); ok {
				inputTokens := concerns.IntNumber(usage["input_tokens"])
				if inputTokens == 0 {
					inputTokens = concerns.IntNumber(usage["prompt_tokens"])
				}
				outputTokens := concerns.IntNumber(usage["output_tokens"])
				if outputTokens == 0 {
					outputTokens = concerns.IntNumber(usage["completion_tokens"])
				}
				state.Usage = map[string]any{
					"prompt_tokens":     inputTokens,
					"completion_tokens": outputTokens,
					"total_tokens":      inputTokens + outputTokens,
				}
			}
		}
		final := concerns.BuildChunk(meta(), map[string]any{}, finishReason)
		if state.Usage != nil {
			final["usage"] = state.Usage
		}
		state.FinishReasonSent = true
		return []map[string]any{final}, nil

	case "response.reasoning_summary_text.delta":
		delta, _ := data["delta"].(string)
		if delta == "" {
			return nil, nil
		}
		return []map[string]any{concerns.BuildChunk(meta(), concerns.ReasoningDelta(delta), "")}, nil

	case "error", "response.failed":
		if state.FinishReasonSent {
			return nil, nil
		}
		errVal := data["error"]
		if errVal == nil {
			if resp, ok := data["response"].(map[string]any); ok {
				errVal = resp["error"]
			}
		}
		errStr := ""
		if e, ok := errVal.(map[string]any); ok {
			if m, ok := e["message"].(string); ok {
				errStr = m
			} else {
				errStr = concerns.MarshalJSON(e)
			}
		} else if s, ok := errVal.(string); ok {
			errStr = s
		}
		state.FinishReasonSent = true
		return []map[string]any{concerns.BuildChunk(meta(), map[string]any{"content": "[Error] " + errStr}, "stop")}, nil
	}

	return nil, nil
}
