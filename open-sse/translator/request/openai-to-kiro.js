/**
 * OpenAI to Kiro Request Translator
 * Converts OpenAI Chat Completions format to Kiro/AWS CodeWhisperer format
 */
import { register } from "../registry.js";
import { FORMATS } from "../formats.js";
import { randomUUID } from "node:crypto";
import { applyKiroSessionReplay } from "../../utils/kiroSessionReplay.js";
import { resolveContinuationId, resolveSessionIdentity } from "../../utils/sessionManager.js";
import {
  resolveKiroModelIntent,
  applyKiroThinkingOverride,
  resolveKiroThinkingBudget,
  buildThinkingSystemPrefix,
  KIRO_AGENTIC_SYSTEM_PROMPT,
  resolveDefaultProfileArn,
  buildKiroAdditionalModelRequestFieldsForModel,
  usesKiroNativeGptEffort
} from "../../config/kiroConstants.js";
import { parseDataUri } from "../concerns/image.js";
import { DEFAULT_IMAGE_MIME } from "../schema/index.js";
import { ROLE, OPENAI_BLOCK, CLAUDE_BLOCK } from "../schema/index.js";
import {
  canonicalizeKiroConversation,
  normalizeKiroToolSpecs,
  kiroEmptyUserContent,
} from "../concerns/kiroConversation.js";

/** Render a single tool call as a readable text line. */
function toolCallToText(name, input) {
  let argStr;
  try {
    argStr = typeof input === "string" ? input : JSON.stringify(input ?? {});
  } catch {
    argStr = "{}";
  }
  return `[Tool call: ${name || "unknown"}(${argStr})]`;
}

/** Render a tool result (string or content-block array) as a text line. */
function toolResultToText(content) {
  const text = Array.isArray(content)
    ? content.map(c => (typeof c === "string" ? c : c.text || "")).join("\n")
    : (typeof content === "string" ? content : "");
  return `[Tool result: ${text}]`;
}

/**
 * Flatten all tool calls/results in a conversation into plain text.
 *
 * Kiro's schema validator requires a non-empty
 * currentMessage.userInputMessageContext.tools array whenever the history
 * references any tool use; otherwise it returns "Improperly formed request"
 * (HTTP 400). A client can hit this by omitting the `tools` array on a
 * follow-up request — typically after client-side compaction (e.g. OpenCode).
 *
 * Rather than fabricate stub tool specs — which would advertise tool-calling
 * capability the client never requested and may not handle, risking a phantom
 * tool call on an otherwise plain turn — we collapse the tool interaction into
 * text. The request stays honest, and since no structured tool content
 * remains, the validator's "tools required" rule never fires.
 *
 * Only invoked when the client did NOT send tools; when tools are present the
 * structured form is preserved.
 */
function reconcileOrphanedToolResults(history, currentMessage) {
  const validIds = new Set();
  for (const h of history) {
    const arm = h.assistantResponseMessage;
    if (!arm) continue;
    for (const tu of arm.toolUses || []) {
      if (tu.toolUseId) validIds.add(tu.toolUseId);
    }
  }

  const carriers = currentMessage ? [...history, currentMessage] : history;
  for (const item of carriers) {
    const uim = item.userInputMessage;
    const ctx = uim?.userInputMessageContext;
    if (!ctx?.toolResults?.length) continue;

    const kept = [];
    const salvaged = [];
    for (const tr of ctx.toolResults) {
      if (validIds.has(tr.toolUseId)) {
        kept.push(tr);
      } else {
        salvaged.push(toolResultToText(tr.content));
      }
    }

    if (salvaged.length === 0) continue;

    const extra = salvaged.join("\n");
    uim.content = uim.content ? `${uim.content}\n\n${extra}` : extra;

    ctx.toolResults = kept;
    if (kept.length === 0 && !ctx.tools?.length) {
      delete uim.userInputMessageContext;
    }
  }
}

/**
 * Safely parse JSON string, returning fallback on failure.
 */
function safeJSONParse(str, fallback) {
  if (typeof str !== "string") return str ?? fallback;
  try { return JSON.parse(str); } catch { return fallback; }
}

/**
 * Convert OpenAI messages to Kiro format
 * Rules: system/tool/user -> user role, merge consecutive same roles.
 *
 * Returns { history, currentMessage }.
 */
