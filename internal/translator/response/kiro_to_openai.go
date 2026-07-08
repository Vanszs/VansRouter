package response

import (
	"encoding/json"
	"fmt"
	"time"

	"github.com/9router/9router/internal/translator"
	"github.com/9router/9router/internal/translator/concerns"
)

func init() {
	translator.Register(string(translator.FormatKiro), string(translator.FormatOpenAI), nil, kiroToOpenAIResponse)
}

// kiroToOpenAIResponse converts Kiro streaming events to OpenAI SSE format.
// If the chunk is already in OpenAI format (from KiroExecutor transform), pass through.
// Otherwise parse Kiro event types (assistantResponseEvent, reasoningContentEvent, toolUseEvent, etc.)
func kiroToOpenAIResponse(chunk map[string]any, state *translator.State) ([]map[string]any, error) {
	if chunk == nil {
		return nil, nil
	}

	// If chunk is already OpenAI-shaped (from executor transform), return as-is.
	if obj, ok := chunk["object"].(string); ok && obj == "chat.completion.chunk" {
		if _, ok := chunk["choices"].([]any); ok {
			return []map[string]any{chunk}, nil
		}
	}

	// Initialize state if needed — use MessageID as responseId backing.
	if state.MessageID == "" {
		state.MessageID = fmt.Sprintf("chatcmpl-%d", time.Now().UnixMilli())
		if state.Responses == nil {
			state.Responses = map[string]any{}
		}
		state.Responses["kiro_created"] = int(time.Now().Unix())
		state.Responses["kiro_chunk_index"] = 0
	}

	// Detect event type.
	eventType := ""
	if et, ok := chunk["_eventType"].(string); ok {
		eventType = et
	} else if et, ok := chunk["event"].(string); ok {
		eventType = et
	}

	created := int(time.Now().Unix())
	if c, ok := state.Responses["kiro_created"].(int); ok {
		created = c
	}

	chunkIdx := 0
	if ci, ok := state.Responses["kiro_chunk_index"].(int); ok {
		chunkIdx = ci
	}

	model := state.Model
	if model == "" {
		model = "kiro"
	}

	// assistantResponseEvent — text content.
	if eventType == "assistantResponseEvent" || chunk["assistantResponseEvent"] != nil {
		content := ""
		if are, ok := chunk["assistantResponseEvent"].(map[string]any); ok {
			if c, ok := are["content"].(string); ok {
				content = c
			}
		} else if c, ok := chunk["content"].(string); ok {
			content = c
		}
		if content == "" {
			return nil, nil
		}
		delta := map[string]any{"content": content}
		if chunkIdx == 0 {
			delta["role"] = "assistant"
		}
		state.Responses["kiro_chunk_index"] = chunkIdx + 1
		return []map[string]any{buildKiroChunk(state.MessageID, created, model, delta, nil)}, nil
	}

	// reasoningContentEvent — thinking/reasoning content.
	if eventType == "reasoningContentEvent" || chunk["reasoningContentEvent"] != nil {
		var content string
		if rce, ok := chunk["reasoningContentEvent"].(map[string]any); ok {
			if t, ok := rce["text"].(string); ok {
				content = t
			} else if c, ok := rce["content"].(string); ok {
				content = c
			}
		} else if c, ok := chunk["content"].(string); ok {
			content = c
		}
		if content == "" {
			return nil, nil
		}
		delta := map[string]any{"reasoning_content": content}
		state.Responses["kiro_chunk_index"] = chunkIdx + 1
		return []map[string]any{buildKiroChunk(state.MessageID, created, model, delta, nil)}, nil
	}

	// toolUseEvent — tool call.
	if eventType == "toolUseEvent" || chunk["toolUseEvent"] != nil {
		state.Responses["kiro_had_tool_use"] = true
		var toolUse map[string]any
		if tu, ok := chunk["toolUseEvent"].(map[string]any); ok {
			toolUse = tu
		} else {
			toolUse = chunk
		}
		toolCallID, _ := toolUse["toolUseId"].(string)
		if toolCallID == "" {
			toolCallID = concerns.FallbackToolCallID()
		}
		toolName, _ := toolUse["name"].(string)
		toolInput := toolUse["input"]
		if toolInput == nil {
			toolInput = map[string]any{}
		}
		inputBytes, _ := json.Marshal(toolInput)
		delta := map[string]any{
			"tool_calls": []map[string]any{
				{
					"index": 0,
					"id":    toolCallID,
					"type":  "function",
					"function": map[string]any{
						"name":      toolName,
						"arguments": string(inputBytes),
					},
				},
			},
		}
		if chunkIdx == 0 {
			delta["role"] = "assistant"
		}
		state.Responses["kiro_chunk_index"] = chunkIdx + 1
		return []map[string]any{buildKiroChunk(state.MessageID, created, model, delta, nil)}, nil
	}

	// messageStopEvent / done — finish.
	if eventType == "messageStopEvent" || eventType == "done" || chunk["messageStopEvent"] != nil {
		finishReason := "stop"
		if h, ok := state.Responses["kiro_had_tool_use"].(bool); ok && h {
			finishReason = "tool_calls"
		}
		state.FinishReason = finishReason
		c := buildKiroChunk(state.MessageID, created, model, map[string]any{}, finishReason)
		if state.Usage != nil {
			c["usage"] = state.Usage
		}
		return []map[string]any{c}, nil
	}

	// usageEvent — track usage.
	if eventType == "usageEvent" || chunk["usageEvent"] != nil {
		var usageData map[string]any
		if ue, ok := chunk["usageEvent"].(map[string]any); ok {
			usageData = ue
		} else {
			usageData = chunk
		}
		promptTokens := 0
		if pt, ok := usageData["prompt_tokens"].(float64); ok {
			promptTokens = int(pt)
		} else if pt, ok := usageData["input_tokens"].(float64); ok {
			promptTokens = int(pt)
		}
		completionTokens := 0
		if ct, ok := usageData["completion_tokens"].(float64); ok {
			completionTokens = int(ct)
		} else if ct, ok := usageData["output_tokens"].(float64); ok {
			completionTokens = int(ct)
		}
		state.Usage = map[string]any{
			"prompt_tokens":     promptTokens,
			"completion_tokens": completionTokens,
		}
		return nil, nil
	}

	// Unknown event — skip.
	return nil, nil
}

// buildKiroChunk builds an OpenAI chat.completion.chunk.
func buildKiroChunk(id string, created int, model string, delta map[string]any, finishReason any) map[string]any {
	chunk := map[string]any{
		"id":      id,
		"object":  "chat.completion.chunk",
		"created": created,
		"model":   model,
	}
	chunk["choices"] = []map[string]any{
		{
			"index":         0,
			"delta":         delta,
			"finish_reason": finishReason,
		},
	}
	return chunk
}
