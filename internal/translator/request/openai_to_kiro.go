package request

import (
	"strings"

	"github.com/9router/9router/internal/translator"
	"github.com/9router/9router/internal/translator/concerns"
	"github.com/9router/9router/internal/translator/kiro"
	"github.com/9router/9router/internal/translator/schema"
)

func init() {
	translator.Register(string(translator.FormatOpenAI), string(translator.FormatKiro), openaiToKiroRequest, nil)
}

// openaiToKiroRequest converts OpenAI chat completions format to Kiro CodeWhisperer format.
//
// Two 400-guards from the Node.js port are reproduced:
//  1. flattenOpenAIToolInteractions — when no tools are sent, collapse every tool_use/tool_result
//     block into plain text so no structured tool reference survives to trigger Kiro's
//     "tools required" 400.
//  2. reconcileKiroOrphanedToolResults — when tools ARE present, fold any tool_result whose
//     tool_use_id has no matching assistant tool_use back into the user text.
func openaiToKiroRequest(model string, body map[string]any, stream bool, creds any) (map[string]any, error) {
	upstreamModel, agentic := kiro.ResolveUpstreamModel(model)
	profileArn := kiro.ResolveProfileArn(creds)

	// Extract messages
	var messages []map[string]any
	if msgs, ok := body["messages"].([]any); ok {
		for _, m := range msgs {
			if msg, ok := m.(map[string]any); ok {
				messages = append(messages, msg)
			}
		}
	} else if msgs, ok := body["messages"].([]map[string]any); ok {
		messages = msgs
	}

	// Extract tools
	var tools []map[string]any
	if t, ok := body["tools"].([]any); ok {
		for _, item := range t {
			if tool, ok := item.(map[string]any); ok {
				tools = append(tools, tool)
			}
		}
	} else if t, ok := body["tools"].([]map[string]any); ok {
		tools = t
	}

	clientProvidedTools := len(tools) > 0

	// Guard 1: flatten tool interactions when client didn't send tools
	if !clientProvidedTools {
		messages = flattenOpenAIToolInteractions(messages)
	}

	// Extract parameters
	temperature := extractFloat(body["temperature"])
	topP := extractFloat(body["top_p"])

	// Convert messages to Kiro conversation state
	history, currentMessage, toolSpecs := convertOpenAIMessagesToKiro(messages, tools, upstreamModel)

	// Guard 2: reconcile orphaned tool results when tools present
	if clientProvidedTools {
		reconcileKiroOrphanedToolResults(history, currentMessage)
	}

	// Build final content with prefix
	prefix := kiro.BuildPrefixContent(0, agentic)
	finalContent := prefix + "\n\n" + currentMessage.Content

	// Build payload
	payload := map[string]any{
		"conversationState": map[string]any{
			"chatTriggerType": "MANUAL",
			"conversationId":  kiro.GenerateUUID(),
			"currentMessage": map[string]any{
				"userInputMessage": buildKiroUserMessage(finalContent, upstreamModel, currentMessage.ToolResults, currentMessage.Images, toolSpecs),
			},
			"history": history,
		},
	}

	// Add profile ARN
	if profileArn != "" {
		payload["profileArn"] = profileArn
	}

	// Add inference config
	if temperature > 0 || topP > 0 {
		inferenceConfig := map[string]any{}
		if temperature > 0 {
			inferenceConfig["temperature"] = temperature
		}
		if topP > 0 {
			inferenceConfig["topP"] = topP
		}
		if len(inferenceConfig) > 0 {
			payload["inferenceConfig"] = inferenceConfig
		}
	}

	// Hardcoded maxTokens for Kiro (32000)
	payload["inferenceConfig"] = ensureInferenceConfig(payload["inferenceConfig"])
	if ic, ok := payload["inferenceConfig"].(map[string]any); ok {
		ic["maxTokens"] = kiro.DefaultMaxTokens
	}

	return payload, nil
}

func ensureInferenceConfig(v any) map[string]any {
	if m, ok := v.(map[string]any); ok {
		return m
	}
	return map[string]any{}
}

// kiroMessage holds the state of a Kiro userInputMessage being built.
type kiroMessage struct {
	Content     string
	ToolResults []map[string]any
	Images      []map[string]any
}

