package tokensaver

const (
	rtkRawCap        = 10 * 1024 * 1024 // 10 MiB
	rtkMinCompressSize = 500
	rtkSmartHead     = 120
	rtkSmartTail     = 60
	rtkSmartMinLines = 250
)

// RTKStats reports compression results.
type RTKStats struct {
	BytesBefore int64    `json:"bytesBefore"`
	BytesAfter  int64    `json:"bytesAfter"`
	Hits        []string `json:"hits"`
}

// CompressMessages compresses tool_result content in place. It supports
// OpenAI/Claude message shapes and the OpenAI Responses input[] shape.
func CompressMessages(body map[string]any, enabled bool) *RTKStats {
	if !enabled || body == nil {
		return nil
	}
	stats := &RTKStats{}
	if conversationState, ok := body["conversationState"].(map[string]any); ok {
		compressKiroFormat(conversationState, stats)
		return stats
	}
	var items []any
	if v, ok := body["messages"].([]any); ok {
		items = v
	} else if v, ok := body["input"].([]any); ok {
		items = v
	}
	if items == nil {
		return nil
	}
	for _, item := range items {
		msg, ok := item.(map[string]any)
		if !ok {
			continue
		}
		msgType, _ := msg["type"].(string)
		role, _ := msg["role"].(string)
		if msgType == "function_call_output" {
			compressFunctionCallOutput(msg, stats)
			continue
		}
		if role == "tool" {
			if content, ok := msg["content"].(string); ok {
				msg["content"] = compressText(content, stats, "openai-tool")
				continue
			}
			if parts, ok := msg["content"].([]any); ok {
				for _, p := range parts {
					part, ok := p.(map[string]any)
					if !ok {
						continue
					}
					if part["type"] == "text" {
						if text, ok := part["text"].(string); ok {
							part["text"] = compressText(text, stats, "openai-tool-array")
						}
					}
				}
			}
			continue
		}
		parts, ok := msg["content"].([]any)
		if !ok {
			continue
		}
		for _, p := range parts {
			part, ok := p.(map[string]any)
			if !ok {
				continue
			}
			if part["type"] != "tool_result" {
				continue
			}
			if isError, _ := part["is_error"].(bool); isError {
				continue
			}
			if content, ok := part["content"].(string); ok {
				part["content"] = compressText(content, stats, "claude-string")
			} else if subParts, ok := part["content"].([]any); ok {
				for _, sp := range subParts {
					subPart, ok := sp.(map[string]any)
					if !ok {
						continue
					}
					if subPart["type"] == "text" {
						if text, ok := subPart["text"].(string); ok {
							subPart["text"] = compressText(text, stats, "claude-array")
						}
					}
				}
			}
		}
	}
	return stats
}

func compressFunctionCallOutput(msg map[string]any, stats *RTKStats) {
	if output, ok := msg["output"].(string); ok {
		msg["output"] = compressText(output, stats, "openai-responses-string")
		return
	}
	if parts, ok := msg["output"].([]any); ok {
		for _, p := range parts {
			part, ok := p.(map[string]any)
			if !ok {
				continue
			}
			if part["type"] == "input_text" {
				if text, ok := part["text"].(string); ok {
					part["text"] = compressText(text, stats, "openai-responses-array")
				}
			}
		}
	}
}

func compressKiroFormat(state map[string]any, stats *RTKStats) {
	history, _ := state["history"].([]any)
	current, _ := state["currentMessage"].(map[string]any)
	all := append([]any{}, history...)
	if current != nil {
		all = append(all, current)
	}
	for _, item := range all {
		msg, ok := item.(map[string]any)
		if !ok {
			continue
		}
		userInput, ok := msg["userInputMessage"].(map[string]any)
		if !ok {
			continue
		}
		ctx, ok := userInput["userInputMessageContext"].(map[string]any)
		if !ok {
			continue
		}
		toolResults, ok := ctx["toolResults"].([]any)
		if !ok {
			continue
		}
		for _, tr := range toolResults {
			result, ok := tr.(map[string]any)
			if !ok {
				continue
			}
			if status, _ := result["status"].(string); status == "error" {
				continue
			}
			content, ok := result["content"].([]any)
			if !ok {
				continue
			}
			for _, p := range content {
				part, ok := p.(map[string]any)
				if !ok {
					continue
				}
				if text, ok := part["text"].(string); ok {
					part["text"] = compressText(text, stats, "kiro-tool-result")
				}
			}
		}
	}
}

func compressText(text string, stats *RTKStats, kind string) string {
	if len(text) < rtkMinCompressSize {
		return text
	}
	if len(text) > rtkRawCap {
		text = text[:rtkRawCap]
	}
	before := int64(len(text))
	compressed := applyFilter(text)
	after := int64(len(compressed))
	if after < before {
		stats.BytesBefore += before
		stats.BytesAfter += after
		stats.Hits = append(stats.Hits, kind)
	}
	return compressed
}

func applyFilter(text string) string {
	// Autodetect chain: git-diff → git-status → build-output → grep → find →
	// tree → ls → search-list → read-numbered → dedup-log → smart-truncate
	// Ported from open-sse/rtk/autodetect.js + filters/
	filter := autoDetectFilter(text)
	if filter != nil {
		return filter(text)
	}
	return text
}
