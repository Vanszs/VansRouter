package response

import (
	"encoding/json"
	"strconv"
	"time"

	"github.com/9router/9router/internal/translator"
	"github.com/9router/9router/internal/translator/concerns"
	"github.com/9router/9router/internal/translator/schema"
)

func init() {
	translator.Register(string(translator.FormatCommandCode), string(translator.FormatOpenAI), nil, commandCodeToOpenAIResponse)
}

func commandCodeToOpenAIResponse(chunk map[string]any, state *translator.State) ([]map[string]any, error) {
	if chunk == nil {
		return nil, nil
	}

	// Already-OpenAI chunk: pass through
	if obj, _ := chunk["object"].(string); obj == "chat.completion.chunk" {
		return []map[string]any{chunk}, nil
	}

	meta := func() map[string]any {
		return map[string]any{
			"id":      "chatcmpl-" + state.MessageID,
			"created": int(time.Now().Unix()),
			"model":   state.Model,
		}
	}

	ensureState := func() {
		if state.MessageID == "" {
			state.MessageID = strconv.FormatInt(time.Now().UnixMilli(), 10)
		}
		if state.Model == "" {
			state.Model = "commandcode"
		}
	}

	eventType, _ := chunk["type"].(string)
	var out []map[string]any

	switch eventType {
	case "text-delta":
		text, _ := chunk["text"].(string)
		if text == "" {
			text, _ = chunk["delta"].(string)
		}
		if text == "" {
			break
		}
		ensureState()
		delta := map[string]any{"content": text}
		if state.ContentBlockIndex < 0 {
			delta["role"] = schema.RoleAssistant
		}
		state.ContentBlockIndex++
		out = append(out, concerns.BuildChunk(meta(), delta, ""))

	case "reasoning-delta":
		text, _ := chunk["text"].(string)
		if text == "" {
			break
		}
		ensureState()
		delta := concerns.ReasoningDelta(text)
		if state.ContentBlockIndex < 0 {
			delta["role"] = schema.RoleAssistant
		}
		state.ContentBlockIndex++
		out = append(out, concerns.BuildChunk(meta(), delta, ""))

	case "tool-input-start":
		ensureState()
		id, _ := chunk["id"].(string)
		if id == "" {
			id, _ = chunk["toolCallId"].(string)
		}
		if id == "" {
			id = concerns.FallbackToolCallID()
		}
		idx := state.ToolCallIndex
		state.ToolCallIndex++
		toolName, _ := chunk["toolName"].(string)
		delta := map[string]any{
			"tool_calls": []map[string]any{{
				"index":    idx,
				"id":       id,
				"type":     schema.OpenAIBlockTypeFunction,
				"function": map[string]any{"name": toolName, "arguments": ""},
			}},
		}
		if state.ContentBlockIndex < 0 {
			delta["role"] = schema.RoleAssistant
		}
		state.ContentBlockIndex++
		out = append(out, concerns.BuildChunk(meta(), delta, ""))

	case "tool-input-delta":
		id, _ := chunk["id"].(string)
		if id == "" {
			id, _ = chunk["toolCallId"].(string)
		}
		delta, _ := chunk["delta"].(string)
		if delta == "" {
			delta, _ = chunk["inputTextDelta"].(string)
		}
		// Emit arguments delta
		out = append(out, concerns.BuildChunk(meta(), map[string]any{
			"tool_calls": []map[string]any{{
				"index":    state.ToolCallIndex - 1,
				"function": map[string]any{"arguments": delta},
			}},
		}, ""))

	case "tool-call":
		ensureState()
		id, _ := chunk["toolCallId"].(string)
		idx := state.ToolCallIndex
		state.ToolCallIndex++
		toolName, _ := chunk["toolName"].(string)
		argsStr := ""
		if input, ok := chunk["input"].(string); ok {
			argsStr = input
		} else {
			argsStr = concerns.MarshalJSON(chunk["input"])
		}
		delta := map[string]any{
			"tool_calls": []map[string]any{{
				"index":    idx,
				"id":       id,
				"type":     schema.OpenAIBlockTypeFunction,
				"function": map[string]any{"name": toolName, "arguments": argsStr},
			}},
		}
		if state.ContentBlockIndex < 0 {
			delta["role"] = schema.RoleAssistant
		}
		state.ContentBlockIndex++
		out = append(out, concerns.BuildChunk(meta(), delta, ""))

	case "finish-step":
		if fr, ok := chunk["finishReason"].(string); ok {
			state.FinishReason = concerns.ToOpenAIFinish(fr, "commandcode")
		}
		if usage, ok := chunk["usage"].(map[string]any); ok {
			state.Usage = usage
		}

	case "finish":
		ensureState()
		finishReason := state.FinishReason
		if finishReason == "" {
			if fr, ok := chunk["finishReason"].(string); ok {
				finishReason = concerns.ToOpenAIFinish(fr, "commandcode")
			}
		}
		if finishReason == "" {
			finishReason = schema.OpenAIFinishReason["stop"]
		}
		final := concerns.BuildChunk(meta(), map[string]any{}, finishReason)
		var totalUsage any
		if tu, ok := chunk["totalUsage"]; ok {
			totalUsage = tu
		} else {
			totalUsage = state.Usage
		}
		if usageMap, ok := totalUsage.(map[string]any); ok {
			if u := concerns.ToOpenAIUsage(usageMap, "commandcode"); u != nil {
				final["usage"] = u
			}
		}
		out = append(out, final)

	case "error":
		ensureState()
		errVal := chunk["error"]
		if errVal == nil {
			errVal = chunk["message"]
		}
		errStr := ""
		if s, ok := errVal.(string); ok {
			errStr = s
		} else {
			b, _ := json.Marshal(errVal)
			errStr = string(b)
		}
		out = append(out, concerns.BuildChunk(meta(), map[string]any{"content": "\n\n[CommandCode error: " + errStr + "]"}, ""))
		out = append(out, concerns.BuildChunk(meta(), map[string]any{}, schema.OpenAIFinishReason["stop"]))
	}

	return out, nil
}
