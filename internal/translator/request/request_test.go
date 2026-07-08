package request

import (
	"testing"

	"github.com/9router/9router/internal/translator"
)

func TestOpenAIToClaude_Basic(t *testing.T) {
	body := map[string]any{
		"model":    "gpt-4o",
		"messages": []any{
			map[string]any{"role": "user", "content": "Hello"},
		},
	}
	out, err := translator.TranslateRequest(
		translator.FormatOpenAI, translator.FormatClaude,
		"claude-4", body, false, nil,
	)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if out["model"] != "claude-4" {
		t.Errorf("model = %v, want claude-4", out["model"])
	}
	if out["max_tokens"] == nil {
		t.Error("max_tokens should be set")
	}
	msgs, ok := out["messages"].([]map[string]any)
	if !ok || len(msgs) != 1 {
		t.Fatalf("messages wrong: %v", out["messages"])
	}
	if msgs[0]["role"] != "user" {
		t.Errorf("role = %v", msgs[0]["role"])
	}
}

func TestOpenAIToClaude_SystemPrompt(t *testing.T) {
	body := map[string]any{
		"messages": []any{
			map[string]any{"role": "system", "content": "You are helpful"},
			map[string]any{"role": "user", "content": "Hi"},
		},
	}
	out, err := translator.TranslateRequest(
		translator.FormatOpenAI, translator.FormatClaude,
		"claude-4", body, false, nil,
	)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	sys, ok := out["system"].([]map[string]any)
	if !ok || len(sys) == 0 {
		t.Fatalf("system prompt should be extracted, got: %T", out["system"])
	}
}

func TestOpenAIToClaude_WithTools(t *testing.T) {
	body := map[string]any{
		"messages": []any{
			map[string]any{"role": "user", "content": "Use a tool"},
		},
		"tools": []any{
			map[string]any{
				"type": "function",
				"function": map[string]any{
					"name": "get_weather",
					"parameters": map[string]any{"type": "object"},
				},
			},
		},
	}
	out, err := translator.TranslateRequest(
		translator.FormatOpenAI, translator.FormatClaude,
		"claude-4", body, false, nil,
	)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	tools, ok := out["tools"].([]map[string]any)
	if !ok || len(tools) != 1 {
		t.Fatalf("tools wrong: %v", out["tools"])
	}
	if tools[0]["name"] != "get_weather" {
		t.Errorf("tool name = %v", tools[0]["name"])
	}
}

func TestOpenAIToClaude_StreamFlag(t *testing.T) {
	body := map[string]any{
		"messages": []any{
			map[string]any{"role": "user", "content": "Hi"},
		},
	}
	out, err := translator.TranslateRequest(
		translator.FormatOpenAI, translator.FormatClaude,
		"claude-4", body, true, nil,
	)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if out["stream"] != true {
		t.Error("stream should be true")
	}
}

func TestOpenAIToClaude_Temperature(t *testing.T) {
	body := map[string]any{
		"messages":    []any{map[string]any{"role": "user", "content": "Hi"}},
		"temperature": float64(0.7),
	}
	out, err := translator.TranslateRequest(
		translator.FormatOpenAI, translator.FormatClaude,
		"claude-4", body, false, nil,
	)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if out["temperature"] != float64(0.7) {
		t.Errorf("temperature = %v, want 0.7", out["temperature"])
	}
}

func TestOpenAIToOllama_Basic(t *testing.T) {
	body := map[string]any{
		"model":    "llama3",
		"messages": []any{
			map[string]any{"role": "user", "content": "Hello"},
		},
	}
	out, err := translator.TranslateRequest(
		translator.FormatOpenAI, translator.FormatOllama,
		"llama3", body, false, nil,
	)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if out["model"] != "llama3" {
		t.Errorf("model = %v", out["model"])
	}
}

