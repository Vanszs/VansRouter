package combo

import (
	"strings"
)

// Strategy represents a combo routing strategy.
type Strategy string

const (
	StrategyFallback      Strategy = "fallback"
	StrategyRoundRobin    Strategy = "roundRobin"
	StrategyFusion        Strategy = "fusion"
	StrategyCapacity      Strategy = "capacity"
)

// HardCapabilities are input modalities that must be supported.
var HardCapabilities = map[string]bool{
	"vision":     true,
	"pdf":        true,
	"audioInput": true,
	"videoInput": true,
}

// ComboConfig holds the combo configuration.
type ComboConfig struct {
	Name      string   `json:"name"`
	Strategy  Strategy `json:"strategy"`
	Models    []string `json:"models"`
	JudgeModel string  `json:"judgeModel,omitempty"`
}

// StripComboPrefix removes the "combo/" prefix from a model string.
func StripComboPrefix(modelStr string) string {
	if strings.HasPrefix(modelStr, "combo/") {
		return modelStr[6:]
	}
	return modelStr
}

// IsComboModel checks if a model string is a combo model.
func IsComboModel(modelStr string) bool {
	return strings.HasPrefix(modelStr, "combo/")
}

// ModelCapabilities holds what a model can do.
type ModelCapabilities struct {
	Vision     bool
	PDF        bool
	AudioInput bool
	VideoInput bool
	Search     bool
}

// HasHardCapability checks if a model has a specific hard capability.
func (c ModelCapabilities) HasHardCapability(capName string) bool {
	switch capName {
	case "vision":
		return c.Vision
	case "pdf":
		return c.PDF
	case "audioInput":
		return c.AudioInput
	case "videoInput":
		return c.VideoInput
	default:
		return false
	}
}

// SelectByCapability filters models by hard capabilities.
// Models missing a required hard capability are filtered out.
func SelectByCapability(models []string, caps map[string]ModelCapabilities, required []string) []string {
	var result []string
	for _, m := range models {
		cap, ok := caps[m]
		if !ok {
			result = append(result, m)
			continue
		}
		supported := true
		for _, req := range required {
			if HardCapabilities[req] && !cap.HasHardCapability(req) {
				supported = false
				break
			}
		}
		if supported {
			result = append(result, m)
		}
	}
	return result
}

// FlattenToolHistory converts tool calls/results to prose for panel models.
// This prevents panel models from looping on tools.
func FlattenToolHistory(messages []map[string]interface{}) []map[string]interface{} {
	var result []map[string]interface{}

	for _, msg := range messages {
		role, _ := msg["role"].(string)

		// If no tool_calls and not a tool result, keep as-is
		_, hasToolCalls := msg["tool_calls"]
		if !hasToolCalls && role != "tool" {
			result = append(result, msg)
			continue
		}

		// Convert tool_calls in assistant messages to text
		if hasToolCalls && role == "assistant" {
			newMsg := map[string]interface{}{"role": "assistant"}
			var names []string
			if calls, ok := msg["tool_calls"].([]interface{}); ok {
				for _, c := range calls {
					if call, ok := c.(map[string]interface{}); ok {
						if fn, ok := call["function"].(map[string]interface{}); ok {
							if name, ok := fn["name"].(string); ok {
								names = append(names, name)
							}
						}
					}
				}
			}
			if content, ok := msg["content"].(string); ok && content != "" {
				newMsg["content"] = content + "\n\n[Called tools: " + strings.Join(names, ", ") + "]"
			} else {
				newMsg["content"] = "[Called tools: " + strings.Join(names, ", ") + "]"
			}
			result = append(result, newMsg)
			continue
		}

		// Convert tool result messages to assistant text
		if role == "tool" {
			newMsg := map[string]interface{}{"role": "assistant"}
			content, _ := msg["content"].(string)
			newMsg["content"] = "[Tool result: " + content + "]"
			result = append(result, newMsg)
			continue
		}

		result = append(result, msg)
	}

	return result
}

// SelectModel selects the next model based on strategy.
// For fallback: returns first available model.
// For roundRobin: returns model at index (callCount % len(models)).
// For fusion: returns all models (caller handles parallel).
// For capacity: returns first model that has required capabilities.
func SelectModel(models []string, strategy Strategy, callCount int, caps map[string]ModelCapabilities, required []string) string {
	if len(models) == 0 {
		return ""
	}

	// Filter by capability first
	filtered := SelectByCapability(models, caps, required)
	if len(filtered) == 0 {
		filtered = models // fallback to all if none match
	}

	switch strategy {
	case StrategyFallback:
		return filtered[0]

	case StrategyRoundRobin:
		idx := callCount % len(filtered)
		return filtered[idx]

	case StrategyFusion:
		// Caller handles parallel execution; return first as primary
		return filtered[0]

	case StrategyCapacity:
		// Already filtered by capability
		return filtered[0]

	default:
		return filtered[0]
	}
}

// ComboError wraps an error with context about which model failed.
type ComboError struct {
	Model   string
	Strategy Strategy
	Err     error
}

func (e *ComboError) Error() string {
	return "combo error [" + string(e.Strategy) + "] model=" + e.Model + ": " + e.Err.Error()
}

// ShouldRetry determines if a combo should retry with the next model.
func ShouldRetry(strategy Strategy, modelIndex int, totalModels int) bool {
	switch strategy {
	case StrategyFallback, StrategyRoundRobin:
		return modelIndex < totalModels-1
	case StrategyFusion, StrategyCapacity:
		return false
	default:
		return false
	}
}
