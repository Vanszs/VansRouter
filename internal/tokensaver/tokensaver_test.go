package tokensaver

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestInjectSystemPrompt_OpenAI(t *testing.T) {
	body := map[string]any{
		"messages": []any{
			map[string]any{"role": "user", "content": "hi"},
		},
	}
	InjectSystemPrompt(body, FormatOpenAI, "be terse")
	msgs := body["messages"].([]any)
	require.Len(t, msgs, 2)
	first := msgs[0].(map[string]any)
	assert.Equal(t, "system", first["role"])
	assert.Contains(t, first["content"], "be terse")
}

func TestInjectSystemPrompt_OpenAIAppend(t *testing.T) {
	body := map[string]any{
		"messages": []any{
			map[string]any{"role": "system", "content": "existing"},
			map[string]any{"role": "user", "content": "hi"},
		},
	}
	InjectSystemPrompt(body, FormatOpenAI, "be terse")
	msgs := body["messages"].([]any)
	first := msgs[0].(map[string]any)
	assert.Contains(t, first["content"], "existing")
	assert.Contains(t, first["content"], "be terse")
}

func TestInjectSystemPrompt_Claude(t *testing.T) {
	body := map[string]any{"system": "existing"}
	InjectSystemPrompt(body, FormatClaude, "be terse")
	assert.Contains(t, body["system"], "existing")
	assert.Contains(t, body["system"], "be terse")
}

func TestInjectSystemPrompt_Gemini(t *testing.T) {
	body := map[string]any{}
	InjectSystemPrompt(body, FormatGemini, "be terse")
	si, ok := body["systemInstruction"].(map[string]any)
	require.True(t, ok)
	parts := si["parts"].([]any)
	require.Len(t, parts, 1)
	assert.Equal(t, "be terse", parts[0].(map[string]any)["text"])
}

func TestInjectCaveman(t *testing.T) {
	body := map[string]any{
		"messages": []any{map[string]any{"role": "user", "content": "hi"}},
	}
	InjectCaveman(body, FormatOpenAI, CavemanFull)
	msgs := body["messages"].([]any)
	first := msgs[0].(map[string]any)
	assert.Equal(t, "system", first["role"])
	assert.Contains(t, first["content"], "caveman")
}

func TestInjectPonytail(t *testing.T) {
	body := map[string]any{
		"messages": []any{map[string]any{"role": "user", "content": "hi"}},
	}
	InjectPonytail(body, FormatOpenAI, PonytailFull)
	msgs := body["messages"].([]any)
	first := msgs[0].(map[string]any)
	assert.Equal(t, "system", first["role"])
	assert.Contains(t, first["content"], "lazy senior developer")
}

func TestInjectTerminationPrompt(t *testing.T) {
	body := map[string]any{
		"messages": []any{map[string]any{"role": "user", "content": "hi"}},
	}
	InjectTerminationPrompt(body, FormatOpenAI)
	msgs := body["messages"].([]any)
	first := msgs[0].(map[string]any)
	assert.Contains(t, first["content"], "STOP calling tools")
}

func TestInjectToolProtocolPrompt(t *testing.T) {
	body := map[string]any{
		"messages": []any{map[string]any{"role": "user", "content": "hi"}},
	}
	InjectToolProtocolPrompt(body, FormatOpenAI, []string{"read", "write"})
	msgs := body["messages"].([]any)
	first := msgs[0].(map[string]any)
	assert.Contains(t, first["content"], "read, write")
}

func TestDedupeTools(t *testing.T) {
	tools := []map[string]any{
		{"name": "WebSearch"},
		{"name": "mcp__exa__web_search_exa"},
	}
	out, stripped := DedupeTools(tools)
	assert.Len(t, out, 1)
	assert.Equal(t, "mcp__exa__web_search_exa", out[0]["name"])
	assert.Contains(t, stripped, "WebSearch")
}

func TestDetectLoop_SingleRepeat(t *testing.T) {
	messages := []map[string]any{
		{
			"role": "assistant",
			"tool_calls": []any{
				map[string]any{"function": map[string]any{"name": "read", "arguments": `{}`}},
				map[string]any{"function": map[string]any{"name": "read", "arguments": `{}`}},
				map[string]any{"function": map[string]any{"name": "read", "arguments": `{}`}},
			},
		},
	}
	res := DetectLoop(messages)
	assert.True(t, res.Detected)
	assert.Contains(t, res.Hint, "repeated tool call")
}

func TestDetectLoop_TextRepeat(t *testing.T) {
	text := "I need to read the key files to understand the structure first."
	messages := []map[string]any{
		{"role": "assistant", "content": text},
		{"role": "assistant", "content": text},
		{"role": "assistant", "content": text},
	}
	res := DetectLoop(messages)
	assert.True(t, res.Detected)
	assert.Contains(t, res.Hint, "repeated assistant text")
}

func TestHasKimiToolMarkup(t *testing.T) {
	assert.True(t, HasKimiToolMarkup("prose functions.read:0 {}"))
	assert.False(t, HasKimiToolMarkup("just prose"))
}

func TestExtractKimiToolCalls(t *testing.T) {
	content := "prose functions.get_weather:0 {\"city\":\"NYC\"} functions.get_time:1 {\"tz\":\"UTC\"}"
	calls := ExtractKimiToolCalls(content)
	require.Len(t, calls, 2)
	assert.Equal(t, "get_weather", calls[0].Function.Name)
	assert.Contains(t, calls[0].Function.Arguments, "city")
	assert.Equal(t, "get_time", calls[1].Function.Name)
}

func TestNormalizeKimiToolCalls(t *testing.T) {
	msg := map[string]any{"role": "assistant", "content": "prose functions.read:0 {}"}
	out, hasTools := NormalizeKimiToolCalls(msg)
	assert.True(t, hasTools)
	assert.Equal(t, "prose", out["content"])
	tcs := out["tool_calls"].([]any)
	require.Len(t, tcs, 1)
}

func TestCompressMessages_OpenAITool(t *testing.T) {
	long := strings.Repeat("line\n", 300)
	body := map[string]any{
		"messages": []any{
			map[string]any{"role": "tool", "content": long},
		},
	}
	stats := CompressMessages(body, true)
	require.NotNil(t, stats)
	assert.Greater(t, stats.BytesBefore, stats.BytesAfter)
	msg := body["messages"].([]any)[0].(map[string]any)
	// 300 repeated "line" → autodetect picks dedupLog → collapses duplicates
	assert.Contains(t, msg["content"], "duplicate lines")
}

func TestCompressMessages_Disabled(t *testing.T) {
	body := map[string]any{
		"messages": []any{
			map[string]any{"role": "tool", "content": strings.Repeat("x", 1000)},
		},
	}
	stats := CompressMessages(body, false)
	assert.Nil(t, stats)
}

