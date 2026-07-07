package concerns

import "maps"

// ToOpenAIUsage converts provider-native usage to OpenAI-style counters.
func ToOpenAIUsage(usage map[string]any, format string) map[string]any {
	if usage == nil {
		return nil
	}
	promptTokens := IntNumber(usage["input_tokens"]) + IntNumber(usage["cache_read_input_tokens"]) + IntNumber(usage["cache_creation_input_tokens"])
	completionTokens := IntNumber(usage["output_tokens"])
	if promptTokens == 0 {
		promptTokens = IntNumber(usage["prompt_tokens"])
	}
	if completionTokens == 0 {
		completionTokens = IntNumber(usage["completion_tokens"])
	}
	out := map[string]any{
		"prompt_tokens":     promptTokens,
		"completion_tokens": completionTokens,
		"total_tokens":      promptTokens + completionTokens,
	}
	if v := IntNumber(usage["cache_read_input_tokens"]); v > 0 {
		out["cache_read_input_tokens"] = v
	}
	if v := IntNumber(usage["cache_creation_input_tokens"]); v > 0 {
		out["cache_creation_input_tokens"] = v
	}
	return out
}

// MergeUsage merges src into dst. If dst is nil, a new map is returned.
func MergeUsage(dst, src map[string]any) map[string]any {
	if dst == nil {
		dst = map[string]any{}
	}
	maps.Copy(dst, src)
	return dst
}

func IntNumber(v any) int {
	switch n := v.(type) {
	case int:
		return n
	case int64:
		return int(n)
	case float64:
		return int(n)
	case float32:
		return int(n)
	default:
		return 0
	}
}

// BuildUsage builds an OpenAI usage object from explicit token counts.
// Optional detail fields are added only when > 0.
func BuildUsage(promptTokens, completionTokens, totalTokens, cachedTokens, cacheCreationTokens, reasoningTokens int) map[string]any {
	usage := map[string]any{
		"prompt_tokens":     promptTokens,
		"completion_tokens": completionTokens,
		"total_tokens":      totalTokens,
	}
	if cachedTokens > 0 || cacheCreationTokens > 0 {
		details := map[string]any{}
		if cachedTokens > 0 {
			details["cached_tokens"] = cachedTokens
		}
		if cacheCreationTokens > 0 {
			details["cache_creation_tokens"] = cacheCreationTokens
		}
		usage["prompt_tokens_details"] = details
	}
	if reasoningTokens > 0 {
		usage["completion_tokens_details"] = map[string]any{"reasoning_tokens": reasoningTokens}
	}
	return usage
}
