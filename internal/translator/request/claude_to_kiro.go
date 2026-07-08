package request

import (
	"strings"

	"github.com/9router/9router/internal/translator"
	"github.com/9router/9router/internal/translator/kiro"
	"github.com/9router/9router/internal/translator/schema"
)

func init() {
	translator.Register(string(translator.FormatClaude), string(translator.FormatKiro), claudeToKiroRequest, nil)
}

// claudeToKiroRequest converts Claude Messages API format to Kiro CodeWhisperer format.
func claudeToKiroRequest(model string, body map[string]any, stream bool, creds any) (map[string]any, error) {
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

	// Extract system prompt
	var systemText string
	if sys, ok := body["system"]; ok {
		systemText = extractClaudeSystemText(sys)
	}

	// Extract parameters
	maxTokens := extractInt(body["max_tokens"])
	if maxTokens == 0 {
		maxTokens = kiro.DefaultMaxTokens
	}
	temperature := extractFloat(body["temperature"])
	topP := extractFloat(body["top_p"])

	// Convert messages to Kiro conversation state
	conversationState := convertClaudeMessagesToKiroState(messages, tools, upstreamModel)

	// Build prefix content (thinking, timestamp, agentic)
	prefix := kiro.BuildPrefixContent(0, agentic)
	finalContent := prefix + "\n\n"
	if systemText != "" {
		finalContent += systemText + "\n\n"
	}
	finalContent += conversationState.CurrentMessage

	// Build payload
	payload := map[string]any{
		"conversationState": map[string]any{
			"chatTriggerType": "MANUAL",
			"conversationId":  kiro.GenerateUUID(),
			"currentMessage": map[string]any{
				"userInputMessage": map[string]any{
					"content": finalContent,
					"modelId": upstreamModel,
					"origin":  "AI_EDITOR",
				},
			},
			"history": conversationState.History,
		},
	}

	// Add profile ARN if available
	if profileArn != "" {
		payload["profileArn"] = profileArn
	}

	// Add inference config
	if maxTokens > 0 || temperature > 0 || topP > 0 {
		inferenceConfig := map[string]any{}
		if maxTokens > 0 {
			inferenceConfig["maxTokens"] = maxTokens
		}
		if temperature > 0 {
			inferenceConfig["temperature"] = temperature
		}
		if topP > 0 {
			inferenceConfig["topP"] = topP
		}
		payload["inferenceConfig"] = inferenceConfig
	}

	// Add tool specs to current message if tools present
	if len(tools) > 0 && len(conversationState.ToolSpecs) > 0 {
		currentMsg := payload["conversationState"].(map[string]any)["currentMessage"].(map[string]any)
		userMsg := currentMsg["userInputMessage"].(map[string]any)
		userMsg["userInputMessageContext"] = map[string]any{
			"tools": conversationState.ToolSpecs,
		}
	}

	return payload, nil
}

type kiroConversationState struct {
	CurrentMessage string
	History        []map[string]any
	ToolSpecs      []map[string]any
}

func convertClaudeMessagesToKiroState(messages []map[string]any, tools []map[string]any, modelID string) kiroConversationState {
	var history []map[string]any
	var currentMessage string

	// Build tool specs
	var toolSpecs []map[string]any
	for _, tool := range tools {
		name, _ := tool["name"].(string)
		description, _ := tool["description"].(string)
		inputSchema := tool["input_schema"]
		if inputSchema == nil {
			inputSchema = map[string]any{"type": "object", "properties": map[string]any{}}
		}

		toolSpecs = append(toolSpecs, map[string]any{
			"toolSpecification": map[string]any{
				"name":        name,
				"description": description,
				"inputSchema": map[string]any{
					"json": inputSchema,
				},
			},
		})
	}

	// Process messages
	for i, msg := range messages {
		role, _ := msg["role"].(string)
		content := msg["content"]

		if role == schema.RoleUser {
			text := extractClaudeContentText(content)
			if i == len(messages)-1 {
				// Last message is current message
				currentMessage = text
			} else {
				// Add to history
				history = append(history, map[string]any{
					"userInputMessage": map[string]any{
						"content": text,
						"modelId": modelID,
					},
				})
			}
		} else if role == schema.RoleAssistant {
			text := extractClaudeContentText(content)
			history = append(history, map[string]any{
				"assistantResponseMessage": map[string]any{
					"content": text,
				},
			})
		}
	}

	if currentMessage == "" {
		currentMessage = "continue"
	}

	return kiroConversationState{
		CurrentMessage: currentMessage,
		History:        history,
		ToolSpecs:      toolSpecs,
	}
}

func extractClaudeSystemText(sys any) string {
	switch v := sys.(type) {
	case string:
		return v
	case []any:
		var parts []string
		for _, item := range v {
			if m, ok := item.(map[string]any); ok {
				if text, ok := m["text"].(string); ok {
					parts = append(parts, text)
				}
			}
		}
		return strings.Join(parts, "\n")
	case []map[string]any:
		var parts []string
		for _, m := range v {
			if text, ok := m["text"].(string); ok {
				parts = append(parts, text)
			}
		}
		return strings.Join(parts, "\n")
	}
	return ""
}

func extractClaudeContentText(content any) string {
	switch v := content.(type) {
	case string:
		return v
	case []any:
		var parts []string
		for _, item := range v {
			if m, ok := item.(map[string]any); ok {
				if blockType, _ := m["type"].(string); blockType == schema.ClaudeBlockTypeText {
					if text, ok := m["text"].(string); ok {
						parts = append(parts, text)
					}
				}
			}
		}
		return strings.Join(parts, "\n")
	case []map[string]any:
		var parts []string
		for _, m := range v {
			if blockType, _ := m["type"].(string); blockType == schema.ClaudeBlockTypeText {
				if text, ok := m["text"].(string); ok {
					parts = append(parts, text)
				}
			}
		}
		return strings.Join(parts, "\n")
	}
	return ""
}

func extractInt(v any) int {
	switch n := v.(type) {
	case int:
		return n
	case int64:
		return int(n)
	case float64:
		return int(n)
	}
	return 0
}

func extractFloat(v any) float64 {
	switch n := v.(type) {
	case float64:
		return n
	case float32:
		return float64(n)
	case int:
		return float64(n)
	}
	return 0
}