func TestOpenAIToGemini_Basic(t *testing.T) {
	body := map[string]any{
		"messages": []any{
			map[string]any{"role": "user", "content": "Hello"},
		},
	}
	out, err := translator.TranslateRequest(
		translator.FormatOpenAI, translator.FormatGemini,
		"gemini-1.5-pro", body, false, nil,
	)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if out["model"] != "gemini-1.5-pro" {
		t.Errorf("model = %v", out["model"])
	}
}

func TestOpenAIToVertex_Basic(t *testing.T) {
	body := map[string]any{
		"messages": []any{
			map[string]any{"role": "user", "content": "Hello"},
		},
	}
	out, err := translator.TranslateRequest(
		translator.FormatOpenAI, translator.FormatVertex,
		"gemini-1.5-pro", body, false, nil,
	)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if out == nil {
		t.Error("expected non-nil result")
	}
}

func TestOpenAIToCursor_Basic(t *testing.T) {
	body := map[string]any{
		"messages": []any{
			map[string]any{"role": "user", "content": "Hello"},
		},
	}
	out, err := translator.TranslateRequest(
		translator.FormatOpenAI, translator.FormatCursor,
		"gpt-4o", body, false, nil,
	)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if out == nil {
		t.Error("expected non-nil result")
	}
}

func TestOpenAIToCommandCode_Basic(t *testing.T) {
	body := map[string]any{
		"messages": []any{
			map[string]any{"role": "user", "content": "Hello"},
		},
	}
	out, err := translator.TranslateRequest(
		translator.FormatOpenAI, translator.FormatCommandCode,
		"model", body, false, nil,
	)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if out == nil {
		t.Error("expected non-nil result")
	}
}

func TestAntigravityToOpenAI_Basic(t *testing.T) {
	body := map[string]any{
		"messages": []any{
			map[string]any{"role": "user", "content": "Hello"},
		},
	}
	out, err := translator.TranslateRequest(
		translator.FormatAntigravity, translator.FormatOpenAI,
		"model", body, false, nil,
	)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if out == nil {
		t.Error("expected non-nil result")
	}
}

func TestOpenAIToClaude_MultiTurnWithAssistant(t *testing.T) {
	body := map[string]any{
		"messages": []any{
			map[string]any{"role": "user", "content": "Hello"},
			map[string]any{"role": "assistant", "content": "Hi there"},
			map[string]any{"role": "user", "content": "How are you?"},
		},
	}
	out, err := translator.TranslateRequest(
		translator.FormatOpenAI, translator.FormatClaude,
		"claude-4", body, false, nil,
	)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	msgs, ok := out["messages"].([]map[string]any)
	if !ok {
		t.Fatalf("messages wrong type: %T", out["messages"])
	}
	if len(msgs) != 3 {
		t.Errorf("messages len = %d, want 3", len(msgs))
	}
}

func TestOpenAIToClaude_EmptyMessages(t *testing.T) {
	body := map[string]any{
		"messages": []any{},
	}
	_, err := translator.TranslateRequest(
		translator.FormatOpenAI, translator.FormatClaude,
		"claude-4", body, false, nil,
	)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestOpenAIToClaude_ToolCallInAssistant(t *testing.T) {
	body := map[string]any{
		"messages": []any{
			map[string]any{
				"role": "assistant",
				"tool_calls": []any{
					map[string]any{
						"id": "call_1",
						"function": map[string]any{
							"name": "get_weather",
							"arguments": `{"city":"London"}`,
						},
					},
				},
			},
			map[string]any{
				"role": "tool",
				"tool_call_id": "call_1",
				"content": "Sunny, 20C",
			},
		},
	}
	out, err := translator.TranslateRequest(
		translator.FormatOpenAI, translator.FormatClaude,
		"claude-4", body, false, nil,
	)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if out == nil {
		t.Error("expected non-nil")
	}
}

func TestNoTranslator_UnsupportedPair(t *testing.T) {
	_, err := translator.TranslateRequest(
		translator.FormatOpenAI, "bogus",
		"model", map[string]any{}, false, nil,
	)
	if err == nil {
		t.Error("expected error for unsupported pair")
	}
}
