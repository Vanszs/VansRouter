package response

import (
	"github.com/9router/9router/internal/translator"
)

func init() {
	translator.Register(string(translator.FormatCursor), string(translator.FormatOpenAI), nil, cursorToOpenAIResponse)
}

// cursorToOpenAIResponse is a passthrough — CursorExecutor already emits OpenAI chunks.
func cursorToOpenAIResponse(chunk map[string]any, state *translator.State) ([]map[string]any, error) {
	if chunk == nil {
		return nil, nil
	}
	return []map[string]any{chunk}, nil
}