// flattenOpenAIToolInteractions collapses all tool calls/results into plain text when
// the client did not send any tools. Prevents Kiro's 400 "tools required" response.
func flattenOpenAIToolInteractions(messages []map[string]any) []map[string]any {
	var out []map[string]any

	for _, msg := range messages {
		role, _ := msg["role"].(string)

		switch role {
		case schema.RoleTool:
			// Tool result → user text
			content := ""
			if s, ok := msg["content"].(string); ok {
				content = s
			}
			out = append(out, map[string]any{
				"role":    schema.RoleUser,
				"content": kiro.ToolResultToText(content),
			})

		case schema.RoleAssistant:
			var parts []string

			// Text content
			switch c := msg["content"].(type) {
			case string:
				if c != "" {
					parts = append(parts, c)
				}
			case []any:
				for _, item := range c {
					if m, ok := item.(map[string]any); ok {
						if blockType, _ := m["type"].(string); blockType == schema.ClaudeBlockTypeToolUse {
							parts = append(parts, kiro.ToolUseToText(
								strOr(m["name"]),
								m["input"],
							))
						} else if t, ok := m["text"].(string); ok && t != "" {
							parts = append(parts, t)
						}
					}
				}
			case []map[string]any:
				for _, m := range c {
					if blockType, _ := m["type"].(string); blockType == schema.ClaudeBlockTypeToolUse {
						parts = append(parts, kiro.ToolUseToText(
							strOr(m["name"]),
							m["input"],
						))
					} else if t, ok := m["text"].(string); ok && t != "" {
						parts = append(parts, t)
					}
				}
			}

			// tool_calls (OpenAI shape)
			if tcs, ok := msg["tool_calls"].([]any); ok {
				for _, tc := range tcs {
					if m, ok := tc.(map[string]any); ok {
						fn, _ := m["function"].(map[string]any)
						parts = append(parts, kiro.ToolUseToText(
							strOr(fn["name"]),
							safeParseKiro(fn["arguments"]),
						))
					}
				}
			} else if tcs, ok := msg["tool_calls"].([]map[string]any); ok {
				for _, m := range tcs {
					fn, _ := m["function"].(map[string]any)
					parts = append(parts, kiro.ToolUseToText(
						strOr(fn["name"]),
						safeParseKiro(fn["arguments"]),
					))
				}
			}

			out = append(out, map[string]any{
				"role":    schema.RoleAssistant,
				"content": strings.Join(parts, "\n"),
			})

		case schema.RoleUser:
			// Replace tool_result content blocks with text; keep everything else
			newMsg := shallowCopy(msg)
			if content, ok := newMsg["content"].([]any); ok {
				var newContent []any
				for _, item := range content {
					if m, ok := item.(map[string]any); ok {
						if blockType, _ := m["type"].(string); blockType == schema.ClaudeBlockTypeToolResult {
							newContent = append(newContent, map[string]any{
								"type": schema.OpenAIBlockTypeText,
								"text": kiro.ToolResultToText(m["content"]),
							})
						} else {
							newContent = append(newContent, m)
						}
					} else {
						newContent = append(newContent, item)
					}
				}
				newMsg["content"] = newContent
			}
			out = append(out, newMsg)

		default:
			out = append(out, msg)
		}
	}
	return out
}

