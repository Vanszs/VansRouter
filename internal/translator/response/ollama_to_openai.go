package response

import (
	"strconv"
	"time"

	"github.com/9router/9router/internal/translator"
	"github.com/9router/9router/internal/translator/concerns"
	"github.com/9router/9router/internal/translator/schema"
)

func init() {
	translator.Register(string(translator.FormatOllama), string(translator.FormatOpenAI), nil, ollamaToOpenAIResponse)
}

func ollamaToOpenAIResponse(chunk map[string]any, state *translator.State) ([]map[string]any, error) {
	if chunk == nil {
		return nil, nil
	}

	if state.MessageID == "" {
		state.MessageID = "chatcmpl-" + strconv.FormatInt(time.Now().UnixMilli(), 10)
	}
	if state.Model == "" {
		if m, ok := chunk["model"].(string); ok {
			state.Model = m
		} else {
			state.Model = schema.ModelFallback["ollama"]
		}
	}

	meta := map[string]any{
		"id":      "chatcmpl-" + state.MessageID,
		"created": int(time.Now().Unix()),
		"model":   state.Model,
	}

	// Final chunk with done=true
	if done, _ := chunk["done"].(bool); done {
		reason, _ := chunk["done_reason"].(string)
		finishReason := concerns.ToOpenAIFinish(reason, "ollama")
		if finishReason == "" {
			finishReason = schema.OpenAIFinishReason["stop"]
		}
		usage := concerns.ToOpenAIUsage(chunk, "ollama")
		final := concerns.BuildChunk(meta, map[string]any{}, finishReason)
		if usage != nil {
			final["usage"] = usage
		}
		return []map[string]any{final}, nil
	}

	// Content chunk
	msg, ok := chunk["message"].(map[string]any)
	if !ok {
		return nil, nil
	}

	var results []map[string]any
	delta := map[string]any{}

	if content, ok := msg["content"].(string); ok && content != "" {
		delta["content"] = content
	}
	if thinking, ok := msg["thinking"].(string); ok && thinking != "" {
		delta["reasoning_content"] = thinking
	}

	if tcs, ok := msg["tool_calls"].([]any); ok && len(tcs) > 0 {
		delta["tool_calls"] = convertOllamaToolCalls(tcs)
	}

	if len(delta) > 0 {
		results = append(results, concerns.BuildChunk(meta, delta, ""))
	}

	return results, nil
}

func convertOllamaToolCalls(toolCalls []any) []map[string]any {
	out := make([]map[string]any, 0, len(toolCalls))
	for i, tc := range toolCalls {
		m, ok := tc.(map[string]any)
		if !ok {
			continue
		}
		fn, _ := m["function"].(map[string]any)
		if fn == nil {
			fn = map[string]any{}
		}
		idx := i
		if n, ok := fn["index"].(int); ok {
			idx = n
		} else if n, ok := fn["index"].(float64); ok {
			idx = int(n)
		}
		id, _ := m["id"].(string)
		if id == "" {
			id = concerns.FallbackToolCallID()
		}
		name, _ := fn["name"].(string)
		args := ""
		if a, ok := fn["arguments"].(string); ok {
			args = a
		} else {
			args = concerns.MarshalJSON(fn["arguments"])
		}
		out = append(out, map[string]any{
			"index": idx,
			"id":    id,
			"type":  schema.OpenAIBlockTypeFunction,
			"function": map[string]any{
				"name":      name,
				"arguments": args,
			},
		})
	}
	return out
}
