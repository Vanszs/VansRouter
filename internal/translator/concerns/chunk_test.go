package concerns

import (
	"testing"
)

func TestBuildChunk_Basic(t *testing.T) {
	meta := map[string]any{"id": "chatcmpl-123", "created": 1000, "model": "gpt-4o"}
	delta := map[string]any{"content": "hello"}
	chunk := BuildChunk(meta, delta, "")
	if chunk["id"] != "chatcmpl-123" {
		t.Errorf("id = %v, want chatcmpl-123", chunk["id"])
	}
	if chunk["object"] != "chat.completion.chunk" {
		t.Errorf("object = %v, want chat.completion.chunk", chunk["object"])
	}
	if chunk["created"] != 1000 {
		t.Errorf("created = %v, want 1000", chunk["created"])
	}
	if chunk["model"] != "gpt-4o" {
		t.Errorf("model = %v, want gpt-4o", chunk["model"])
	}
	choices, ok := chunk["choices"].([]map[string]any)
	if !ok || len(choices) != 1 {
		t.Fatalf("choices wrong: %v", chunk["choices"])
	}
	d, _ := choices[0]["delta"].(map[string]any)
	if d["content"] != "hello" {
		t.Errorf("delta mismatch: %v", d)
	}
	if choices[0]["finish_reason"] != nil {
		t.Errorf("finish_reason should be nil, got %v", choices[0]["finish_reason"])
	}
}

func TestBuildChunk_WithFinishReason(t *testing.T) {
	meta := map[string]any{"id": "x", "created": 1, "model": "m"}
	delta := map[string]any{}
	chunk := BuildChunk(meta, delta, "stop")
	choices, _ := chunk["choices"].([]map[string]any)
	if choices[0]["finish_reason"] != "stop" {
		t.Errorf("finish_reason = %v, want stop", choices[0]["finish_reason"])
	}
}

func TestBuildChunk_NilMeta(t *testing.T) {
	chunk := BuildChunk(nil, map[string]any{}, "")
	if chunk["id"] != "" {
		t.Errorf("id should be empty")
	}
	if chunk["created"] != 0 {
		t.Errorf("created should be 0")
	}
}

func TestBuildClaudeChunk(t *testing.T) {
	chunk := BuildClaudeChunk("content_block_delta", map[string]any{"index": 0})
	if chunk["type"] != "content_block_delta" {
		t.Errorf("type = %v, want content_block_delta", chunk["type"])
	}
	if chunk["index"] != 0 {
		t.Errorf("index = %v, want 0", chunk["index"])
	}
}

func TestSplitChunk(t *testing.T) {
	chunk := map[string]any{"a": 1}
	result := SplitChunk("openai", chunk)
	if len(result) != 1 {
		t.Errorf("len = %d, want 1", len(result))
	}
	if result[0]["a"] != 1 {
		t.Errorf("chunk lost data")
	}
}

func TestReasoningDelta(t *testing.T) {
	delta := ReasoningDelta("thinking hard")
	if delta["reasoning_content"] != "thinking hard" {
		t.Errorf("reasoning_content = %v", delta["reasoning_content"])
	}
	if delta["reasoning"] != "thinking hard" {
		t.Errorf("reasoning = %v", delta["reasoning"])
	}
	if delta["reasoning_type"] != "token" {
		t.Errorf("reasoning_type = %v", delta["reasoning_type"])
	}
	if delta["content"] != "" {
		t.Errorf("content should be empty")
	}
}
