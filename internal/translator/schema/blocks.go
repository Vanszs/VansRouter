package schema

const (
	OpenAIBlockTypeText       = "text"
	OpenAIBlockTypeImageURL   = "image_url"
	OpenAIBlockTypeInputAudio = "input_audio"
	OpenAIBlockTypeRefusal    = "refusal"
	OpenAIBlockTypeFunction   = "function"
	OpenAIBlockTypeImage      = "image"
	OpenAIBlockTypeFile       = "file"

	ClaudeBlockTypeText       = "text"
	ClaudeBlockTypeImage      = "image"
	ClaudeBlockTypeToolUse    = "tool_use"
	ClaudeBlockTypeToolResult = "tool_result"
	ClaudeBlockTypeThinking   = "thinking"
	ClaudeBlockTypeDocument   = "document"

	ResponsesItemTypeMessage           = "message"
	ResponsesItemTypeThinking          = "thinking"
	ResponsesItemTypeFunctionCall      = "function_call"
	ResponsesItemTypeFunctionCallOutput = "function_call_output"
	ResponsesItemTypeReasoning         = "reasoning"
	ResponsesItemTypeOutputText        = "output_text"
	ResponsesItemTypeInputText         = "input_text"
	ResponsesItemTypeInputImage        = "input_image"
	ResponsesItemTypeSummaryText       = "summary_text"
)

var (
	ValidOpenAIContentTypes = []string{
		"text",
		"image_url",
		"input_audio",
		"refusal",
	}

	ValidOpenAIMessageTypes = []string{
		"system",
		"user",
		"assistant",
		"tool",
	}
)
