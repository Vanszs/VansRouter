package request

import (
	"github.com/9router/9router/internal/translator"
)

// ponytail: Vertex is Gemini-compatible with minor post-processing; we delegate to the Gemini translator and strip id fields from functionCall/functionResponse. The thoughtSignature replacement is deferred until defaultThinkingSignature config is ported.

func init() {
	translator.Register(string(translator.FormatOpenAI), string(translator.FormatVertex), openaiToVertexRequest, nil)
}

func openaiToVertexRequest(model string, body map[string]any, stream bool, creds any) (map[string]any, error) {
	// Delegate to Gemini translator
	gemini, err := openaiToGeminiRequest(model, body, stream, creds)
	if err != nil {
		return nil, err
	}
	if gemini == nil {
		return nil, nil
	}
	postProcessForVertex(gemini)
	return gemini, nil
}

func postProcessForVertex(body map[string]any) {
	// Handle both []any and []map[string]any — the Gemini translator
	// builds contents as []map[string]any, but external callers may pass []any.
	var turns []map[string]any
	switch c := body["contents"].(type) {
	case []any:
		for _, item := range c {
			if m, ok := item.(map[string]any); ok {
				turns = append(turns, m)
			}
		}
	case []map[string]any:
		turns = c
	default:
		return
	}
	for _, turn := range turns {
		// Similarly handle both types for parts
		var parts []map[string]any
		switch p := turn["parts"].(type) {
		case []any:
			for _, item := range p {
				if m, ok := item.(map[string]any); ok {
					parts = append(parts, m)
				}
			}
		case []map[string]any:
			parts = p
		}
		for _, part := range parts {
			// Strip id from functionCall (Vertex rejects these)
			if fc, ok := part["functionCall"].(map[string]any); ok {
				delete(fc, "id")
			}
			// Strip id from functionResponse
			if fr, ok := part["functionResponse"].(map[string]any); ok {
				delete(fr, "id")
			}
		}
	}
}
