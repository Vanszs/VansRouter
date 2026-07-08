package concerns

import "testing"

func TestParseJSONSchema_Map(t *testing.T) {
	in := map[string]any{"type": "object"}
	out, err := ParseJSONSchema(in)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if out["type"] != "object" {
		t.Errorf("type = %v", out["type"])
	}
}

func TestParseJSONSchema_String(t *testing.T) {
	in := `{"type":"object","properties":{}}`
	out, err := ParseJSONSchema(in)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if out["type"] != "object" {
		t.Errorf("type = %v", out["type"])
	}
}

func TestParseJSONSchema_InvalidString(t *testing.T) {
	_, err := ParseJSONSchema("{bad json")
	if err == nil {
		t.Error("expected error for invalid JSON")
	}
}

func TestParseJSONSchema_UnsupportedType(t *testing.T) {
	_, err := ParseJSONSchema(123)
	if err == nil {
		t.Error("expected error for int")
	}
}

func TestSafeParseJSON_Valid(t *testing.T) {
	out := SafeParseJSON(`{"key":"value"}`, "fallback")
	m, ok := out.(map[string]any)
	if !ok {
		t.Fatalf("expected map, got %T", out)
	}
	if m["key"] != "value" {
		t.Errorf("key = %v", m["key"])
	}
}

func TestSafeParseJSON_Invalid(t *testing.T) {
	out := SafeParseJSON("not json", "fallback")
	if out != "fallback" {
		t.Errorf("expected fallback, got %v", out)
	}
}

func TestMarshalJSON(t *testing.T) {
	s := MarshalJSON(map[string]any{"a": 1})
	if s != `{"a":1}` {
		t.Errorf("MarshalJSON = %q", s)
	}
}

func TestSafeUnmarshal(t *testing.T) {
	var out map[string]any
	err := SafeUnmarshal([]byte(`{"key":"val"}`), &out)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if out["key"] != "val" {
		t.Errorf("key = %v", out["key"])
	}
}
