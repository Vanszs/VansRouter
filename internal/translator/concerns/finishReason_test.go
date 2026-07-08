package concerns

import "testing"

func TestToOpenAIFinish_Claude(t *testing.T) {
	tests := map[string]string{
		"end_turn":       "stop",
		"max_tokens":     "length",
		"stop_sequence":  "stop",
		"tool_use":       "tool_calls",
		"content_filter": "content_filter",
	}
	for in, want := range tests {
		got := ToOpenAIFinish(in, "claude")
		if got != want {
			t.Errorf("ToOpenAIFinish(%q, claude) = %q, want %q", in, got, want)
		}
	}
}

func TestToOpenAIFinish_Gemini(t *testing.T) {
	tests := map[string]string{
		"STOP":           "stop",
		"MAX_TOKENS":     "length",
		"SAFETY":         "content_filter",
		"RECITATION":     "content_filter",
		"OTHER":          "stop",
	}
	for in, want := range tests {
		got := ToOpenAIFinish(in, "gemini")
		if got != want {
			t.Errorf("ToOpenAIFinish(%q, gemini) = %q, want %q", in, got, want)
		}
	}
}

func TestToOpenAIFinish_OpenAI(t *testing.T) {
	got := ToOpenAIFinish("stop", "openai")
	if got != "stop" {
		t.Errorf("ToOpenAIFinish(stop, openai) = %q, want stop", got)
	}
}

func TestToOpenAIFinish_Unknown(t *testing.T) {
	got := ToOpenAIFinish("bogus", "unknown")
	if got != "bogus" {
		t.Errorf("ToOpenAIFinish(bogus, unknown) = %q, want bogus", got)
	}
}

func TestFromOpenAIFinish_Claude(t *testing.T) {
	got := FromOpenAIFinish("stop", "claude")
	if got == "" {
		t.Error("expected non-empty result")
	}
	got = FromOpenAIFinish("length", "claude")
	if got != "max_tokens" {
		t.Errorf("FromOpenAIFinish(length, claude) = %q, want max_tokens", got)
	}
}

func TestFromOpenAIFinish_Gemini(t *testing.T) {
	got := FromOpenAIFinish("stop", "gemini")
	if got == "" {
		t.Error("expected non-empty result")
	}
	got = FromOpenAIFinish("length", "gemini")
	if got != "MAX_TOKENS" {
		t.Errorf("FromOpenAIFinish(length, gemini) = %q, want MAX_TOKENS", got)
	}
}

func TestMapFinishReason(t *testing.T) {
	got := MapFinishReason("claude", "end_turn")
	if got != "stop" {
		t.Errorf("MapFinishReason(claude, end_turn) = %q, want stop", got)
	}
}
