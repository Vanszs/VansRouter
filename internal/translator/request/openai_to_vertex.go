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
	contents, ok := body["contents"].([]any)
	if !ok {
		return
	}
	for _, c := range contents {
		turn, ok := c.(map[string]any)
		if !ok {
			continue
		}
		parts, ok := turn["parts"].([]any)
		if !ok {
			continue
		}
		for _, p := range parts {
			part, ok := p.(map[string]any)
			if !ok {
				continue
			}
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
