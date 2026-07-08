package formats

import "testing"

func TestFilterToOpenAIFormat(t *testing.T) {
	body := map[string]any{"model": "gpt-4o", "messages": []any{}}
	out := FilterToOpenAIFormat(body, false)
	if out["model"] != "gpt-4o" {
		t.Errorf("model lost: %v", out["model"])
	}
}

func TestPrepareClaudeRequest(t *testing.T) {
	body := map[string]any{"model": "claude-4", "messages": []any{}}
	out := PrepareClaudeRequest(body, "claude-4", false)
	if out["model"] != "claude-4" {
		t.Errorf("model lost: %v", out["model"])
	}
}

func TestGeminiConstants(t *testing.T) {
	if GeminiAPIVersion != "v1beta" {
		t.Errorf("GeminiAPIVersion = %q, want v1beta", GeminiAPIVersion)
	}
	if GeminiGenerateContentPath != "generateContent" {
		t.Errorf("GeminiGenerateContentPath = %q, want generateContent", GeminiGenerateContentPath)
	}
	if GeminiStreamGenerateContentPath != "streamGenerateContent" {
		t.Errorf("GeminiStreamGenerateContentPath = %q, want streamGenerateContent", GeminiStreamGenerateContentPath)
	}
}

func TestResponsesApiConstants(t *testing.T) {
	if OpenAIResponsesAPIVersion != "v1" {
		t.Errorf("OpenAIResponsesAPIVersion = %q, want v1", OpenAIResponsesAPIVersion)
	}
	if OpenAIResponsesEndpoint != "responses" {
		t.Errorf("OpenAIResponsesEndpoint = %q, want responses", OpenAIResponsesEndpoint)
	}
}

func TestAdjustMaxTokens_Default(t *testing.T) {
	body := map[string]any{}
	got := AdjustMaxTokens(body)
	if got != DefaultMaxTokens {
		t.Errorf("AdjustMaxTokens(empty) = %d, want %d", got, DefaultMaxTokens)
	}
}

func TestAdjustMaxTokens_Explicit(t *testing.T) {
	body := map[string]any{"max_tokens": 1000}
	got := AdjustMaxTokens(body)
	if got != 1000 {
		t.Errorf("AdjustMaxTokens(1000) = %d, want 1000", got)
	}
}

func TestAdjustMaxTokens_ZeroBecomesDefault(t *testing.T) {
	body := map[string]any{"max_tokens": 0}
	got := AdjustMaxTokens(body)
	if got != DefaultMaxTokens {
		t.Errorf("AdjustMaxTokens(0) = %d, want %d", got, DefaultMaxTokens)
	}
}

func TestAdjustMaxTokens_ToolsBoost(t *testing.T) {
	body := map[string]any{"max_tokens": 100, "tools": []any{map[string]any{"type": "function"}}}
	got := AdjustMaxTokens(body)
	if got != DefaultMinTokens {
		t.Errorf("AdjustMaxTokens with tools = %d, want %d (min)", got, DefaultMinTokens)
	}
}

func TestAdjustMaxTokens_ThinkingBudget(t *testing.T) {
	body := map[string]any{"max_tokens": 100, "thinking": map[string]any{"budget_tokens": 5000}}
	got := AdjustMaxTokens(body)
	if got != 6024 {
		t.Errorf("AdjustMaxTokens with thinking budget = %d, want 6024", got)
	}
}

func TestAdjustMaxTokens_CappedAtDefault(t *testing.T) {
	body := map[string]any{"max_tokens": 999999}
	got := AdjustMaxTokens(body)
	if got != DefaultMaxTokens {
		t.Errorf("AdjustMaxTokens(999999) = %d, want %d (capped)", got, DefaultMaxTokens)
	}
}

func TestAdjustMaxTokens_FloatCoercion(t *testing.T) {
	body := map[string]any{"max_tokens": float64(2000)}
	got := AdjustMaxTokens(body)
	if got != 2000 {
		t.Errorf("AdjustMaxTokens(float64 2000) = %d, want 2000", got)
	}
}
