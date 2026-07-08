package concerns

import "testing"

func TestExtractReasoningText_Found(t *testing.T) {
	delta := map[string]any{"reasoning_content": "thinking deeply"}
	got := ExtractReasoningText(delta)
	if got != "thinking deeply" {
		t.Errorf("got %q", got)
	}
}

func TestExtractReasoningText_AlternateKey(t *testing.T) {
	delta := map[string]any{"reasoning": "alt thinking"}
	got := ExtractReasoningText(delta)
	if got != "alt thinking" {
		t.Errorf("got %q", got)
	}
}

func TestExtractReasoningText_ThinkingKey(t *testing.T) {
	delta := map[string]any{"thinking": "thought"}
	got := ExtractReasoningText(delta)
	if got != "thought" {
		t.Errorf("got %q", got)
	}
}

func TestExtractReasoningText_None(t *testing.T) {
	delta := map[string]any{"content": "regular"}
	got := ExtractReasoningText(delta)
	if got != "" {
		t.Errorf("got %q, want empty", got)
	}
}

func TestExtractReasoningText_WhitespaceOnly(t *testing.T) {
	delta := map[string]any{"reasoning": "   "}
	got := ExtractReasoningText(delta)
	if got != "" {
		t.Errorf("got %q, want empty for whitespace", got)
	}
}

func TestNormalizeReasoning(t *testing.T) {
	chunk := map[string]any{"a": 1}
	out := NormalizeReasoning(chunk)
	if out["a"] != 1 {
		t.Error("data lost")
	}
}

func TestCaptureThinking(t *testing.T) {
	chunk := map[string]any{"a": 1}
	out := CaptureThinking(chunk)
	if out["a"] != 1 {
		t.Error("data lost")
	}
}

func TestApplyThinking(t *testing.T) {
	body := map[string]any{"a": 1}
	out := ApplyThinking(body, map[string]any{"budget": 100})
	if out["a"] != 1 {
		t.Error("data lost")
	}
}

func TestCaptureThinkingUnified(t *testing.T) {
	chunk := map[string]any{"a": 1}
	out, changed := CaptureThinkingUnified(chunk, map[string]bool{})
	if out["a"] != 1 {
		t.Error("data lost")
	}
	if changed {
		t.Error("should not change")
	}
}

func TestApplyThinkingUnified(t *testing.T) {
	body := map[string]any{"a": 1}
	out := ApplyThinkingUnified(body, map[string]any{})
	if out["a"] != 1 {
		t.Error("data lost")
	}
}

func TestFilterModality(t *testing.T) {
	body := map[string]any{"a": 1}
	out := FilterModality(body, []string{"text"})
	if out["a"] != 1 {
		t.Error("data lost")
	}
}

func TestFilterUnsupportedParams(t *testing.T) {
	body := map[string]any{"a": 1}
	out := FilterUnsupportedParams(body, map[string]bool{"a": true})
	if out["a"] != 1 {
		t.Error("data lost")
	}
}

func TestPrefetchImages(t *testing.T) {
	body := map[string]any{"a": 1}
	out := PrefetchImages(body)
	if out["a"] != 1 {
		t.Error("data lost")
	}
}