// reconcileKiroOrphanedToolResults folds tool results whose toolUseId has no matching
// assistant tool_use back into user text, preventing Kiro 400s.
func reconcileKiroOrphanedToolResults(history []map[string]any, current *kiroMessage) {
	// Phase 1: collect valid toolUseIds from all assistant history items
	validIDs := map[string]bool{}
	for _, h := range history {
		arm, ok := h["assistantResponseMessage"].(map[string]any)
		if !ok {
			continue
		}
		if tus, ok := arm["toolUses"].([]map[string]any); ok {
			for _, tu := range tus {
				if id, ok := tu["toolUseId"].(string); ok && id != "" {
					validIDs[id] = true
				}
			}
		}
	}

	// Phase 2: process carriers (history + current)
	type carrier struct {
		content *string
		ctx     map[string]any
	}
	var carriers []carrier

	for _, h := range history {
		if uim, ok := h["userInputMessage"].(map[string]any); ok {
			content, _ := uim["content"].(string)
			ctx, _ := uim["userInputMessageContext"].(map[string]any)
			carriers = append(carriers, carrier{content: &content, ctx: ctx})
		}
	}
	if current != nil {
		carriers = append(carriers, carrier{content: &current.Content, ctx: nil})
	}

	for _, c := range carriers {
		if c.ctx == nil {
			continue
		}
		trs, ok := c.ctx["toolResults"].([]map[string]any)
		if !ok || len(trs) == 0 {
			continue
		}

		var kept, salvaged []string
		var keptResults []map[string]any
		for _, tr := range trs {
			id, _ := tr["toolUseId"].(string)
			if validIDs[id] {
				keptResults = append(keptResults, tr)
				kept = append(kept, id)
			} else {
				salvaged = append(salvaged, kiro.ToolResultToText(tr["content"]))
			}
		}

		if len(salvaged) == 0 {
			continue
		}

		extra := strings.Join(salvaged, "\n")
		if *c.content != "" {
			*c.content = *c.content + "\n\n" + extra
		} else {
			*c.content = extra
		}

		c.ctx["toolResults"] = keptResults
		if len(keptResults) == 0 {
			if tools, ok := c.ctx["tools"].([]map[string]any); !ok || len(tools) == 0 {
				// Remove empty context — caller may need to delete the key from parent
			}
		}
	}
}