function convertMessages(messages, tools, model) {
  let history = [];
  let currentMessage = null;

  const clientProvidedTools = tools && tools.length > 0;

  // When the client did not send tools, tool calls/results are handled by canonicalizeKiroConversation.

  let pendingUserContent = [];
  let pendingAssistantContent = [];
  let pendingToolResults = [];
  let pendingImages = [];
  let currentRole = null;
  let toolsInjectedToFirstUserMsg = false;

  const flushPending = () => {
    if (currentRole === "user") {
      const content = pendingUserContent.join("\n\n").trim()
        || kiroEmptyUserContent(pendingToolResults.length > 0);
      const userMsg = {
        userInputMessage: {
          content: content,
          modelId: ""
        }
      };

      // Attach images if present (Kiro API supports images field)
      if (pendingImages.length > 0) {
        userMsg.userInputMessage.images = pendingImages;
      }

      if (pendingToolResults.length > 0) {
        userMsg.userInputMessage.userInputMessageContext = {
          toolResults: pendingToolResults
        };
      }

      // Add tools to the user message that has no preceding assistant messages,
      // OR the first user message (whichever comes first after any opening
      // assistant messages). We track whether any user message has already
      // received tools via a flag on the history array.
      if (clientProvidedTools && !toolsInjectedToFirstUserMsg) {
        if (!userMsg.userInputMessage.userInputMessageContext) {
          userMsg.userInputMessage.userInputMessageContext = {};
        }
        userMsg.userInputMessage.userInputMessageContext.tools = tools.map(t => {
          const name = t.function?.name || t.name;
          let description = t.function?.description || t.description || "";

          if (!description.trim()) {
            description = `Tool: ${name}`;
          }

          const schema = t.function?.parameters || t.parameters || t.input_schema || {};
          // Normalize schema: Kiro requires required[] and proper type/properties
          const normalizedSchema = Object.keys(schema).length === 0
            ? { type: "object", properties: {}, required: [] }
            : { ...schema, required: schema.required ?? [] };

          return {
            toolSpecification: {
              name,
              description,
              inputSchema: { json: normalizedSchema }
            }
          };
        });
        toolsInjectedToFirstUserMsg = true;
      }

      history.push(userMsg);
      currentMessage = userMsg;
      pendingUserContent = [];
      pendingToolResults = [];
      pendingImages = [];
    } else if (currentRole === "assistant") {
      const content = pendingAssistantContent.join("\n\n").trim() || "...";
      const assistantMsg = {
        assistantResponseMessage: {
          content: content
        }
      };
      history.push(assistantMsg);
      pendingAssistantContent = [];
    }
  };

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    let role = msg.role;

    // Normalize: system/tool -> user
    const wasSystem = role === ROLE.SYSTEM;
    if (role === ROLE.SYSTEM || role === ROLE.TOOL) {
      role = ROLE.USER;
    }

    // If role changes, flush pending
    if (role !== currentRole && currentRole !== null) {
      flushPending();
    }
    currentRole = role;

    if (role === ROLE.USER) {
      // Extract content
      let content = "";
      if (typeof msg.content === "string") {
        content = msg.content;
      } else if (Array.isArray(msg.content)) {
        const textParts = [];
        for (const c of msg.content) {
          if (c.type === OPENAI_BLOCK.TEXT || c.text) {
            textParts.push(c.text || "");
          } else if (c.type === OPENAI_BLOCK.IMAGE_URL) {
            // OpenAI format: image_url.url with data URI
            const url = c.image_url?.url || "";
            const parsed = parseDataUri(url);
            if (parsed) {
              const format = parsed.mimeType.split("/")[1] || parsed.mimeType;
              pendingImages.push({ format, source: { bytes: parsed.base64 } });
            } else if (url.startsWith("http://") || url.startsWith("https://")) {
              // Kiro only supports base64 — fallback to URL text placeholder
              textParts.push(`[Image: ${url}]`);
            }
          } else if (c.type === CLAUDE_BLOCK.IMAGE) {
            // Claude format: source.type = "base64", source.media_type, source.data
            if (c.source?.type === "base64" && c.source?.data) {
              const mediaType = c.source.media_type || DEFAULT_IMAGE_MIME;
              const format = mediaType.split("/")[1] || mediaType;
              pendingImages.push({ format, source: { bytes: c.source.data } });
            }
          }
        }
        content = textParts.join("\n");

        // Check for tool_result blocks
        const toolResultBlocks = msg.content.filter(c => c.type === CLAUDE_BLOCK.TOOL_RESULT);
        if (toolResultBlocks.length > 0) {
          toolResultBlocks.forEach(block => {
            const text = Array.isArray(block.content)
              ? block.content.map(c => c.text || "").join("\n")
              : (typeof block.content === "string" ? block.content : "");

            pendingToolResults.push({
              toolUseId: block.tool_use_id,
              status: block.is_error ? "error" : "success",
              content: [{ text: text }]
            });
          });
        }
      }

      // Handle tool role (from normalized)
      if (msg.role === ROLE.TOOL) {
        const toolContent = typeof msg.content === "string" ? msg.content : "";
        pendingToolResults.push({
          toolUseId: msg.tool_call_id,
          status: msg.is_error || msg.status === "error" ? "error" : "success",
          content: [{ text: toolContent }]
        });
      } else if (content) {
        // <instructions> tags: Claude models treat these as authoritative directives.
        pendingUserContent.push(
          wasSystem ? `<instructions>\n${content}\n</instructions>` : content
        );
      }
    } else if (role === ROLE.ASSISTANT) {
      // Extract text content and tool uses
      let textContent = "";
      let toolUses = [];

      if (Array.isArray(msg.content)) {
        const textBlocks = msg.content.filter(c => c.type === OPENAI_BLOCK.TEXT);
        textContent = textBlocks.map(b => b.text).join("\n").trim();

        const toolUseBlocks = msg.content.filter(c => c.type === CLAUDE_BLOCK.TOOL_USE);
        toolUses = toolUseBlocks;
      } else if (typeof msg.content === "string") {
        textContent = msg.content.trim();
      }

      if (msg.tool_calls && msg.tool_calls.length > 0) {
        toolUses = msg.tool_calls;
      }

      if (textContent) {
        pendingAssistantContent.push(textContent);
      }

      // Store tool uses in last assistant message
      if (toolUses.length > 0) {
        // Flush to create assistant message with toolUses
        flushPending();

        const lastMsg = history[history.length - 1];
        if (lastMsg?.assistantResponseMessage) {
          lastMsg.assistantResponseMessage.toolUses = toolUses.map(tc => {
            if (tc.function) {
              return {
                toolUseId: tc.id || randomUUID(),
                name: tc.function.name,
                input: safeJSONParse(tc.function.arguments, {})
              };
            } else {
              return {
                toolUseId: tc.id || randomUUID(),
                name: tc.name,
                input: tc.input || {}
              };
            }
          });
        }

        currentRole = null;
      }
    }
  }

  // Flush remaining
  if (currentRole !== null) {
    flushPending();
  }

  // Pop last userInputMessage as currentMessage (search from end, skip trailing assistant messages)
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].userInputMessage) {
      currentMessage = history.splice(i, 1)[0];
      break;
    }
  }

  // Grab tools from first history item BEFORE cleanup removes them
  const firstHistoryTools = history[0]?.userInputMessage?.userInputMessageContext?.tools;

  // Clean up history for Kiro API compatibility
  history.forEach(item => {
    if (item.userInputMessage?.userInputMessageContext?.tools) {
      delete item.userInputMessage.userInputMessageContext.tools;
    }
    if (item.userInputMessage?.userInputMessageContext &&
        Object.keys(item.userInputMessage.userInputMessageContext).length === 0) {
      delete item.userInputMessage.userInputMessageContext;
    }
    if (item.userInputMessage && !item.userInputMessage.modelId) {
      item.userInputMessage.modelId = model;
    }
  });

  // Merge consecutive user messages (Kiro requires alternating user/assistant)
  // When merging, also combine userInputMessageContext fields so toolResults
  // and images from the second message are not silently dropped.
  const mergedHistory = [];
  for (let i = 0; i < history.length; i++) {
    const current = history[i];
    if (current.userInputMessage &&
        mergedHistory.length > 0 &&
        mergedHistory[mergedHistory.length - 1].userInputMessage) {
      const prev = mergedHistory[mergedHistory.length - 1];
      prev.userInputMessage.content += "\n\n" + current.userInputMessage.content;
      // Merge context: combine toolResults, images, etc.
      const prevCtx = prev.userInputMessage.userInputMessageContext;
      const curCtx = current.userInputMessage.userInputMessageContext;
      if (curCtx) {
        if (!prevCtx) {
          prev.userInputMessage.userInputMessageContext = curCtx;
        } else {
          if (curCtx.toolResults?.length > 0) {
            prevCtx.toolResults = [...(prevCtx.toolResults || []), ...curCtx.toolResults];
          }
          if (curCtx.tools?.length > 0) {
            prevCtx.tools = [...(prevCtx.tools || []), ...curCtx.tools];
          }
        }
      }
    } else {
      mergedHistory.push(current);
    }
  }

  // When currentMessage is null (no user messages at all — edge case where
  // input is only assistant messages), create a minimal currentMessage so
  // tools and content can be injected.
  if (!currentMessage) {
    currentMessage = {
      userInputMessage: {
        content: "",
        modelId: model,
      }
    };
  }

  // Reconcile orphaned toolResults across history AND currentMessage — when
  // client-side compaction removes assistant messages containing tool_use but
  // keeps the tool_result, the dangling reference triggers a Kiro 400. Fold the
  // content back into the user text instead of discarding it. Run after
  // currentMessage is finalized (an orphan can be merged into it) and before
  // tool injection (which may re-add userInputMessageContext).
  //
  // Only needed on the tools-present path: when the client sent no tools,
  // flattenToolInteractions already collapsed every toolResult to text, so
  // there is nothing structured left to orphan.
  if (clientProvidedTools) {
    reconcileOrphanedToolResults(mergedHistory, currentMessage);
  }

  // Inject tools into currentMessage AFTER cleanup. Tools only exist here when
  // the client explicitly sent them (otherwise flattenToolInteractions already
  // collapsed all tool content to text upstream, so there is nothing to carry).
  const resolvedTools = firstHistoryTools;

  if (resolvedTools?.length > 0 &&
      !currentMessage.userInputMessage.userInputMessageContext?.tools) {
    if (!currentMessage.userInputMessage.userInputMessageContext) {
      currentMessage.userInputMessage.userInputMessageContext = {};
    }
    currentMessage.userInputMessage.userInputMessageContext.tools = resolvedTools;
  }

  return { history: mergedHistory, currentMessage };
}

