package combo

import (
	"errors"
	"testing"
)

func TestStripComboPrefix(t *testing.T) {
	if StripComboPrefix("combo/coding-stack") != "coding-stack" {
		t.Error("should strip combo/ prefix")
	}
	if StripComboPrefix("gpt-4") != "gpt-4" {
		t.Error("should not modify non-combo model")
	}
}

func TestIsComboModel(t *testing.T) {
	if !IsComboModel("combo/coding-stack") {
		t.Error("combo/ should be combo model")
	}
	if IsComboModel("gpt-4") {
		t.Error("gpt-4 should not be combo model")
	}
}

func TestSelectByCapability_AllMatch(t *testing.T) {
	models := []string{"gpt-4", "claude-3", "gemini"}
	caps := map[string]ModelCapabilities{
		"gpt-4":   {Vision: true},
		"claude-3": {Vision: true},
		"gemini":   {Vision: true},
	}
	result := SelectByCapability(models, caps, []string{"vision"})
	if len(result) != 3 {
		t.Errorf("expected 3, got %d", len(result))
	}
}

func TestSelectByCapability_FilterOut(t *testing.T) {
	models := []string{"gpt-4", "claude-3", "gemini"}
	caps := map[string]ModelCapabilities{
		"gpt-4":    {Vision: true},
		"claude-3": {Vision: false},
		"gemini":   {Vision: true},
	}
	result := SelectByCapability(models, caps, []string{"vision"})
	if len(result) != 2 {
		t.Errorf("expected 2, got %d", len(result))
	}
	if result[0] != "gpt-4" || result[1] != "gemini" {
		t.Error("wrong models filtered")
	}
}

func TestSelectByCapability_NoCaps(t *testing.T) {
	models := []string{"gpt-4", "claude-3"}
	result := SelectByCapability(models, nil, []string{"vision"})
	if len(result) != 2 {
		t.Error("models without caps should pass through")
	}
}

func TestSelectModel_Fallback(t *testing.T) {
	models := []string{"gpt-4", "claude-3"}
	result := SelectModel(models, StrategyFallback, 0, nil, nil)
	if result != "gpt-4" {
		t.Errorf("expected gpt-4, got %s", result)
	}
}

func TestSelectModel_RoundRobin(t *testing.T) {
	models := []string{"gpt-4", "claude-3", "gemini"}
	r0 := SelectModel(models, StrategyRoundRobin, 0, nil, nil)
	r1 := SelectModel(models, StrategyRoundRobin, 1, nil, nil)
	r2 := SelectModel(models, StrategyRoundRobin, 2, nil, nil)
	r3 := SelectModel(models, StrategyRoundRobin, 3, nil, nil)
	if r0 != "gpt-4" {
		t.Errorf("call 0: expected gpt-4, got %s", r0)
	}
	if r1 != "claude-3" {
		t.Errorf("call 1: expected claude-3, got %s", r1)
	}
	if r2 != "gemini" {
		t.Errorf("call 2: expected gemini, got %s", r2)
	}
	if r3 != "gpt-4" {
		t.Errorf("call 3: expected gpt-4 (wrap), got %s", r3)
	}
}

func TestSelectModel_Empty(t *testing.T) {
	result := SelectModel([]string{}, StrategyFallback, 0, nil, nil)
	if result != "" {
		t.Error("empty models should return empty string")
	}
}

func TestSelectModel_Fusion(t *testing.T) {
	models := []string{"gpt-4", "claude-3"}
	result := SelectModel(models, StrategyFusion, 0, nil, nil)
	if result != "gpt-4" {
		t.Errorf("fusion should return first model, got %s", result)
	}
}

func TestFlattenToolHistory_AssistantWithToolCalls(t *testing.T) {
	messages := []map[string]interface{}{
		{
			"role": "assistant",
			"content": "Let me check that",
			"tool_calls": []interface{}{
				map[string]interface{}{
					"function": map[string]interface{}{
						"name": "get_weather",
					},
				},
				map[string]interface{}{
					"function": map[string]interface{}{
						"name": "get_time",
					},
				},
			},
		},
	}
	result := FlattenToolHistory(messages)
	if len(result) != 1 {
		t.Fatalf("expected 1 message, got %d", len(result))
	}
	content, _ := result[0]["content"].(string)
	if !contains(content, "get_weather") {
		t.Error("should contain tool name")
	}
	if !contains(content, "get_time") {
		t.Error("should contain tool name")
	}
}

func TestFlattenToolHistory_ToolResult(t *testing.T) {
	messages := []map[string]interface{}{
		{
			"role":    "tool",
			"content": "72°F sunny",
		},
	}
	result := FlattenToolHistory(messages)
	if len(result) != 1 {
		t.Fatalf("expected 1 message, got %d", len(result))
	}
	role, _ := result[0]["role"].(string)
	if role != "assistant" {
		t.Error("tool role should become assistant")
	}
	content, _ := result[0]["content"].(string)
	if !contains(content, "72") {
		t.Error("should contain tool result")
	}
}

func TestFlattenToolHistory_NoTools(t *testing.T) {
	messages := []map[string]interface{}{
		{"role": "user", "content": "hello"},
		{"role": "assistant", "content": "hi"},
	}
	result := FlattenToolHistory(messages)
	if len(result) != 2 {
		t.Fatalf("expected 2 messages, got %d", len(result))
	}
}

func TestShouldRetry_Fallback(t *testing.T) {
	if !ShouldRetry(StrategyFallback, 0, 3) {
		t.Error("should retry on first failure")
	}
	if ShouldRetry(StrategyFallback, 2, 3) {
		t.Error("should not retry on last model")
	}
}

func TestShouldRetry_Fusion(t *testing.T) {
	if ShouldRetry(StrategyFusion, 0, 3) {
		t.Error("fusion should not retry")
	}
}

func TestComboError(t *testing.T) {
	err := &ComboError{
		Model:    "gpt-4",
		Strategy: StrategyFallback,
		Err:      errors.New("connection refused"),
	}
	if err.Error() == "" {
		t.Error("error message should not be empty")
	}
	if !contains(err.Error(), "gpt-4") {
		t.Error("should contain model name")
	}
	if !contains(err.Error(), "fallback") {
		t.Error("should contain strategy")
	}
	if !contains(err.Error(), "connection refused") {
		t.Error("should contain original error")
	}
}

func contains(s, substr string) bool {
	for i := 0; i <= len(s)-len(substr); i++ {
		if s[i:i+len(substr)] == substr {
			return true
		}
	}
	return false
}