// convertOpenAIMessagesToKiro converts OpenAI messages into Kiro history and current message.
// Rules: system/tool/user → user role, merge consecutive same roles.
// Returns (history, currentMessage, toolSpecs).
func convertOpenAIMessagesToKiro(messages []map[string]any, tools []map[string]any, modelID string) ([]map[string]any, *kiroMessage, []map[string]any) {
	clientProvidedTools := len(tools) > 0
	var history []map[string]any
	var currentMsg kiroMessage

	// Build tool specs
	var toolSpecs []map[string]any
	if clientProvidedTools {
		for _, t := range tools {
			name := ""
			description := ""
			var schema_ any

			if fn, ok := t["function"].(map[string]any); ok {
				name = strOr(fn["name"])
				description = strOr(fn["description"])
				schema_ = fn["parameters"]
			} else {
				name = strOr(t["name"])
				description = strOr(t["description"])
				schema_ = t["input_schema"]
				if schema_ == nil {
					schema_ = t["parameters"]
				}
			}
			if description == "" {
				description = "Tool: " + name
			}
			if schema_ == nil {
				schema_ = map[string]any{"type": "object", "properties": map[string]any{}, "required": []any{}}
			}

			toolSpecs = append(toolSpecs, map[string]any{
				"toolSpecification": map[string]any{
					"name":        name,
					"description": description,
					"inputSchema": map[string]any{
						"json": schema_,
					},
				},
			})
		}
	}

	// Pending buffers for merging consecutive same-role messages
	var pendingUserText []string
	var pendingAssistantText []string
	var pendingToolResults []map[string]any
	var pendingImages []map[string]any
	var currentRole string
	toolsInjected := false

	flushPending := func() {
		if currentRole == schema.RoleUser {
			content := strings.TrimSpace(strings.Join(pendingUserText, "\n\n"))
			if content == "" {
				content = "continue"
			}
			userMsg := buildKiroUserMessage(content, modelID, pendingToolResults, pendingImages, nil)

			// Inject tools on first user turn only
			if clientProvidedTools && !toolsInjected && len(toolSpecs) > 0 {
				if userMsg["userInputMessageContext"] == nil {
					userMsg["userInputMessageContext"] = map[string]any{}
				}
				userMsg["userInputMessageContext"].(map[string]any)["tools"] = toolSpecs
				toolsInjected = true
			}

			history = append(history, map[string]any{"userInputMessage": userMsg})
			currentMsg = kiroMessage{
				Content:     content,
				ToolResults: pendingToolResults,
				Images:      pendingImages,
			}
			pendingUserText = nil
			pendingToolResults = nil
			pendingImages = nil
		} else if currentRole == schema.RoleAssistant {
			content := strings.TrimSpace(strings.Join(pendingAssistantText, "\n\n"))
			if content == "" {
				content = "..."
			}
			history = append(history, map[string]any{
				"assistantResponseMessage": map[string]any{"content": content},
			})
			pendingAssistantText = nil
		}
	}

	for _, msg := range messages {
		role, _ := msg["role"].(string)
		// Normalize: system/tool → user
		if role == schema.RoleSystem || role == schema.RoleTool {
			role = schema.RoleUser
		}

		// Flush on role change
		if role != currentRole && currentRole != "" {
			flushPending()
		}
		currentRole = role

		switch role {
		case schema.RoleUser:
			text, toolResults, images := extractOpenAIUserContent(msg)

			// Handle tool role (normalized from tool)
			if msg["role"] == schema.RoleTool {
				tcID, _ := msg["tool_call_id"].(string)
				content := ""
				if s, ok := msg["content"].(string); ok {
					content = s
				}
				pendingToolResults = append(pendingToolResults, map[string]any{
					"toolUseId": tcID,
					"status":    "success",
					"content":   []map[string]any{{"text": content}},
				})
			} else {
				if text != "" {
					pendingUserText = append(pendingUserText, text)
				}
				pendingToolResults = append(pendingToolResults, toolResults...)
				pendingImages = append(pendingImages, images...)
			}

		case schema.RoleAssistant:
			text, toolUses := extractOpenAIAssistantContent(msg)
			if text != "" {
				pendingAssistantText = append(pendingAssistantText, text)
			}

			if len(toolUses) > 0 {
				flushPending()
				// Append tool uses to the just-flushed assistant message
				if len(history) > 0 {
					last := history[len(history)-1]
					if arm, ok := last["assistantResponseMessage"].(map[string]any); ok {
						arm["toolUses"] = toolUses
					}
				}
				currentRole = ""
			}
		}
	}

	if currentRole != "" {
		flushPending()
	}

	// Pop last userInputMessage as currentMessage (skip trailing assistant turns)
	currentHistoryIdx := -1
	for i := len(history) - 1; i >= 0; i-- {
		if _, ok := history[i]["userInputMessage"]; ok {
			currentHistoryIdx = i
			break
		}
	}
	var popped map[string]any
	if currentHistoryIdx >= 0 {
		popped = history[currentHistoryIdx]
		history = append(history[:currentHistoryIdx], history[currentHistoryIdx+1:]...)
		if uim, ok := popped["userInputMessage"].(map[string]any); ok {
			currentMsg = kiroMessage{
				Content:     strOr(uim["content"]),
				ToolResults: extractToolResultsFromCtx(uim),
				Images:      extractImagesFromMsg(uim),
			}
		}
	}

	// Clean up history: remove tools from non-first items, empty contexts, ensure modelId
	for i, h := range history {
		uim, ok := h["userInputMessage"].(map[string]any)
		if !ok {
			continue
		}
		if ctx, ok := uim["userInputMessageContext"].(map[string]any); ok {
			if i > 0 {
				delete(ctx, "tools")
			}
			if len(ctx) == 0 {
				delete(uim, "userInputMessageContext")
			}
		}
		if _, ok := uim["modelId"]; !ok || uim["modelId"] == "" {
			uim["modelId"] = modelID
		}
	}

	// Merge consecutive user messages (Kiro requires alternating user/assistant)
	history = mergeConsecutiveUserMessages(history)

	// If no current message, create minimal
	if currentMsg.Content == "" && len(currentMsg.ToolResults) == 0 {
		currentMsg.Content = ""
	}

	return history, &currentMsg, toolSpecs
}

// buildKiroUserMessage constructs a userInputMessage map.
func buildKiroUserMessage(content, modelID string, toolResults, images, toolSpecs []map[string]any) map[string]any {
	msg := map[string]any{
		"content": content,
		"modelId": modelID,
	}
	if len(images) > 0 {
		msg["images"] = images
	}
	var ctx map[string]any
	if len(toolResults) > 0 {
		ctx = map[string]any{"toolResults": toolResults}
	}
	if len(toolSpecs) > 0 {
		if ctx == nil {
			ctx = map[string]any{}
		}
		ctx["tools"] = toolSpecs
	}
	if len(ctx) > 0 {
		msg["userInputMessageContext"] = ctx
	}
	return msg
}

