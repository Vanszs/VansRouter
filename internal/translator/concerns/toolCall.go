package concerns

import (
	"crypto/rand"
	"encoding/hex"

	"github.com/9router/9router/internal/translator/schema"
)

// EnsureToolCallIds ensures every tool_call has an id.
func EnsureToolCallIds(toolCalls []map[string]any) []map[string]any {
	for _, tc := range toolCalls {
		if tc["id"] == nil || tc["id"] == "" {
			tc["id"] = generateToolCallID()
		}
	}
	return toolCalls
}

// FixMissingToolResponses inserts empty tool responses for assistant tool_calls
// that are not immediately followed by a matching tool message.
func FixMissingToolResponses(messages []map[string]any) []map[string]any {
	for i := 0; i < len(messages); i++ {
		msg := messages[i]
		if role, _ := msg["role"].(string); role != schema.RoleAssistant {
			continue
		}
		toolCalls, ok := msg["tool_calls"].([]map[string]any)
		if !ok || len(toolCalls) == 0 {
			continue
		}

		responded := map[string]bool{}
		insertPos := i + 1
		for j := i + 1; j < len(messages); j++ {
			next := messages[j]
			if role, _ := next["role"].(string); role != schema.RoleTool {
				break
			}
			if id, _ := next["tool_call_id"].(string); id != "" {
				responded[id] = true
				insertPos = j + 1
			}
		}

		var missing []map[string]any
		for _, tc := range toolCalls {
			id, _ := tc["id"].(string)
			if id != "" && !responded[id] {
				missing = append(missing, map[string]any{
					"role":          schema.RoleTool,
					"tool_call_id":  id,
					"content":       "[No response received]",
				})
			}
		}

		if len(missing) > 0 {
			messages = append(messages[:insertPos], append(missing, messages[insertPos:]...)...)
			i = insertPos + len(missing) - 1
		}
	}
	return messages
}

// EnsureToolCallIdsInBody walks body.messages and ensures tool_calls have ids.
func EnsureToolCallIdsInBody(body map[string]any) {
	msgs, ok := body["messages"].([]map[string]any)
	if !ok {
		return
	}
	for _, msg := range msgs {
		if tcs, ok := msg["tool_calls"].([]map[string]any); ok {
			msg["tool_calls"] = EnsureToolCallIds(tcs)
		}
	}
}

func generateToolCallID() string {
	b := make([]byte, 12)
	_, _ = rand.Read(b)
	return "call_" + hex.EncodeToString(b)
}

// FallbackToolCallID returns a streaming tool_call id when the provider omits one.
func FallbackToolCallID() string {
	return generateToolCallID()
}
