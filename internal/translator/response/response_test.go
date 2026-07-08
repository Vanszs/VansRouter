package response

import (
	"testing"

	"github.com/9router/9router/internal/translator"
)

func makeState() *translator.State {
	return &translator.State{
		MessageID: "test-123",
		Model:     "claude-4",
	}
}

func TestClaudeToOpenAI_NilChunk(t *testing.T) {
	state := makeState()
	out, err := translator.TranslateResponse(
		translator.FormatClaude, translator.FormatOpenAI,
		nil, state,
	)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if out != nil {
		t.Errorf("expected nil for nil chunk, got %v", out)
	}
}

func TestClaudeToOpenAI_MessageStart(t *testing.T) {
	state := makeState()
	chunk := map[string]any{
		"type": "message_start",
		"message": map[string]any{
			"id": "msg_123",
		},
	}
	out, err := translator.TranslateResponse(
		translator.FormatClaude, translator.FormatOpenAI,
		chunk, state,
	)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(out) == 0 {
		t.Error("expected at least one chunk")
	}
}

func TestClaudeToOpenAI_ContentBlockDelta(t *testing.T) {
	state := makeState()
	chunk := map[string]any{
		"type":  "content_block_delta",
		"index": 0,
		"delta": map[string]any{
			"type": "text_delta",
			"text": "Hello",
		},
	}
	out, err := translator.TranslateResponse(
		translator.FormatClaude, translator.FormatOpenAI,
		chunk, state,
	)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(out) == 0 {
		t.Fatal("expected at least one chunk")
	}
	// Should contain content delta
	chunk0 := out[0]
	choices, ok := chunk0["choices"].([]map[string]any)
	if !ok || len(choices) == 0 {
		t.Fatal("missing choices")
	}
	delta, _ := choices[0]["delta"].(map[string]any)
	if delta["content"] != "Hello" {
		t.Errorf("content = %v, want Hello", delta["content"])
	}
}

func TestClaudeToOpenAI_MessageStop(t *testing.T) {
	state := makeState()
	// Send message_start first so state is initialized
	startChunk := map[string]any{
		"type": "message_start",
		"message": map[string]any{
			"id": "msg_123",
			"stop_reason": "end_turn",
		},
	}
	_, _ = translator.TranslateResponse(
		translator.FormatClaude, translator.FormatOpenAI,
		startChunk, state,
	)
	// Now send message_stop
	chunk := map[string]any{
		"type": "message_stop",
	}
	out, err := translator.TranslateResponse(
		translator.FormatClaude, translator.FormatOpenAI,
		chunk, state,
	)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(out) == 0 {
		t.Fatal("expected at least one chunk")
	}
}

func TestClaudeToOpenAI_MessageDelta_Usage(t *testing.T) {
	state := makeState()
	chunk := map[string]any{
		"type": "message_delta",
		"usage": map[string]any{
			"input_tokens":  10,
			"output_tokens": 20,
		},
	}
	out, err := translator.TranslateResponse(
		translator.FormatClaude, translator.FormatOpenAI,
		chunk, state,
	)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if state.Usage == nil {
		t.Error("usage should be captured in state")
	}
	_ = out
}

func TestOllamaToOpenAI_Basic(t *testing.T) {
	state := &translator.State{
		MessageID: "test-ollama",
		Model:     "llama3",
	}
	chunk := map[string]any{
		"message": map[string]any{
			"role":    "assistant",
			"content": "Hello",
		},
		"done": false,
	}
	out, err := translator.TranslateResponse(
		translator.FormatOllama, translator.FormatOpenAI,
		chunk, state,
	)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(out) == 0 {
		t.Fatal("expected at least one chunk")
	}
}

func TestGeminiToOpenAI_Basic(t *testing.T) {
	state := &translator.State{
		MessageID: "test-gemini",
		Model:     "gemini-1.5-pro",
	}
	chunk := map[string]any{
		"candidates": []any{
			map[string]any{
				"content": map[string]any{
					"parts": []any{
						map[string]any{"text": "Hello"},
					},
					"role": "model",
				},
			},
		},
	}
	out, err := translator.TranslateResponse(
		translator.FormatGemini, translator.FormatOpenAI,
		chunk, state,
	)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(out) == 0 {
		t.Fatal("expected at least one chunk")
	}
}

func TestCursorToOpenAI_Basic(t *testing.T) {
	state := &translator.State{
		MessageID: "test-cursor",
		Model:     "gpt-4o",
	}
	chunk := map[string]any{
		"choices": []any{
			map[string]any{
				"delta": map[string]any{"content": "Hi"},
				"index": 0,
			},
		},
	}
	out, err := translator.TranslateResponse(
		translator.FormatCursor, translator.FormatOpenAI,
		chunk, state,
	)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(out) == 0 {
		t.Fatal("expected at least one chunk")
	}
}

func TestCommandCodeToOpenAI_Basic(t *testing.T) {
	state := &translator.State{
		MessageID: "test-cc",
		Model:     "model",
	}
	// CommandCode passes through OpenAI-formatted chunks
	chunk := map[string]any{
		"object": "chat.completion.chunk",
		"choices": []any{
			map[string]any{
				"delta": map[string]any{"content": "Hi"},
				"index": 0,
			},
		},
	}
	out, err := translator.TranslateResponse(
		translator.FormatCommandCode, translator.FormatOpenAI,
		chunk, state,
	)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(out) == 0 {
		t.Fatal("expected at least one chunk")
	}
}

func TestOpenAIToAntigravity_Basic(t *testing.T) {
	state := &translator.State{
		MessageID: "test-ag",
		Model:     "model",
	}
	chunk := map[string]any{
		"choices": []any{
			map[string]any{
				"delta": map[string]any{"content": "Hi"},
				"index": 0,
			},
		},
	}
	out, err := translator.TranslateResponse(
		translator.FormatOpenAI, translator.FormatAntigravity,
		chunk, state,
	)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	_ = out
}

func TestOpenAIToClaude_Basic(t *testing.T) {
	state := &translator.State{
		MessageID:         "test-o2c",
		Model:             "claude-4",
		NextBlockIndex:    0,
		TextBlockIndex:    0,
	}
	chunk := map[string]any{
		"choices": []any{
			map[string]any{
				"delta": map[string]any{"content": "Hello"},
				"index": 0,
			},
		},
	}
	out, err := translator.TranslateResponse(
		translator.FormatOpenAI, translator.FormatClaude,
		chunk, state,
	)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	_ = out
}

func TestUnsupportedResponsePair(t *testing.T) {
	state := makeState()
	_, err := translator.TranslateResponse(
		"bogus", translator.FormatOpenAI,
		map[string]any{}, state,
	)
	if err == nil {
		t.Error("expected error for unsupported pair")
	}
}
