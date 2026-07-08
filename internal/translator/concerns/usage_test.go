package concerns

import "testing"

func TestIntNumber_Int(t *testing.T) {
	if IntNumber(42) != 42 {
		t.Errorf("IntNumber(42) = %d", IntNumber(42))
	}
}

func TestIntNumber_Float64(t *testing.T) {
	if IntNumber(float64(3.9)) != 3 {
		t.Errorf("IntNumber(3.9) = %d", IntNumber(float64(3.9)))
	}
}

func TestIntNumber_Int64(t *testing.T) {
	if IntNumber(int64(100)) != 100 {
		t.Errorf("IntNumber(int64(100)) = %d", IntNumber(int64(100)))
	}
}

func TestIntNumber_Float32(t *testing.T) {
	if IntNumber(float32(5.5)) != 5 {
		t.Errorf("IntNumber(float32(5.5)) = %d", IntNumber(float32(5.5)))
	}
}

func TestIntNumber_Nil(t *testing.T) {
	if IntNumber(nil) != 0 {
		t.Errorf("IntNumber(nil) = %d", IntNumber(nil))
	}
}

func TestIntNumber_String(t *testing.T) {
	if IntNumber("abc") != 0 {
		t.Errorf("IntNumber(abc) = %d", IntNumber("abc"))
	}
}

func TestToOpenAIUsage_ClaudeFormat(t *testing.T) {
	usage := map[string]any{
		"input_tokens":               100,
		"output_tokens":              50,
		"cache_read_input_tokens":    10,
		"cache_creation_input_tokens": 5,
	}
	out := ToOpenAIUsage(usage, "claude")
	if out["prompt_tokens"] != 115 {
		t.Errorf("prompt_tokens = %v, want 115", out["prompt_tokens"])
	}
	if out["completion_tokens"] != 50 {
		t.Errorf("completion_tokens = %v, want 50", out["completion_tokens"])
	}
	if out["total_tokens"] != 165 {
		t.Errorf("total_tokens = %v, want 165", out["total_tokens"])
	}
	if out["cache_read_input_tokens"] != 10 {
		t.Errorf("cache_read_input_tokens = %v", out["cache_read_input_tokens"])
	}
	if out["cache_creation_input_tokens"] != 5 {
		t.Errorf("cache_creation_input_tokens = %v", out["cache_creation_input_tokens"])
	}
}

func TestToOpenAIUsage_OpenAIFormat(t *testing.T) {
	usage := map[string]any{
		"prompt_tokens":     200,
		"completion_tokens": 100,
	}
	out := ToOpenAIUsage(usage, "openai")
	if out["prompt_tokens"] != 200 {
		t.Errorf("prompt_tokens = %v", out["prompt_tokens"])
	}
	if out["completion_tokens"] != 100 {
		t.Errorf("completion_tokens = %v", out["completion_tokens"])
	}
	if out["total_tokens"] != 300 {
		t.Errorf("total_tokens = %v, want 300", out["total_tokens"])
	}
}

func TestToOpenAIUsage_Nil(t *testing.T) {
	if ToOpenAIUsage(nil, "openai") != nil {
		t.Error("expected nil")
	}
}

func TestMergeUsage_NilDst(t *testing.T) {
	src := map[string]any{"a": 1}
	out := MergeUsage(nil, src)
	if out["a"] != 1 {
		t.Errorf("a = %v", out["a"])
	}
}

func TestMergeUsage_Existing(t *testing.T) {
	dst := map[string]any{"a": 1}
	src := map[string]any{"b": 2}
	out := MergeUsage(dst, src)
	if out["a"] != 1 {
		t.Errorf("a = %v", out["a"])
	}
	if out["b"] != 2 {
		t.Errorf("b = %v", out["b"])
	}
}

func TestBuildUsage_Basic(t *testing.T) {
	u := BuildUsage(10, 20, 30, 0, 0, 0)
	if u["prompt_tokens"] != 10 {
		t.Errorf("prompt = %v", u["prompt_tokens"])
	}
	if u["completion_tokens"] != 20 {
		t.Errorf("completion = %v", u["completion_tokens"])
	}
	if u["total_tokens"] != 30 {
		t.Errorf("total = %v", u["total_tokens"])
	}
	if _, ok := u["prompt_tokens_details"]; ok {
		t.Error("should not have details when all 0")
	}
}

func TestBuildUsage_WithDetails(t *testing.T) {
	u := BuildUsage(10, 20, 30, 5, 3, 0)
	details, ok := u["prompt_tokens_details"].(map[string]any)
	if !ok {
		t.Fatal("missing prompt_tokens_details")
	}
	if details["cached_tokens"] != 5 {
		t.Errorf("cached = %v", details["cached_tokens"])
	}
	if details["cache_creation_tokens"] != 3 {
		t.Errorf("cache_creation = %v", details["cache_creation_tokens"])
	}
}

func TestBuildUsage_WithReasoning(t *testing.T) {
	u := BuildUsage(10, 20, 30, 0, 0, 7)
	details, ok := u["completion_tokens_details"].(map[string]any)
	if !ok {
		t.Fatal("missing completion_tokens_details")
	}
	if details["reasoning_tokens"] != 7 {
		t.Errorf("reasoning = %v", details["reasoning_tokens"])
	}
}
