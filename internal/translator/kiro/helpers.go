package kiro

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"strings"
	"time"
)

// Kiro-specific constants for translator use.

const (
	// AgenticSuffix is the synthetic model suffix that triggers chunked-write system prompt injection.
	AgenticSuffix = "-agentic"

	// ThinkingSuffix is the synthetic model suffix that forces reasoning.
	ThinkingSuffix = "-thinking"

	// DefaultMaxTokens for Kiro requests.
	DefaultMaxTokens = 32000

	// DefaultImageMIME when none is specified.
	DefaultImageMIME = "image/png"
)

// DefaultProfileARNs for shared builder-id and social profiles.
var DefaultProfileARNs = map[string]string{
	"builder-id": "arn:aws:codewhisperer:us-east-1:638616132270:profile/AAAACCCCXXXX",
	"social":      "arn:aws:codewhisperer:us-east-1:699475941385:profile/EHGA3GRVQMUK",
}

// AgenticSystemPrompt is injected when the model has the -agentic suffix.
const AgenticSystemPrompt = `
# CRITICAL: CHUNKED WRITE PROTOCOL (MANDATORY)

You MUST follow these rules for ALL file operations. Violation causes server timeouts and task failure.

## ABSOLUTE LIMITS
- **MAXIMUM 350 LINES** per single write/edit operation - NO EXCEPTIONS
- **RECOMMENDED 300 LINES** or less for optimal performance
- For files >350 lines: MUST split into multiple sequential operations
`

// ResolveUpstreamModel strips synthetic suffixes and returns the upstream model ID.
// Also returns whether the agentic prompt should be injected.
func ResolveUpstreamModel(model string) (upstream string, agentic bool) {
	if strings.HasSuffix(model, AgenticSuffix) {
		upstream = strings.TrimSuffix(model, AgenticSuffix)
		agentic = true
	} else if strings.HasSuffix(model, ThinkingSuffix) {
		upstream = strings.TrimSuffix(model, ThinkingSuffix)
	} else {
		upstream = model
	}
	return
}

// ResolveDefaultProfileArn returns the shared default ARN for the given auth method.
func ResolveDefaultProfileArn(authMethod string) string {
	if authMethod == "google" || authMethod == "github" {
		return DefaultProfileARNs["social"]
	}
	return DefaultProfileARNs["builder-id"]
}

// ResolveProfileArn picks the correct profile ARN from credentials.
// Account-bound auth (api_key, idc, external_idp) never falls back to the shared default.
func ResolveProfileArn(creds any) string {
	if creds == nil {
		return ""
	}
	credsMap, ok := creds.(map[string]any)
	if !ok {
		return ""
	}
	psd, ok := credsMap["providerSpecificData"].(map[string]any)
	if !ok {
		return ""
	}
	profileArn, _ := psd["profileArn"].(string)
	authMethod, _ := psd["authMethod"].(string)

	accountBound := authMethod == "api_key" || authMethod == "idc" || authMethod == "external_idp"
	if accountBound {
		return profileArn // may be empty, which is intentional
	}
	if profileArn != "" {
		return profileArn
	}
	return ResolveDefaultProfileArn(authMethod)
}

// BuildThinkingSystemPrefix returns the system-prompt injection for enabling Kiro reasoning.
func BuildThinkingSystemPrefix(budget int) string {
	return "<thinking_mode>enabled</thinking_mode>\n" +
		"<thinking_budget>" + itoa(budget) + "</thinking_budget>\n\n" +
		"Use extended thinking for this request. Show your reasoning process."
}

// BuildPrefixContent constructs the user-content prefix (thinking tag, timestamp, agentic prompt).
func BuildPrefixContent(thinkingBudget int, agentic bool) string {
	var parts []string
	if thinkingBudget > 0 {
		parts = append(parts, BuildThinkingSystemPrefix(thinkingBudget))
	}
	parts = append(parts, "[Context: Current time is "+time.Now().UTC().Format(time.RFC3339)+"]")
	if agentic {
		parts = append(parts, AgenticSystemPrompt)
	}
	return strings.Join(parts, "\n\n")
}

// GenerateUUID generates a random UUID v4 string.
func GenerateUUID() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	b[6] = (b[6] & 0x0f) | 0x40 // version 4
	b[8] = (b[8] & 0x3f) | 0x80 // variant 10
	return hex.EncodeToString(b[:4]) + "-" +
		hex.EncodeToString(b[4:6]) + "-" +
		hex.EncodeToString(b[6:8]) + "-" +
		hex.EncodeToString(b[8:10]) + "-" +
		hex.EncodeToString(b[10:])
}

// ToolUseToText renders a tool_use as a readable text line.
func ToolUseToText(name string, input any) string {
	var argStr string
	switch v := input.(type) {
	case string:
		argStr = v
	case nil:
		argStr = "{}"
	default:
		b, err := json.Marshal(v)
		if err != nil {
			argStr = "{}"
		} else {
			argStr = string(b)
		}
	}
	if name == "" {
		name = "unknown"
	}
	return "[Tool call: " + name + "(" + argStr + ")]"
}

// ToolResultToText renders a tool_result content as a readable text line.
func ToolResultToText(content any) string {
	var text string
	switch v := content.(type) {
	case string:
		text = v
	case []any:
		var texts []string
		for _, item := range v {
			if s, ok := item.(string); ok {
				texts = append(texts, s)
			} else if m, ok := item.(map[string]any); ok {
				if t, ok := m["text"].(string); ok {
					texts = append(texts, t)
				}
			}
		}
		text = strings.Join(texts, "\n")
	case []map[string]any:
		var texts []string
		for _, m := range v {
			if t, ok := m["text"].(string); ok {
				texts = append(texts, t)
			}
		}
		text = strings.Join(texts, "\n")
	default:
		if content != nil {
			if b, err := json.Marshal(content); err == nil {
				text = string(b)
			}
		}
	}
	return "[Tool result: " + text + "]"
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	s := ""
	neg := false
	if n < 0 {
		neg = true
		n = -n
	}
	for n > 0 {
		s = string(rune('0'+n%10)) + s
		n /= 10
	}
	if neg {
		s = "-" + s
	}
	return s
}