// extractOpenAIUserContent pulls text, tool results, and images from a user message.
func extractOpenAIUserContent(msg map[string]any) (string, []map[string]any, []map[string]any) {
	var textParts []string
	var toolResults []map[string]any
	var images []map[string]any

	content := msg["content"]

	switch c := content.(type) {
	case string:
		if c != "" {
			textParts = append(textParts, c)
		}
	case []any:
		for _, item := range c {
			if m, ok := item.(map[string]any); ok {
				processOpenAIContentPart(m, &textParts, &toolResults, &images)
			}
		}
	case []map[string]any:
		for _, m := range c {
			processOpenAIContentPart(m, &textParts, &toolResults, &images)
		}
	}

	return strings.Join(textParts, "\n"), toolResults, images
}

func processOpenAIContentPart(part map[string]any, textParts *[]string, toolResults, images *[]map[string]any) {
	blockType, _ := part["type"].(string)

	switch blockType {
	case schema.OpenAIBlockTypeText:
		if t, ok := part["text"].(string); ok && t != "" {
			*textParts = append(*textParts, t)
		}
	case schema.OpenAIBlockTypeImageURL:
		if iu, ok := part["image_url"].(map[string]any); ok {
			url := strOr(iu["url"])
			if parsed := concerns.ParseDataUri(url); parsed != nil {
				mimeParts := strings.SplitN(parsed.MimeType, "/", 2)
				format := parsed.MimeType
				if len(mimeParts) > 1 {
					format = mimeParts[1]
				}
				*images = append(*images, map[string]any{
					"format": format,
					"source": map[string]any{"bytes": parsed.Base64},
				})
			} else if strings.HasPrefix(url, "http") {
				*textParts = append(*textParts, "[Image: "+url+"]")
			}
		}
	case schema.ClaudeBlockTypeImage:
		if src, ok := part["source"].(map[string]any); ok {
			if srcType, _ := src["type"].(string); srcType == "base64" {
				mediaType, _ := src["media_type"].(string)
				if mediaType == "" {
					mediaType = kiro.DefaultImageMIME
				}
				data, _ := src["data"].(string)
				mimeParts := strings.SplitN(mediaType, "/", 2)
				format := mediaType
				if len(mimeParts) > 1 {
					format = mimeParts[1]
				}
				*images = append(*images, map[string]any{
					"format": format,
					"source": map[string]any{"bytes": data},
				})
			}
		}
	case schema.ClaudeBlockTypeToolResult:
		resultContent := ""
		switch v := part["content"].(type) {
		case string:
			resultContent = v
		case []any:
			var texts []string
			for _, item := range v {
				if m, ok := item.(map[string]any); ok {
					if t, ok := m["text"].(string); ok {
						texts = append(texts, t)
					}
				} else if s, ok := item.(string); ok {
					texts = append(texts, s)
				}
			}
			resultContent = strings.Join(texts, "\n")
		}
		*toolResults = append(*toolResults, map[string]any{
			"toolUseId": strOr(part["tool_use_id"]),
			"status":    "success",
			"content":   []map[string]any{{"text": resultContent}},
		})
	}
}

