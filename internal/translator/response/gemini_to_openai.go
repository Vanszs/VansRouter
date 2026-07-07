package response

import (
	"strconv"
	"time"

	"github.com/9router/9router/internal/translator"
	"github.com/9router/9router/internal/translator/concerns"
	"github.com/9router/9router/internal/translator/schema"
)

func init() {
	translator.Register(string(translator.FormatGemini), string(translator.FormatOpenAI), nil, geminiToOpenAIResponse)
	translator.Register(string(translator.FormatVertex), string(translator.FormatOpenAI), nil, geminiToOpenAIResponse)
	translator.Register(string(translator.FormatAntigravity), string(translator.FormatOpenAI), nil, geminiToOpenAIResponse)
}

func geminiToOpenAIResponse(chunk map[string]any, state *translator.State) ([]map[string]any, error) {
	if chunk == nil {
		return nil, nil
	}

	// Handle Antigravity wrapper
	response := chunk
	if r, ok := chunk["response"].(map[string]any); ok {
		response = r
	}

	candidates, ok := response["candidates"].([]any)
	if !ok || len(candidates) == 0 {
		return nil, nil
	}
	candidate, ok := candidates[0].(map[string]any)
	if !ok {
		return nil, nil
	}

	meta := func() map[string]any {
		return map[string]any{
			"id":      "chatcmpl-" + state.MessageID,
			"created": int(time.Now().Unix()),
			"model":   state.Model,
		}
	}

	var results []map[string]any

	// Initialize state on first chunk
	if state.MessageID == "" {
		if id, ok := response["responseId"].(string); ok && id != "" {
			state.MessageID = id
		} else {
			state.MessageID = "msg_" + strconv.FormatInt(time.Now().UnixMilli(), 10)
		}
		if mv, ok := response["modelVersion"].(string); ok && mv != "" {
			state.Model = mv
		} else {
			state.Model = schema.ModelFallback["gemini"]
		}
		state.ToolCallIndex = 0
		results = append(results, concerns.BuildChunk(meta(), map[string]any{"role": schema.RoleAssistant}, ""))
	}

	// Process parts
	content, _ := candidate["content"].(map[string]any)
	if content != nil {
		if parts, ok := content["parts"].([]any); ok {
			for _, p := range parts {
				part, ok := p.(map[string]any)
				if !ok {
					continue
				}
				hasThoughtSig := part["thoughtSignature"] != nil || part["thought_signature"] != nil
				isThought := false
				if t, ok := part["thought"].(bool); ok {
					isThought = t
				}

				// Text content
				if text, ok := part["text"].(string); ok && text != "" {
					if isThought || hasThoughtSig {
						results = append(results, concerns.BuildChunk(meta(), concerns.ReasoningDelta(text), ""))
					} else {
						results = append(results, concerns.BuildChunk(meta(), map[string]any{"content": text}, ""))
					}
				}

				// Function call
				if fc, ok := part["functionCall"].(map[string]any); ok {
					results = append(results, emitGeminiFunctionCall(fc, state, meta()))
				}

				// Inline data (images)
				inlineData := part["inlineData"]
				if inlineData == nil {
					inlineData = part["inline_data"]
				}
				if id, ok := inlineData.(map[string]any); ok {
					if data, ok := id["data"].(string); ok && data != "" {
						mimeType := schema.DefaultImageMIME
						if mt, ok := id["mimeType"].(string); ok && mt != "" {
							mimeType = mt
						} else if mt, ok := id["mime_type"].(string); ok && mt != "" {
							mimeType = mt
						}
						results = append(results, concerns.BuildChunk(meta(), map[string]any{
							"images": []map[string]any{{
								"type":      schema.OpenAIBlockTypeImageURL,
								"image_url": map[string]any{"url": concerns.EncodeDataUri(mimeType, data)},
							}},
						}, ""))
					}
				}
			}
		}
	}

	// Usage metadata
	var usageMeta map[string]any
	if um, ok := response["usageMetadata"].(map[string]any); ok {
		usageMeta = um
	} else if um, ok := chunk["usageMetadata"].(map[string]any); ok {
		usageMeta = um
	}
	if usageMeta != nil {
		if geminiUsage := concerns.ToOpenAIUsage(usageMeta, "gemini"); geminiUsage != nil {
			state.Usage = geminiUsage
		}
	}

	// Finish reason
	if fr, ok := candidate["finishReason"].(string); ok && fr != "" {
		finishReason := concerns.ToOpenAIFinish(fr, "gemini")
		if finishReason == "" {
			finishReason = schema.OpenAIFinishReason["stop"]
		}
		// Override to tool_calls if we had function calls
		if finishReason == schema.OpenAIFinishReason["stop"] && state.ToolCallIndex > 0 {
			finishReason = schema.OpenAIFinishReason["tool_calls"]
		}
		final := concerns.BuildChunk(meta(), map[string]any{}, finishReason)
		if state.Usage != nil {
			final["usage"] = state.Usage
		}
		results = append(results, final)
		state.FinishReason = finishReason
	}

	return results, nil
}

func emitGeminiFunctionCall(fc map[string]any, state *translator.State, meta map[string]any) map[string]any {
	rawName, _ := fc["name"].(string)
	fcName := rawName
	if state.ToolNameMap != nil {
		if orig, ok := state.ToolNameMap[rawName]; ok {
			fcName = orig
		}
	}
	fcArgs := fc["args"]
	if fcArgs == nil {
		fcArgs = map[string]any{}
	}
	toolCallIndex := state.ToolCallIndex
	state.ToolCallIndex++

	return concerns.BuildChunk(meta, map[string]any{
		"tool_calls": []map[string]any{{
			"id":    fcName + "-" + strconv.FormatInt(time.Now().UnixMilli(), 10) + "-" + strconv.Itoa(toolCallIndex),
			"index": toolCallIndex,
			"type":  schema.OpenAIBlockTypeFunction,
			"function": map[string]any{
				"name":      fcName,
				"arguments": concerns.MarshalJSON(fcArgs),
			},
		}},
	}, "")
}