/**
 * Build Kiro payload from OpenAI format
 *
 * Two 9router-specific behaviours implemented here:
 *
 * 1. `-agentic` model suffix. Synthetic variant — same upstream model, but we
 *    inject a chunked-write system prompt to keep large file writes under
 *    Kiro's 2-3 minute server timeout. The suffix is stripped before being
 *    sent upstream.
 *
 * 2. Thinking / reasoning. Detection covers Anthropic-Beta header, Claude API
 *    `thinking`, OpenAI `reasoning_effort`, AMP/Cursor magic tags, and model
 *    name hints. Supported models receive Kiro's schema-specific effort fields;
 *    legacy prompt tags remain only for models that need them.
 */
export function openaiToKiroRequest(model, body, stream, credentials) {
  const messages = body.messages || [];
  const tools = body.tools || [];
  const maxTokens = 32000;
  const temperature = body.temperature;
  const topP = body.top_p;

  const modelIntent = resolveKiroModelIntent(model);
  const { upstream: upstreamModel, agentic } = modelIntent;
  const thinkingBody = applyKiroThinkingOverride(body, modelIntent.thinkingOverride);
  const thinkingBudget = resolveKiroThinkingBudget(thinkingBody, credentials?.rawHeaders, modelIntent.model);
  const additionalModelRequestFields = buildKiroAdditionalModelRequestFieldsForModel(thinkingBody, upstreamModel);
  const usesNativeGptEffort = usesKiroNativeGptEffort(thinkingBody, upstreamModel);

  const { specs: toolSpecs, nameMap } = normalizeKiroToolSpecs(tools);
  const { history, currentMessage } = convertMessages(messages, tools, upstreamModel);

  // API-key (headless) auth uses a raw CodeWhisperer credential whose profile is
  // account-specific. Injecting the shared builder-id/social *default* placeholder
  // ARN makes CodeWhisperer reject the request with 403 "bearer token invalid"
  // (the ARN doesn't belong to the key's account). So for api_key, only send a
  // profileArn that was actually resolved for this connection — never the default.
  // OAuth/social keep the default fallback (their tokens accept it).
  // api_key / idc / external_idp carry an account-specific (or token-bound)
  // profile. The shared builder-id/social default ARN belongs to a different
  // account and triggers 403 "bearer token invalid", so never fall back to it —
  // send the resolved ARN, or an empty string so CodeWhisperer uses the token's
  // own default profile. Only OAuth/social keep the shared placeholder.
  const authMethod = credentials?.providerSpecificData?.authMethod;
  const accountBoundAuth =
    authMethod === "api_key" || authMethod === "idc" || authMethod === "external_idp";
  const profileArn = accountBoundAuth
    ? (credentials?.providerSpecificData?.profileArn || "")
    : (credentials?.providerSpecificData?.profileArn || resolveDefaultProfileArn(authMethod));

  const timestamp = new Date().toISOString();

  // System directives ride inside the session-start user message content (see
  // contentPrefix below) rather than a top-level field, because the
  // CodeWhisperer GenerateAssistantResponse surface rejects the latter.
  const systemPromptParts = [];
  if (thinkingBudget !== null && !usesNativeGptEffort) {
    systemPromptParts.push(buildThinkingSystemPrefix(thinkingBudget));
  }
  if (agentic) {
    systemPromptParts.push(KIRO_AGENTIC_SYSTEM_PROMPT);
  }
  const systemPrompt = systemPromptParts.filter(Boolean).join("\n\n");
  const currentTimeContext = `[Context: Current time is ${timestamp}]`;
  const contentPrefix = [systemPrompt, currentTimeContext].filter(Boolean).join("\n\n");

  const sessionIdentity = resolveSessionIdentity({ headers: credentials?.rawHeaders, body, connectionId: credentials?.connectionId, scope: "kiro" });
  const conversationId = sessionIdentity.sessionId;
  const continuationId = resolveContinuationId({
    sessionId: conversationId,
    connectionId: credentials?.connectionId,
    scope: "kiro",
    ephemeral: sessionIdentity.ephemeral,
  });
  const replay = applyKiroSessionReplay({
    conversationId,
    connectionId: credentials?.connectionId,
    modelId: upstreamModel,
    systemPrompt,
    contentPrefix,
    currentContentPrefix: currentTimeContext,
    history,
    currentMessage,
  });
  const canonical = canonicalizeKiroConversation({
    history: replay.history,
    currentMessage: replay.currentMessage,
    modelId: upstreamModel,
    toolSpecs,
    nameMap,
  });
  if (!canonical.valid) {
    console.error(`[Kiro] refusing invalid conversation (openai -> kiro): ${(canonical.errors || []).join(", ") || "unknown"}`);
    return null;
  }
  const replayCurrent = canonical.currentMessage.userInputMessage;

  const payload = {
    conversationState: {
      chatTriggerType: "MANUAL",
      conversationId,
      agentContinuationId: continuationId,
      agentTaskType: "vibe",
      currentMessage: {
        userInputMessage: {
          content: replayCurrent.content || "",
          modelId: upstreamModel,
          origin: "AI_EDITOR",
          ...(replayCurrent.images?.length > 0 && {
            images: replayCurrent.images
          }),
          ...(replayCurrent.userInputMessageContext && {
            userInputMessageContext: replayCurrent.userInputMessageContext
          })
        }
      },
      history: canonical.history
    },
    agentMode: "vibe",
  };

  if (profileArn) {
    payload.profileArn = profileArn;
  }
  // No top-level `systemPrompt`: GenerateAssistantResponse answers any payload
  // carrying it with 400 {"reason":"REQUEST_BODY_INVALID"}. The same text is
  // already delivered through contentPrefix.
  if (additionalModelRequestFields) {
    payload.additionalModelRequestFields = additionalModelRequestFields;
  }

  if (maxTokens || temperature !== undefined || topP !== undefined) {
    payload.inferenceConfig = {};
    if (maxTokens) payload.inferenceConfig.maxTokens = maxTokens;
    if (temperature !== undefined) payload.inferenceConfig.temperature = temperature;
    if (topP !== undefined) payload.inferenceConfig.topP = topP;
  }

  // Tag payload so the executor can route the upstream model id correctly.
  Object.defineProperty(payload, "_kiroUpstreamModel", {
    value: upstreamModel,
    enumerable: false
  });

  // Kiro tool specs get sanitized names (`mcp.a.b` → `mcp_a_b`); keep the reverse
  // map so tool calls come back under the client's own names.
  const restoredToolNames = new Map();
  for (const [original, sanitized] of nameMap) {
    if (original !== sanitized) restoredToolNames.set(sanitized, original);
  }
  if (restoredToolNames.size) payload._toolNameMap = restoredToolNames;

  return payload;
}

register(FORMATS.OPENAI, FORMATS.KIRO, openaiToKiroRequest, null);
