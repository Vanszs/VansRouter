package translator

import "fmt"

// State tracks streaming response translation.
type State struct {
	MessageID            string
	Model                string
	TextBlockStarted     bool
	ThinkingBlockStarted bool
	InThinkingBlock      bool
	CurrentBlockIndex    *int
	ToolCalls            map[string]any
	ToolNameMap          map[string]string
	FinishReason         string
	FinishReasonSent     bool
	Usage                map[string]any
	ContentBlockIndex    int

	// OpenAI -> Claude state
	MessageStartSent bool
	NextBlockIndex   int
	ThinkingBlockIndex int
	TextBlockIndex     int
	TextBlockClosed    bool
	ToolArgBuffers     map[string]any

	// Claude -> OpenAI state
	ServerToolBlockIndex int
	ToolCallIndex        int

	// OpenAI Responses API state (both directions)
	// Uses a dynamic map for the many tracking fields needed by the
	// responses translator (seq, responseId, reasoning/message/toolcall
	// buffers, completedSent, inThinking, etc.)
	Responses map[string]any
}

// TranslateRequest translates a request body from source format to target format.
func TranslateRequest(source, target Format, model string, body map[string]any, stream bool, creds any) (map[string]any, error) {
	key := string(source) + ":" + string(target)
	translator := GetRequestTranslator(key)
	if translator == nil {
		return nil, fmt.Errorf("no request translator registered for %s", key)
	}
	return translator(model, body, stream, creds)
}

// TranslateResponse translates a response chunk from target format back to source format.
func TranslateResponse(target, source Format, chunk map[string]any, state *State) ([]map[string]any, error) {
	key := string(target) + ":" + string(source)
	translator := GetResponseTranslator(key)
	if translator == nil {
		return nil, fmt.Errorf("no response translator registered for %s", key)
	}
	return translator(chunk, state)
}

// NeedsTranslation returns true if source and target formats differ.
func NeedsTranslation(source, target Format) bool {
	return source != target
}

// InitState returns a fresh State for the given source format.
func InitState(source Format) *State {
	return &State{
		ToolCalls:         map[string]any{},
		ToolNameMap:       map[string]string{},
		ToolArgBuffers:    map[string]any{},
		ContentBlockIndex: -1,
		Responses:         map[string]any{},
	}
}
