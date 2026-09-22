// Tool call helper functions for translator
import { FORMATS } from "../formats.js";

// Anthropic tool_use.id must match: ^[a-zA-Z0-9_-]+$
const TOOL_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

// Fallback streaming tool_call id when provider omits one (index optional)
export function fallbackToolCallId(index) {
  return index === undefined ? `call_${Date.now()}` : `call_${index}_${Date.now()}`;
}

// Kiro only accepts sanitized tool names; the request translator leaves the
// reverse map on the stream state so calls come back under the client's names.
export function restoreToolName(stateOrData, name) {
  const raw = name || "";
  const map = stateOrData?.toolNameMap || stateOrData?._toolNameMap;
  return map && typeof map.get === "function" && map.has(raw) ? map.get(raw) : raw;
}

// Generate deterministic tool call ID from position + tool name (cache-friendly)
export function generateToolCallId(msgIndex = 0, tcIndex = 0, toolName = "") {
  const name = toolName ? `_${toolName.replace(/[^a-zA-Z0-9_-]/g, "")}` : "";
  return `call_msg${msgIndex}_tc${tcIndex}${name}`;
}

// Sanitize ID to match Anthropic pattern: keep only alphanumeric, underscore, hyphen
function sanitizeToolId(id) {
  if (!id || typeof id !== "string") return null;
  const sanitized = id.replace(/[^a-zA-Z0-9_-]/g, "");
  return sanitized.length > 0 ? sanitized : null;
}

// Ensure all tool_calls have valid id field and arguments is string (some providers require it)
export function ensureToolCallIds(body) {
  if (!body.messages || !Array.isArray(body.messages)) return body;

  for (let i = 0; i < body.messages.length; i++) {
    const msg = body.messages[i];
    if (msg.role === "assistant" && msg.tool_calls && Array.isArray(msg.tool_calls)) {
      for (let j = 0; j < msg.tool_calls.length; j++) {
        const tc = msg.tool_calls[j];
        // Validate or regenerate ID for Anthropic compatibility
        if (!tc.id || !TOOL_ID_PATTERN.test(tc.id)) {
          const sanitized = sanitizeToolId(tc.id);
          tc.id = sanitized || generateToolCallId(i, j, tc.function?.name);
        }
        if (!tc.type) {
          tc.type = "function";
        }
        // Ensure arguments is JSON string, not object
        if (tc.function?.arguments && typeof tc.function.arguments !== "string") {
          tc.function.arguments = JSON.stringify(tc.function.arguments);
        }
      }
    }

    // Validate tool_call_id in tool messages (role: "tool")
    if (msg.role === "tool" && msg.tool_call_id && !TOOL_ID_PATTERN.test(msg.tool_call_id)) {
      const sanitized = sanitizeToolId(msg.tool_call_id);
      msg.tool_call_id = sanitized || generateToolCallId(i, 0);
    }

    // Also validate tool_use blocks in content (Claude format)
    if (Array.isArray(msg.content)) {
      for (let k = 0; k < msg.content.length; k++) {
        const block = msg.content[k];
        if (block.type === "tool_use" && block.id && !TOOL_ID_PATTERN.test(block.id)) {
          const sanitized = sanitizeToolId(block.id);
          block.id = sanitized || generateToolCallId(i, k, block.name);
        }
        // Validate tool_use_id in tool_result blocks
        if (block.type === "tool_result" && block.tool_use_id && !TOOL_ID_PATTERN.test(block.tool_use_id)) {
          const sanitized = sanitizeToolId(block.tool_use_id);
          block.tool_use_id = sanitized || generateToolCallId(i, k);
        }
      }
    }
  }

  return body;
}

// Get tool_call ids from assistant message (OpenAI format: tool_calls, Claude format: tool_use in content)
export function getToolCallIds(msg) {
  if (msg.role !== "assistant") return [];

  const ids = [];

  // OpenAI format: tool_calls array
  if (msg.tool_calls && Array.isArray(msg.tool_calls)) {
    for (const tc of msg.tool_calls) {
      if (tc.id) ids.push(tc.id);
    }
  }

  // Claude format: tool_use blocks in content
  if (Array.isArray(msg.content)) {
    for (const block of msg.content) {
      if (block.type === "tool_use" && block.id) {
        ids.push(block.id);
      }
    }
  }

  return ids;
}

// Check if user message has tool_result for given ids (OpenAI format: role=tool, Claude format: tool_result in content)
export function hasToolResults(msg, toolCallIds) {
  if (!msg || !toolCallIds.length) return false;

  // OpenAI format: role = "tool" with tool_call_id
  if (msg.role === "tool" && msg.tool_call_id) {
    return toolCallIds.includes(msg.tool_call_id);
  }

  // Claude format: tool_result blocks in user message content
  if (msg.role === "user" && Array.isArray(msg.content)) {
    for (const block of msg.content) {
      if (block.type === "tool_result" && toolCallIds.includes(block.tool_use_id)) {
        return true;
      }
    }
  }

  return false;
}

// Extract tool names from a tools array (handles OpenAI `tools[].function.name`
// and generic `tools[].name`). Used by both request-side prompt injection and
// response-side fuzzy correction.
export function extractToolNames(tools) {
  if (!Array.isArray(tools)) return [];
  return tools
    .map((tool) => tool?.function?.name || tool?.name)
    .filter((name) => typeof name === "string" && name.trim());
}