// extractOpenAIAssistantContent returns text and tool uses from an assistant message.
func extractOpenAIAssistantContent(msg map[string]any) (string, []map[string]any) {
	var textParts []string
	var toolUses []map[string]any

	switch c := msg["content"].(type) {
	case string:
		if c != "" {
			textParts = append(textParts, c)
		}
	case []any:
		for _, item := range c {
			if m, ok := item.(map[string]any); ok {
				if blockType, _ := m["type"].(string); blockType == schema.OpenAIBlockTypeText {
					if t, ok := m["text"].(string); ok && t != "" {
						textParts = append(textParts, t)
					}
				} else if blockType == schema.ClaudeBlockTypeToolUse {
					toolUses = append(toolUses, map[string]any{
						"toolUseId": strOr(m["id"]),
						"name":      strOr(m["name"]),
						"input":     normalizeToolInput(m["input"]),
					})
				}
			}
		}
	case []map[string]any:
		for _, m := range c {
			if blockType, _ := m["type"].(string); blockType == schema.OpenAIBlockTypeText {
				if t, ok := m["text"].(string); ok && t != "" {
					textParts = append(textParts, t)
				}
			} else if blockType == schema.ClaudeBlockTypeToolUse {
				toolUses = append(toolUses, map[string]any{
					"toolUseId": strOr(m["id"]),
					"name":      strOr(m["name"]),
					"input":     normalizeToolInput(m["input"]),
				})
			}
		}
	}

	// OpenAI tool_calls shape
	if tcs, ok := msg["tool_calls"].([]any); ok {
		for _, tc := range tcs {
			if m, ok := tc.(map[string]any); ok {
				id, _ := m["id"].(string)
				if id == "" {
					id = kiro.GenerateUUID()
				}
				fn, _ := m["function"].(map[string]any)
				toolUses = append(toolUses, map[string]any{
					"toolUseId": id,
					"name":      strOr(fn["name"]),
					"input":     safeParseKiro(fn["arguments"]),
				})
			}
		}
	} else if tcs, ok := msg["tool_calls"].([]map[string]any); ok {
		for _, m := range tcs {
			id, _ := m["id"].(string)
			if id == "" {
				id = kiro.GenerateUUID()
			}
			fn, _ := m["function"].(map[string]any)
			toolUses = append(toolUses, map[string]any{
				"toolUseId": id,
				"name":      strOr(fn["name"]),
				"input":     safeParseKiro(fn["arguments"]),
			})
		}
	}

	return strings.Join(textParts, "\n"), toolUses
}

// mergeConsecutiveUserMessages merges back-to-back userInputMessage entries in history.
func mergeConsecutiveUserMessages(history []map[string]any) []map[string]any {
	var merged []map[string]any
	for _, item := range history {
		if len(merged) == 0 {
			merged = append(merged, item)
			continue
		}
		prev := merged[len(merged)-1]
		if _, ok := item["userInputMessage"]; !ok {
			merged = append(merged, item)
			continue
		}
		prevUIM, prevOK := prev["userInputMessage"].(map[string]any)
		if !prevOK {
			merged = append(merged, item)
			continue
		}
		currUIM := item["userInputMessage"].(map[string]any)

		// Merge content
		prevContent, _ := prevUIM["content"].(string)
		currContent, _ := currUIM["content"].(string)
		prevUIM["content"] = prevContent + "\n\n" + currContent

		// Merge contexts
		prevCtx, _ := prevUIM["userInputMessageContext"].(map[string]any)
		currCtx, _ := currUIM["userInputMessageContext"].(map[string]any)
		if currCtx != nil {
			if prevCtx == nil {
				prevUIM["userInputMessageContext"] = currCtx
			} else {
				if trs, ok := currCtx["toolResults"].([]map[string]any); ok && len(trs) > 0 {
					prev := prevCtx["toolResults"]
					var prevTRs []map[string]any
					if pr, ok := prev.([]map[string]any); ok {
						prevTRs = pr
					}
					prevCtx["toolResults"] = append(prevTRs, trs...)
				}
				if tools, ok := currCtx["tools"].([]map[string]any); ok && len(tools) > 0 {
					prev := prevCtx["tools"]
					var prevTools []map[string]any
					if pt, ok := prev.([]map[string]any); ok {
						prevTools = pt
					}
					prevCtx["tools"] = append(prevTools, tools...)
				}
			}
		}
	}
	return merged
}

func normalizeToolInput(v any) any {
	if v == nil {
		return map[string]any{}
	}
	return v
}

func extractToolResultsFromCtx(uim map[string]any) []map[string]any {
	ctx, ok := uim["userInputMessageContext"].(map[string]any)
	if !ok {
		return nil
	}
	trs, _ := ctx["toolResults"].([]map[string]any)
	return trs
}

func extractImagesFromMsg(uim map[string]any) []map[string]any {
	imgs, _ := uim["images"].([]map[string]any)
	return imgs
}

func safeParseKiro(v any) any {
	if v == nil {
		return map[string]any{}
	}
	if s, ok := v.(string); ok {
		return concerns.SafeParseJSON(s, "{}")
	}
	return v
}

func shallowCopy(m map[string]any) map[string]any {
	out := make(map[string]any, len(m))
	for k, v := range m {
		out[k] = v
	}
	return out
}

func strOr(v any) string {
	if s, ok := v.(string); ok {
		return s
	}
	return ""
}
