package executors

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestSpecialExecutors_NewExecutors(t *testing.T) {
	t.Run("Antigravity", func(t *testing.T) {
		ex := NewAntigravityExecutor("antigravity", &ProviderConfig{})
		assert.Equal(t, "antigravity", ex.Provider())

		url := ex.BuildURL("gemini-pro", false, 0, Credentials{})
		assert.Contains(t, url, "api.antigravity.ai")
		assert.Contains(t, url, "gemini-pro")
		assert.Contains(t, url, "generateContent")

		urlStream := ex.BuildURL("gemini-pro", true, 0, Credentials{})
		assert.Contains(t, urlStream, "streamGenerateContent")
	})

	t.Run("CodebuddyCn", func(t *testing.T) {
		ex := NewCodebuddyCnExecutor("codebuddy-cn", &ProviderConfig{})
		assert.Equal(t, "codebuddy-cn", ex.Provider())

		url := ex.BuildURL("model", false, 0, Credentials{})
		assert.Contains(t, url, "api.codebuddy.cn")
		assert.Contains(t, url, "chat/completions")
	})

	t.Run("CommandCode", func(t *testing.T) {
		ex := NewCommandCodeExecutor("commandcode", &ProviderConfig{})
		assert.Equal(t, "commandcode", ex.Provider())

		url := ex.BuildURL("model", false, 0, Credentials{})
		assert.Contains(t, url, "api.commandcode.dev")
		assert.Contains(t, url, "alpha/generate")
	})

	t.Run("GeminiCli", func(t *testing.T) {
		ex := NewGeminiCliExecutor("gemini-cli", &ProviderConfig{})
		assert.Equal(t, "gemini-cli", ex.Provider())

		url := ex.BuildURL("gemini-pro", false, 0, Credentials{})
		assert.Contains(t, url, "generativelanguage.googleapis.com")
		assert.Contains(t, url, "gemini-pro")

		h := ex.BuildHeaders(Credentials{APIKey: "test-key"}, true)
		assert.Equal(t, "test-key", h.Get("x-goog-api-key"))
	})

	t.Run("GrokWeb", func(t *testing.T) {
		ex := NewGrokWebExecutor("grok-web", &ProviderConfig{})
		assert.Equal(t, "grok-web", ex.Provider())

		url := ex.BuildURL("model", false, 0, Credentials{})
		assert.Contains(t, url, "api.x.ai")
	})

	t.Run("IFlow", func(t *testing.T) {
		ex := NewIFlowExecutor("iflow", &ProviderConfig{})
		assert.Equal(t, "iflow", ex.Provider())

		url := ex.BuildURL("model", false, 0, Credentials{})
		assert.Contains(t, url, "api.iflow.cn")
	})

	t.Run("Kiro", func(t *testing.T) {
		ex := NewKiroExecutor("kiro", &ProviderConfig{})
		assert.Equal(t, "kiro", ex.Provider())

		url := ex.BuildURL("model", false, 0, Credentials{})
		assert.Contains(t, url, "codewhisperer.us-east-1.amazonaws.com")
	})

	t.Run("OpenCode", func(t *testing.T) {
		ex := NewOpenCodeExecutor("opencode", &ProviderConfig{})
		assert.Equal(t, "opencode", ex.Provider())

		url := ex.BuildURL("model", false, 0, Credentials{})
		assert.Contains(t, url, "api.opencode.ai")
	})

	t.Run("Qoder", func(t *testing.T) {
		ex := NewQoderExecutor("qoder", &ProviderConfig{})
		assert.Equal(t, "qoder", ex.Provider())

		url := ex.BuildURL("model", false, 0, Credentials{})
		assert.Contains(t, url, "api.qoder.ai")
	})

	t.Run("Qwen", func(t *testing.T) {
		ex := NewQwenExecutor("qwen", &ProviderConfig{})
		assert.Equal(t, "qwen", ex.Provider())

		url := ex.BuildURL("model", false, 0, Credentials{})
		assert.Contains(t, url, "dashscope.aliyuncs.com")
	})

	t.Run("XiaomiTokenplan", func(t *testing.T) {
		ex := NewXiaomiTokenplanExecutor("xiaomi-tokenplan", &ProviderConfig{})
		assert.Equal(t, "xiaomi-tokenplan", ex.Provider())

		url := ex.BuildURL("model", false, 0, Credentials{})
		assert.Contains(t, url, "api.mimo.xiaomi.com")
	})
}

func TestSpecialExecutors_Registry_NewExecutors(t *testing.T) {
	tests := []struct {
		name     string
		provider string
	}{
		{"Antigravity", "antigravity"},
		{"CodebuddyCn", "codebuddy-cn"},
		{"CommandCode", "commandcode"},
		{"GeminiCli", "gemini-cli"},
		{"GrokWeb", "grok-web"},
		{"IFlow", "iflow"},
		{"Kiro", "kiro"},
		{"OpenCode", "opencode"},
		{"Qoder", "qoder"},
		{"Qwen", "qwen"},
		{"XiaomiTokenplan", "xiaomi-tokenplan"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ex := Get(tt.provider, &ProviderConfig{})
			assert.NotNil(t, ex)
			// Type assert to check provider name
			switch v := ex.(type) {
			case *AntigravityExecutor:
				assert.Equal(t, tt.provider, v.Provider())
			case *CodebuddyCnExecutor:
				assert.Equal(t, tt.provider, v.Provider())
			case *CommandCodeExecutor:
				assert.Equal(t, tt.provider, v.Provider())
			case *GeminiCliExecutor:
				assert.Equal(t, tt.provider, v.Provider())
			case *GrokWebExecutor:
				assert.Equal(t, tt.provider, v.Provider())
			case *IFlowExecutor:
				assert.Equal(t, tt.provider, v.Provider())
			case *KiroExecutor:
				assert.Equal(t, tt.provider, v.Provider())
			case *OpenCodeExecutor:
				assert.Equal(t, tt.provider, v.Provider())
			case *QoderExecutor:
				assert.Equal(t, tt.provider, v.Provider())
			case *QwenExecutor:
				assert.Equal(t, tt.provider, v.Provider())
			case *XiaomiTokenplanExecutor:
				assert.Equal(t, tt.provider, v.Provider())
			}
		})
	}
}
