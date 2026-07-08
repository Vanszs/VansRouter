package schema

import "testing"

func TestRoleConstants(t *testing.T) {
	tests := []struct{ name, expected string }{
		{"RoleSystem", "system"},
		{"RoleUser", "user"},
		{"RoleAssistant", "assistant"},
		{"RoleTool", "tool"},
		{"GeminiRoleUser", "user"},
		{"GeminiRoleModel", "model"},
		{"GeminiRoleFunction", "function"},
	}
	if RoleSystem != "system" {
		t.Errorf("RoleSystem = %q, want %q", RoleSystem, "system")
	}
	if RoleUser != "user" {
		t.Errorf("RoleUser = %q, want %q", RoleUser, "user")
	}
	if RoleAssistant != "assistant" {
		t.Errorf("RoleAssistant = %q, want %q", RoleAssistant, "assistant")
	}
	if RoleTool != "tool" {
		t.Errorf("RoleTool = %q, want %q", RoleTool, "tool")
	}
	if GeminiRoleUser != "user" {
		t.Errorf("GeminiRoleUser = %q, want %q", GeminiRoleUser, "user")
	}
	if GeminiRoleModel != "model" {
		t.Errorf("GeminiRoleModel = %q, want %q", GeminiRoleModel, "model")
	}
	if GeminiRoleFunction != "function" {
		t.Errorf("GeminiRoleFunction = %q, want %q", GeminiRoleFunction, "function")
	}
	_ = tests
}

func TestBlockTypeConstants(t *testing.T) {
	checks := map[string]string{
		"OpenAIBlockTypeText":       OpenAIBlockTypeText,
		"OpenAIBlockTypeImageURL":   OpenAIBlockTypeImageURL,
		"OpenAIBlockTypeInputAudio": OpenAIBlockTypeInputAudio,
		"OpenAIBlockTypeRefusal":    OpenAIBlockTypeRefusal,
		"OpenAIBlockTypeFunction":   OpenAIBlockTypeFunction,
		"OpenAIBlockTypeImage":      OpenAIBlockTypeImage,
		"OpenAIBlockTypeFile":       OpenAIBlockTypeFile,
		"ClaudeBlockTypeText":       ClaudeBlockTypeText,
		"ClaudeBlockTypeImage":      ClaudeBlockTypeImage,
		"ClaudeBlockTypeToolUse":    ClaudeBlockTypeToolUse,
		"ClaudeBlockTypeToolResult": ClaudeBlockTypeToolResult,
		"ClaudeBlockTypeThinking":   ClaudeBlockTypeThinking,
		"ClaudeBlockTypeDocument":   ClaudeBlockTypeDocument,
	}
	for name, val := range checks {
		if val == "" {
			t.Errorf("%s is empty", name)
		}
	}
}

func TestValidOpenAIContentTypes(t *testing.T) {
	if len(ValidOpenAIContentTypes) != 4 {
		t.Errorf("ValidOpenAIContentTypes len = %d, want 4", len(ValidOpenAIContentTypes))
	}
	found := map[string]bool{}
	for _, ct := range ValidOpenAIContentTypes {
		found[ct] = true
	}
	for _, want := range []string{"text", "image_url", "input_audio", "refusal"} {
		if !found[want] {
			t.Errorf("ValidOpenAIContentTypes missing %q", want)
		}
	}
}

func TestValidOpenAIMessageTypes(t *testing.T) {
	if len(ValidOpenAIMessageTypes) != 4 {
		t.Errorf("ValidOpenAIMessageTypes len = %d, want 4", len(ValidOpenAIMessageTypes))
	}
}

func TestModelFallback(t *testing.T) {
	checks := map[string]string{
		"claude": "claude-sonnet-4-20250514",
		"openai": "gpt-4o",
		"gemini": "gemini-1.5-pro-latest",
		"vertex": "gemini-1.5-pro-latest",
		"ollama": "llama3",
	}
	for key, want := range checks {
		if got, ok := ModelFallback[key]; !ok {
			t.Errorf("ModelFallback missing key %q", key)
		} else if got != want {
			t.Errorf("ModelFallback[%q] = %q, want %q", key, got, want)
		}
	}
}

func TestDefaultImageMIME(t *testing.T) {
	if DefaultImageMIME != "image/png" {
		t.Errorf("DefaultImageMIME = %q, want %q", DefaultImageMIME, "image/png")
	}
}

func TestOpenAIFinishReason(t *testing.T) {
	checks := map[string]string{
		"stop":            "stop",
		"length":          "length",
		"tool_calls":      "tool_calls",
		"content_filter":  "content_filter",
		"function_call":   "function_call",
	}
	for in, want := range checks {
		if got, ok := OpenAIFinishReason[in]; !ok {
			t.Errorf("OpenAIFinishReason missing %q", in)
		} else if got != want {
			t.Errorf("OpenAIFinishReason[%q] = %q, want %q", in, got, want)
		}
	}
}

func TestClaudeStopReason(t *testing.T) {
	checks := map[string]string{
		"end_turn":       "stop",
		"max_tokens":     "length",
		"stop_sequence":  "stop",
		"tool_use":       "tool_calls",
		"content_filter": "content_filter",
	}
	for in, want := range checks {
		if got, ok := ClaudeStopReason[in]; !ok {
			t.Errorf("ClaudeStopReason missing %q", in)
		} else if got != want {
			t.Errorf("ClaudeStopReason[%q] = %q, want %q", in, got, want)
		}
	}
}

func TestGeminiFinishReason(t *testing.T) {
	checks := map[string]string{
		"STOP":                     "stop",
		"MAX_TOKENS":               "length",
		"SAFETY":                   "content_filter",
		"RECITATION":               "content_filter",
		"OTHER":                    "stop",
		"FINISH_REASON_UNSPECIFIED": "stop",
	}
	for in, want := range checks {
		if got, ok := GeminiFinishReason[in]; !ok {
			t.Errorf("GeminiFinishReason missing %q", in)
		} else if got != want {
			t.Errorf("GeminiFinishReason[%q] = %q, want %q", in, got, want)
		}
	}
}
