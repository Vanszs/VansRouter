package concerns

import (
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestParseJSONSchema(t *testing.T) {
	t.Run("map input passthrough", func(t *testing.T) {
		input := map[string]any{"type": "object", "properties": map[string]any{}}
		result, err := ParseJSONSchema(input)
		require.NoError(t, err)
		assert.Equal(t, input, result)
	})

	t.Run("string input valid json", func(t *testing.T) {
		input := `{"type":"object","properties":{"name":{"type":"string"}}}`
		result, err := ParseJSONSchema(input)
		require.NoError(t, err)
		assert.Equal(t, "object", result["type"])
	})

	t.Run("string input invalid json", func(t *testing.T) {
		_, err := ParseJSONSchema(`{not valid json}`)
		assert.Error(t, err)
		assert.Contains(t, err.Error(), "invalid json schema")
	})

	t.Run("integer input unsupported", func(t *testing.T) {
		_, err := ParseJSONSchema(42)
		assert.Error(t, err)
		assert.Contains(t, err.Error(), "unsupported json schema type")
	})

	t.Run("nil input unsupported", func(t *testing.T) {
		_, err := ParseJSONSchema(nil)
		assert.Error(t, err)
	})

	t.Run("slice input unsupported", func(t *testing.T) {
		_, err := ParseJSONSchema([]any{1, 2, 3})
		assert.Error(t, err)
	})
}

func TestSafeUnmarshal(t *testing.T) {
	t.Run("valid json", func(t *testing.T) {
		var out map[string]any
		err := SafeUnmarshal([]byte(`{"key":"value"}`), &out)
		require.NoError(t, err)
		assert.Equal(t, "value", out["key"])
	})

	t.Run("invalid json", func(t *testing.T) {
		var out map[string]any
		err := SafeUnmarshal([]byte(`{bad}`), &out)
		assert.Error(t, err)
	})

	t.Run("into struct", func(t *testing.T) {
		var s struct{ Name string `json:"name"` }
		err := SafeUnmarshal([]byte(`{"name":"test"}`), &s)
		require.NoError(t, err)
		assert.Equal(t, "test", s.Name)
	})
}

func TestSafeParseJSON(t *testing.T) {
	t.Run("valid json object", func(t *testing.T) {
		result := SafeParseJSON(`{"key":"value"}`, "fallback")
		m, ok := result.(map[string]any)
		require.True(t, ok)
		assert.Equal(t, "value", m["key"])
	})

	t.Run("valid json array", func(t *testing.T) {
		result := SafeParseJSON(`[1,2,3]`, "fallback")
		arr, ok := result.([]any)
		require.True(t, ok)
		assert.Len(t, arr, 3)
	})

	t.Run("valid json number", func(t *testing.T) {
		result := SafeParseJSON(`42`, "fallback")
		num, ok := result.(float64)
		require.True(t, ok)
		assert.Equal(t, float64(42), num)
	})

	t.Run("valid json string", func(t *testing.T) {
		result := SafeParseJSON(`"hello"`, "fallback")
		str, ok := result.(string)
		require.True(t, ok)
		assert.Equal(t, "hello", str)
	})

	t.Run("invalid json returns fallback", func(t *testing.T) {
		result := SafeParseJSON(`{bad}`, "fallback")
		assert.Equal(t, "fallback", result)
	})

	t.Run("empty string returns fallback", func(t *testing.T) {
		result := SafeParseJSON(``, "fallback")
		assert.Equal(t, "fallback", result)
	})
}

func TestMarshalJSON(t *testing.T) {
	t.Run("simple map", func(t *testing.T) {
		result := MarshalJSON(map[string]any{"key": "value"})
		assert.Equal(t, `{"key":"value"}`, result)
	})

	t.Run("nested structure", func(t *testing.T) {
		result := MarshalJSON(map[string]any{
			"name": "test",
			"nums": []int{1, 2, 3},
		})
		// Parse back to verify
		var out map[string]any
		require.NoError(t, json.Unmarshal([]byte(result), &out))
		assert.Equal(t, "test", out["name"])
	})

	t.Run("nil input", func(t *testing.T) {
		result := MarshalJSON(nil)
		assert.Equal(t, "null", result)
	})

	t.Run("slice input", func(t *testing.T) {
		result := MarshalJSON([]string{"a", "b"})
		assert.Equal(t, `["a","b"]`, result)
	})
}
