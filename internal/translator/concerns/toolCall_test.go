package concerns

import "testing"

func TestEnsureToolCallIds_GeneratesMissing(t *testing.T) {
	tcs := []map[string]any{
		{"id": "", "function": map[string]any{"name": "foo"}},
		{"id": "call_123", "function": map[string]any{"name": "bar"}},
	}
	out := EnsureToolCallIds(tcs)
	if out[0]["id"] == "" {
		t.Error("id should be generated")
	}
	if out[1]["id"] != "call_123" {
		t.Error("existing id should be preserved")
	}
}

func TestEnsureToolCallIds_NilId(t *testing.T) {
	tcs := []map[string]any{
		{"function": map[string]any{"name": "foo"}},
	}
	out := EnsureToolCallIds(tcs)
	id, ok := out[0]["id"].(string)
	if !ok || id == "" {
		t.Error("id should be generated")
	}
}

func TestEnsureToolCallIds_AllPresent(t *testing.T) {
	tcs := []map[string]any{
		{"id": "call_a"},
		{"id": "call_b"},
	}
	out := EnsureToolCallIds(tcs)
	if out[0]["id"] != "call_a" || out[1]["id"] != "call_b" {
		t.Error("ids should be unchanged")
	}
}

func TestEnsureToolCallIds_Empty(t *testing.T) {
	out := EnsureToolCallIds([]map[string]any{})
	if len(out) != 0 {
		t.Error("should be empty")
	}
}

func TestFallbackToolCallID(t *testing.T) {
	id := FallbackToolCallID()
	if len(id) < 10 {
		t.Errorf("id too short: %q", id)
	}
	if id[:5] != "call_" {
		t.Errorf("id should start with call_: %q", id)
	}
}

func TestEnsureToolCallIdsInBody(t *testing.T) {
	body := map[string]any{
		"messages": []map[string]any{
			{"role": "assistant", "tool_calls": []map[string]any{
				{"id": "", "function": map[string]any{"name": "foo"}},
			}},
		},
	}
	EnsureToolCallIdsInBody(body)
	msgs := body["messages"].([]map[string]any)
	tcs := msgs[0]["tool_calls"].([]map[string]any)
	if tcs[0]["id"] == "" {
		t.Error("id should be generated")
	}
}

func TestEnsureToolCallIdsInBody_NoMessages(t *testing.T) {
	body := map[string]any{}
	EnsureToolCallIdsInBody(body) // should not panic
}

func TestFixMissingToolResponses_NoMissing(t *testing.T) {
	msgs := []map[string]any{
		{"role": "assistant", "tool_calls": []map[string]any{{"id": "call_1"}}},
		{"role": "tool", "tool_call_id": "call_1", "content": "result"},
	}
	out := FixMissingToolResponses(msgs)
	if len(out) != 2 {
		t.Errorf("len = %d, want 2", len(out))
	}
}

func TestFixMissingToolResponses_MissingResponse(t *testing.T) {
	msgs := []map[string]any{
		{"role": "assistant", "tool_calls": []map[string]any{
			{"id": "call_1"},
			{"id": "call_2"},
		}},
		{"role": "tool", "tool_call_id": "call_1", "content": "result1"},
	}
	out := FixMissingToolResponses(msgs)
	if len(out) != 3 {
		t.Errorf("len = %d, want 3", len(out))
	}
	last := out[2]
	if last["role"] != "tool" {
		t.Errorf("last role = %v", last["role"])
	}
	if last["tool_call_id"] != "call_2" {
		t.Errorf("tool_call_id = %v", last["tool_call_id"])
	}
}

func TestFixMissingToolResponses_NoToolCalls(t *testing.T) {
	msgs := []map[string]any{
		{"role": "user", "content": "hi"},
	}
	out := FixMissingToolResponses(msgs)
	if len(out) != 1 {
		t.Errorf("len = %d, want 1", len(out))
	}
}