// Known prefixes that weak / local models (notably Kimi-K2 served via kimchi)
// incorrectly prepend to tool names. Symptom: model emits "functionsread" /
// "functions.read" instead of "read" → client rejects as unavailable tool.
// Trim prefixes case-insensitively then re-check exact match.
const BAD_TOOL_NAME_PREFIXES = [
  "functions.", "functions/", "functions_",
  "function.", "function/", "function_",
  "tools.", "tools/", "tools_",
  "tool.", "tool/", "tool_",
  "funcs.", "funcs/", "funcs_",
  "fn.", "fn/", "fn_",
  "mcp__",
];

// Bare (no-separator) variants — strip only when the remainder is a real tool
// name of length ≥4, to avoid false positives like stripping "function" from
// "functional" and then colliding with a short tool like "al".
const BAD_TOOL_NAME_BARE_PREFIXES = [
  "functions", "function", "tools", "tool", "funcs", "fn",
];

// Minimum stripped-remainder length to accept a bare-prefix correction.
const BARE_PREFIX_MIN_REMAINDER = 4;

// Try to fuzzy-correct a malformed tool name against the list of valid tools
// sent in the request. Returns the corrected name if a confident match is
// found, otherwise returns the candidate unchanged (let downstream error
// surface). Conservative: never modifies a name that already matches exactly.
export function fuzzyMatchToolName(candidate, validToolNames) {
  if (!candidate || typeof candidate !== "string") return candidate;
  if (!Array.isArray(validToolNames) || validToolNames.length === 0) return candidate;

  // 1. Exact match — nothing to do
  if (validToolNames.includes(candidate)) return candidate;

  const lowerCandidate = candidate.toLowerCase();

  // 2. Case-insensitive exact match
  const ciMatch = validToolNames.find(
    (n) => typeof n === "string" && n.toLowerCase() === lowerCandidate
  );
  if (ciMatch) return ciMatch;

  // 3. Strip known bad prefixes (with separator) and re-check exact match
  for (const prefix of BAD_TOOL_NAME_PREFIXES) {
    if (lowerCandidate.startsWith(prefix) && candidate.length > prefix.length) {
      const stripped = candidate.slice(prefix.length);
      if (validToolNames.includes(stripped)) return stripped;
      const strippedCi = validToolNames.find(
        (n) => typeof n === "string" && n.toLowerCase() === stripped.toLowerCase()
      );
      if (strippedCi) return strippedCi;
    }
  }

  // 4. Bare prefixes (no separator). Only accept when remainder is ≥4 chars
  //    so e.g. "function" → "al" (where "al" is a tool) cannot happen.
  for (const prefix of BAD_TOOL_NAME_BARE_PREFIXES) {
    if (lowerCandidate.startsWith(prefix) && candidate.length > prefix.length) {
      const stripped = candidate.slice(prefix.length);
      if (stripped.length < BARE_PREFIX_MIN_REMAINDER) continue;
      if (validToolNames.includes(stripped)) return stripped;
      const strippedCi = validToolNames.find(
        (n) => typeof n === "string" && n.toLowerCase() === stripped.toLowerCase()
      );
      if (strippedCi) return strippedCi;
    }
  }

  // 5. Conservative substring match. Avoid false positives from tiny overlaps
  //    by requiring both names ≥4 chars and length difference ≤ max(4, 50%).
  if (candidate.length >= 4) {
    for (const name of validToolNames) {
      if (typeof name !== "string" || name.length < 4) continue;
      const lengthDiff = Math.abs(name.length - candidate.length);
      const maxAllowedDiff = Math.max(4, Math.floor(Math.min(name.length, candidate.length) * 0.5));
      if (lengthDiff > maxAllowedDiff) continue;
      const lowerName = name.toLowerCase();
      if (lowerCandidate.includes(lowerName) || lowerName.includes(lowerCandidate)) {
        return name;
      }
    }
  }

  return candidate;
}

// Fix missing tool responses - insert empty tool_result if assistant has tool_use but next message has no tool_result
export function fixMissingToolResponses(body) {
  if (!body.messages || !Array.isArray(body.messages)) return body;

  const newMessages = [];

  for (let i = 0; i < body.messages.length; i++) {
    const msg = body.messages[i];
    const nextMsg = body.messages[i + 1];

    newMessages.push(msg);

    // Check if this is assistant with tool_calls/tool_use
    const toolCallIds = getToolCallIds(msg);
    if (toolCallIds.length === 0) continue;

    // Check if next message has tool_result
    if (nextMsg && !hasToolResults(nextMsg, toolCallIds)) {
      // Insert tool responses for each tool_call
      for (const id of toolCallIds) {
        // OpenAI format: role = "tool"
        newMessages.push({
          role: "tool",
          tool_call_id: id,
          content: ""
        });
      }
    }
  }

  body.messages = newMessages;
  return body;
}

// Default `type: "custom"` on Claude-format tools that arrive without one.
// Anthropic's Claude tool schema requires `type` to be explicitly set; strict gateways
// (e.g., MiniMax Anthropic-compatible endpoint, error 2013) reject legacy payloads that
// omit it with HTTP 400. Tools that already carry a truthy `type` (e.g., `computer_use`,
// `bash`, `web_search_20250305`) are passed through untouched.
//
// Spread order matters: `{ ...tool, type: "custom" }` (spread first, override last)
// ensures that falsy `type` values (null, undefined, "") in the original tool don't
// overwrite the default. `{ type: "custom", ...tool }` would let `type: null` survive.
export function defaultClaudeToolType(tools) {
  if (!Array.isArray(tools)) return tools;
  return tools.map(tool => tool?.type ? tool : { ...tool, type: "custom" });
}

export function shouldDefaultClaudeToolType(provider, finalFormat, tools, PROVIDERS) {
  return finalFormat === FORMATS.CLAUDE
    && Array.isArray(tools)
    && PROVIDERS?.[provider]?.quirks?.requireClaudeToolType === true;
}

