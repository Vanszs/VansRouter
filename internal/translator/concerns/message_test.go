package concerns

import "testing"

func TestExtractTextContent_String(t *testing.T) {
	got := ExtractTextContent("hello world", "\n")
	if got != "hello world" {
		t.Errorf("got %q", got)
	}
}

func TestExtractTextContent_EmptyString(t *testing.T) {
	got := ExtractTextContent("", "\n")
	if got != "" {
		t.Errorf("got %q", got)
	}
}

func TestExtractTextContent_Nil(t *testing.T) {
	got := ExtractTextContent(nil, "\n")
	if got != "" {
		t.Errorf("got %q", got)
	}
}

func TestExtractTextContent_StringArray(t *testing.T) {
	content := []any{
		map[string]any{"type": "text", "text": "line1"},
		map[string]any{"type": "image_url", "image_url": "x"},
		map[string]any{"type": "text", "text": "line2"},
	}
	got := ExtractTextContent(content, "\n")
	if got != "line1\nline2" {
		t.Errorf("got %q, want line1\\nline2", got)
	}
}

func TestExtractTextContent_MapArray(t *testing.T) {
	content := []map[string]any{
		{"type": "text", "text": "a"},
		{"type": "text", "text": "b"},
	}
	got := ExtractTextContent(content, "; ")
	if got != "a; b" {
		t.Errorf("got %q, want a; b", got)
	}
}

func TestExtractTextContent_NoTextParts(t *testing.T) {
	content := []any{
		map[string]any{"type": "image_url"},
	}
	got := ExtractTextContent(content, "\n")
	if got != "" {
		t.Errorf("got %q, want empty", got)
	}
}

func TestCollapseTextParts_Empty(t *testing.T) {
	got := CollapseTextParts([]map[string]any{})
	if got != "" {
		t.Errorf("got %v", got)
	}
}

func TestCollapseTextParts_Single(t *testing.T) {
	parts := []map[string]any{{"type": "text", "text": "hello"}}
	got := CollapseTextParts(parts)
	m, ok := got.(map[string]any)
	if !ok {
		t.Fatalf("expected map, got %T", got)
	}
	if m["text"] != "hello" {
		t.Errorf("text = %v", m["text"])
	}
}

func TestCollapseTextParts_Multiple(t *testing.T) {
	parts := []map[string]any{
		{"type": "text", "text": "a"},
		{"type": "text", "text": "b"},
	}
	got := CollapseTextParts(parts)
	m, ok := got.(map[string]any)
	if !ok {
		t.Fatalf("expected map, got %T", got)
	}
	if m["text"] != "a\nb" {
		t.Errorf("text = %v", m["text"])
	}
}

func TestDeepCloneMessage(t *testing.T) {
	orig := map[string]any{"role": "user", "content": "hi"}
	clone := DeepCloneMessage(orig)
	if clone["role"] != "user" {
		t.Errorf("role lost")
	}
	clone["role"] = "assistant"
	if orig["role"] != "user" {
		t.Error("clone should not modify original")
	}
}

func TestNormalizeMessage(t *testing.T) {
	msg := map[string]any{"role": "user"}
	out := NormalizeMessage(msg)
	if out["role"] != "user" {
		t.Errorf("role lost")
	}
}
