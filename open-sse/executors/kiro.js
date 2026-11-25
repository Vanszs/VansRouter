import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../config/providers.js";
import { randomUUID } from "node:crypto";
import { refreshKiroToken } from "../services/tokenRefresh.js";
import { SSE_HEADERS } from "../utils/sseConstants.js";
import { STREAM_FIRST_CHUNK_TIMEOUT_MS } from "../config/runtimeConfig.js";
import { transformEventStreamToSSE } from "./kiroEventStream.js";
import { assertValidKiroRegion } from "../config/awsRegion.js";

const KIRO_REPAIR_BUFFER_MAX_BYTES = 8 * 1024 * 1024;
// Regions per service host; a region outside the set is never spliced into the hostname.
const KIRO_SERVICE_REGIONS = {
  q: new Set(["us-east-1", "eu-central-1"]),
};
const KIRO_REPAIR_HEARTBEAT_MS = 10_000;
const KIRO_SHORT_FINAL_MAX_CHARS = 800;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

const REPAIR_INSTRUCTIONS = Object.freeze({
  tool: "Retry the previous response because its Kiro tool_call wrapper was malformed. If you use the wrapper tool named tool_call, its input must contain a non-empty name and an arguments field.",
  ellipsis: "Retry the previous response because it ended with only an ellipsis. Return the complete final answer, not only ... or ….",
  short_final: "Retry the previous response because its final only announced a future action. Complete the check now and return the result or a concrete blocker."
});
const SHORT_FUTURE_ACTION = /^(?:(?:(?:現在|接著|接下來|下一步)[，,:：\s]*(?:我(?:只)?(?:會|要|將|再)?\s*)?|我只再)(?:補|查|確認|驗證|追(?:查|蹤)?|繼續|檢查|測試)|我(?:會|要|將)(?:再|重新)?(?:補(?:齊|查)?|抓取|查(?:詢)?|確認|驗證|追(?:查|蹤)?|繼續|檢查|測試)|(?:(?:next|now|then)\b[\s,:-]*)?(?:i(?:'ll| will| am going to| need to)|let me)\s+(?:verify|check|confirm|validate|investigate|trace|continue|follow up|test)\b)/iu;
// Keep this tied to the observed whole-response signature. Broader Chinese
// result/progress heuristics create false positives for completed findings.
const OBSERVED_TRAILING_FUTURE_ACTION = /^目前證據顯示[\s\S]{1,700}[。.!?；;]\s*最後補查\s+504\s+access\s+log[，,]\s*確認\s+host[／/]路徑與是否為集中流量[。.!]?$/iu;
const ENGLISH_FUTURE_ACTION = /^(?:(?:next|now|then)\b[\s,:-]*)?(?:i(?:'ll| will| am going to| need to)|let me)\s+(?:verify|check|confirm|validate|investigate|trace|continue|follow up|test)\b/iu;
const ENGLISH_RESULT_CLAUSE = /(?:[:;\n]|[.!?]\s+\S|\b(?:status|checksum|response|deployment)\s+(?:is|are|was|were|matches?|equals?|returned)\b)/iu;
const CHINESE_FUTURE_ACTION = /^(?:(?:現在|接著|接下來|下一步)[，,:：\s]*(?:我(?:只)?(?:會|要|將|再)?\s*)?|我只再|我(?:會|要|將)(?:再|重新)?)(?:補|抓取|查|確認|驗證|追|繼續|檢查|測試)/u;
const CHINESE_RESULT_CLAUSE = /(?:[。！？]\s*\S|(?:版本|狀態|回應|結果|部署|校驗碼)(?:是|為|等於|顯示))/u;
const USER_WAIT = /(?:請(?:你|先)|你(?:先|需要|可以|提供|確認|批准|允許)|等待(?:你|使用者)|等你|核准|同意|授權|\b(?:after|when|once)\s+you\b|\byour\s+(?:approval|confirmation|permission|input)\b|\bwait(?:ing)?\s+for\s+you\b|\bplease\s+(?:approve|confirm|provide|send)\b)/iu;
const COMPLETED_FINAL = /(?:已(?:經)?完成|完成(?:了|驗證|確認)|修復完成|確認無誤|驗證(?:完成|通過)|測試(?:均)?通過|結論|總結|\b(?:done|completed|fixed|verified|confirmed|passed|in conclusion|summary)\b|\b(?:is|are) complete\b)/iu;
const RESULT_EVIDENCE = /(?:顯示|發現|因此|成功|失敗|正常|無錯誤|沒有錯誤|\b(?:found|shows?|showed|because|therefore|succeeded|failed|healthy|green|no errors?)\b)/iu;

function envPositiveInt(name, fallback) {
  const parsed = Number.parseInt(process.env?.[name] || "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function concatChunks(chunks, totalBytes) {
  const output = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

function makeAbortError(reason) {
  const error = new Error(reason?.message || reason || "Request aborted");
  error.name = "AbortError";
  return error;
}

async function readWithTimeout(reader, signal, timeoutMs, message) {
  if (signal?.aborted) throw makeAbortError(signal.reason);
  let timeout;
  let abortHandler;
  const timeoutPromise = new Promise((_, reject) => {
    timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  const abortPromise = new Promise((_, reject) => {
    abortHandler = () => reject(makeAbortError(signal.reason));
    signal?.addEventListener("abort", abortHandler, { once: true });
  });
  try {
    return await Promise.race([reader.read(), timeoutPromise, abortPromise]);
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener?.("abort", abortHandler);
  }
}

async function readResponsePrefix(response, signal, maxBytes, timeoutMs) {
  const reader = response?.body?.getReader?.();
  if (!reader) return "";
  const chunks = [];
  let totalBytes = 0;
  try {
    while (totalBytes < maxBytes) {
      const { done, value } = await readWithTimeout(
        reader,
        signal,
        timeoutMs,
        "Kiro retry error body stalled"
      );
      if (done) break;
      const remaining = maxBytes - totalBytes;
      const chunk = value.byteLength > remaining ? value.slice(0, remaining) : value;
      chunks.push(chunk);
      totalBytes += chunk.byteLength;
      if (value.byteLength > remaining) break;
    }
  } finally {
    await reader.cancel("bounded Kiro retry error body").catch(() => {});
  }
  return decoder.decode(concatChunks(chunks, totalBytes));
}

function appendRepairInstruction(body, kind) {
  const repaired = structuredClone(body || {});
  const instruction = REPAIR_INSTRUCTIONS[kind] || "Retry the previous incomplete Kiro response.";
  delete repaired.systemPrompt;
  const message = repaired.conversationState?.currentMessage?.userInputMessage || {};
  message.content = [message.content, instruction].filter(Boolean).join("\n\n");
  repaired.conversationState = {
    ...(repaired.conversationState || {}),
    currentMessage: {
      ...(repaired.conversationState?.currentMessage || {}),
      userInputMessage: message,
    },
  };
  return repaired;
}

function isEllipsisOnly(value) {
  return ["...", "…"].includes(String(value || "").trim());
}

function isShortFutureAction(value) {
  const text = String(value || "").trim().replaceAll("’", "'");
  if (OBSERVED_TRAILING_FUTURE_ACTION.test(text)) return true;
  if (ENGLISH_FUTURE_ACTION.test(text) && ENGLISH_RESULT_CLAUSE.test(text)) return false;
  if (CHINESE_FUTURE_ACTION.test(text) && CHINESE_RESULT_CLAUSE.test(text)) return false;
  return text.length > 0 && text.length <= KIRO_SHORT_FINAL_MAX_CHARS &&
    SHORT_FUTURE_ACTION.test(text) && !USER_WAIT.test(text) &&
    !COMPLETED_FINAL.test(text) && !RESULT_EVIDENCE.test(text);
}

function encodeSSEError(code, message, details) {
  return encoder.encode(`data: ${JSON.stringify({ error: {
    message,
    type: "upstream_error",
    code,
    ...(details ? { details } : {})
  } })}\n\ndata: [DONE]\n\n`);
}

function inspectSSEChunk(chunk, state) {
  for (const line of decoder.decode(chunk).split("\n")) {
    if (!line.startsWith("data: ")) continue;
    const data = line.slice(6).trim();
    if (!data || data === "[DONE]") continue;
    try {
      const event = JSON.parse(data);
      if (event.error) state.error = event.error;
      for (const choice of event.choices || []) {
        const delta = choice.delta || {};
        if (typeof delta.content === "string") state.content += delta.content;
        if (typeof delta.reasoning_content === "string") state.reasoning += delta.reasoning_content;
        if (delta.tool_calls?.length) state.hasToolCalls = true;
      }
    } catch { /* a malformed SSE line is diagnosed by the transformer */ }
  }
}

/**
 * KiroExecutor - Executor for Kiro AI (AWS CodeWhisperer)
 * Uses AWS CodeWhisperer streaming API with AWS EventStream binary format
 */
export class KiroExecutor extends BaseExecutor {
  constructor() {
    super("kiro", PROVIDERS.kiro);
  }

  buildHeaders(credentials, stream = true) {
    const headers = {
      ...this.config.headers,
      "Amz-Sdk-Request": "attempt=1; max=3",
      "Amz-Sdk-Invocation-Id": randomUUID()
    };

    // API-key auth: the key is stored as accessToken and sent as a bearer token
    // exactly like an OAuth access token, but with an extra `tokentype: API_KEY`
    // header so CodeWhisperer treats it as a long-lived API key rather than an
    // OIDC/social access token. Mirrors the Kiro IDE headless-auth behavior.
    // Enterprise / Microsoft Entra (external_idp) tokens are OAuth access tokens,
    // but CodeWhisperer requires TokenType=EXTERNAL_IDP to bind them to profiles.
    const authMethod = credentials?.providerSpecificData?.authMethod;
    const isApiKey = authMethod === "api_key";
    const isExternalIdp = authMethod === "external_idp";

    const apiKey = credentials?.apiKey || (isApiKey ? credentials?.accessToken : null);
    if (isApiKey && apiKey) {
      headers["Authorization"] = `Bearer ${apiKey}`;
      headers["tokentype"] = "API_KEY";
    } else if (credentials.accessToken) {
      headers["Authorization"] = `Bearer ${credentials.accessToken}`;
      if (isExternalIdp) {
        headers["TokenType"] = "EXTERNAL_IDP";
      }
    }

    return headers;
  }

  /**
   * Region- and auth-aware endpoint ordering.
   *
   * Region first: the registry baseUrls are hardcoded us-east-1. An IAM Identity
   * Center account homed elsewhere (e.g. eu-central-1) only resolves through the
   * regional Amazon Q host, so it gets that single endpoint. Rewriting the host
   * per-region is not an option — `codewhisperer.<region>.amazonaws.com` does not
   * exist outside us-east-1. us-east-1 (and an unset region) keeps the registry
   * list untouched, so existing accounts are unaffected.
   *
   * API-key Kiro connections store a raw CodeWhisperer credential (validated
   * against codewhisperer.us-east-1.amazonaws.com via ListAvailableProfiles).
   * The Kiro IDE gateway (runtime.*.kiro.dev) expects Kiro OIDC/social tokens
   * and rejects an `tokentype: API_KEY` token with 401/403 — which
   * BaseExecutor.execute() returns immediately (only 429 / network errors fall
   * through to the next host). So for api-key auth we must try the *.amazonaws.com
   * CodeWhisperer hosts FIRST, mirroring the Kiro-Go reference fork which never
   * routes api-key traffic through kiro.dev. External IdP enterprise tokens also
   * use the CodeWhisperer surface, with the `TokenType: EXTERNAL_IDP` header.
   * IAM Identity Center (idc) tokens are AWS SSO access tokens from the same
   * family; the kiro.dev gateway rejects them with 403 "bearer token invalid".
   * Other OAuth methods keep the default order (kiro.dev first) since their
   * tokens are what that gateway accepts.
   */
  getOrderedBaseUrls(credentials) {
    const region = (credentials?.providerSpecificData?.region || "us-east-1").trim() || "us-east-1";
    assertValidKiroRegion(region);
    // A region outside the service's DNS coverage must not be spliced into the
    // hostname: q only serves us-east-1/eu-central-1, codewhisperer us-east-1.
    const baseUrls = this.getBaseUrls();
    if (region !== "us-east-1" && KIRO_SERVICE_REGIONS.q.has(region)) {
      return [`https://q.${region}.amazonaws.com/generateAssistantResponse`];
    }
    const authMethod = credentials?.providerSpecificData?.authMethod;
    const isCodeWhispererSurface =
      authMethod === "api_key" || authMethod === "external_idp" || authMethod === "idc";
    if (!isCodeWhispererSurface) return baseUrls;
    const amazon = baseUrls.filter((u) => u.includes("amazonaws.com"));
    const others = baseUrls.filter((u) => !u.includes("amazonaws.com"));
    return amazon.length > 0 ? [...amazon, ...others] : baseUrls;
  }

  getFallbackCount(credentials = null) {
    return this.getOrderedBaseUrls(credentials).length || 1;
  }

  buildUrl(model, stream, urlIndex = 0, credentials = null) {
    const baseUrls = this.getOrderedBaseUrls(credentials);
    return baseUrls[urlIndex] || baseUrls[0] || this.config.baseUrl;
  }

  transformRequest(model, body, stream, credentials) {
    return body;
  }

  /**
   * Kiro execute — delegate to BaseExecutor for endpoint fallback + retry, then
   * transform the binary AWS EventStream into OpenAI-shaped SSE on success.
   *
   * BaseExecutor.execute() walks config.baseUrls (runtime.us-east-1.kiro.dev →
   * codewhisperer → q) advancing to the next host on 429 (shouldRetry) and on
   * network/5xx errors, while tryRetry handles in-place retries per `retry: {429: 2}`.
   * Note: api-key connections reorder these so the *.amazonaws.com hosts come
   * first — see getOrderedBaseUrls/buildUrl above.
   * Note: the baseUrls are alternate surfaces of one regional service, so rotation
   * is edge-level failover — it does not grant fresh 429 quota. Per-account 429
   * spreading is handled upstream by account rotation in sse/handlers/chat.js.
   *
   * Errors are returned untransformed so the upstream handler can read the body,
   * classify the status, and trigger account fallback/cooldown.
   */
  async execute(args) {
    const result = await super.execute(args);
    if (result?.response?.ok) {
      // KIRO_INTEGRITY_GATE=off streams through, forfeiting the tool-call repair retry.
      if (process.env.KIRO_INTEGRITY_GATE === "off") {
        result.response = this.transformEventStreamToSSE(result.response, args.model, {
          toolSpecs: args.body?.conversationState?.currentMessage?.userInputMessage?.userInputMessageContext?.tools || []
        });
      } else {
        this.attachIntegrityGate(result, args);
      }
    }
    return result;
  }

  attachIntegrityGate(result, args) {
    const abortController = new AbortController();
    const maxBytes = envPositiveInt("KIRO_TOOL_CALL_REPAIR_BUFFER_MAX_BYTES", KIRO_REPAIR_BUFFER_MAX_BYTES);
    const legacyTimeout = envPositiveInt("KIRO_TOOL_CALL_REPAIR_TIMEOUT_MS", STREAM_FIRST_CHUNK_TIMEOUT_MS);
    const ttftTimeoutMs = envPositiveInt("KIRO_TOOL_CALL_REPAIR_TTFT_TIMEOUT_MS", legacyTimeout);
    const stallTimeoutMs = envPositiveInt("KIRO_TOOL_CALL_REPAIR_STALL_TIMEOUT_MS", legacyTimeout);
    const repairEnabled = args.credentials?.providerSpecificData?.kiroToolCallRepair !== false &&
      process.env.KIRO_TOOL_CALL_REPAIR !== "false";
    const forwardAbort = () => abortController.abort(args.signal?.reason);
    args.signal?.addEventListener("abort", forwardAbort, { once: true });
    let open = true;
    let heartbeatTimer;

    const stream = new ReadableStream({
      start: async (controller) => {
        const heartbeat = () => {
          if (!open) return;
          try {
            controller.enqueue(encoder.encode(": kiro-validation\n\n"));
          } catch {
            open = false;
          }
        };
        heartbeat();
        heartbeatTimer = setInterval(heartbeat, KIRO_REPAIR_HEARTBEAT_MS);

        try {
          const bytes = await this.runIntegrityRecovery(result.response, args, {
            signal: abortController.signal,
            maxBytes,
            ttftTimeoutMs,
            stallTimeoutMs,
            repairEnabled
          });
          if (abortController.signal.aborted) throw makeAbortError(abortController.signal.reason);
          controller.enqueue(bytes);
          controller.close();
        } catch (error) {
          if (open && error.name === "AbortError") {
            controller.error(error);
          } else if (open && error.name !== "AbortError") {
            controller.enqueue(encodeSSEError(
              "kiro_integrity_gate_failed",
              error.message || "Kiro integrity validation failed"
            ));
            controller.close();
          }
        } finally {
          open = false;
          clearInterval(heartbeatTimer);
          args.signal?.removeEventListener?.("abort", forwardAbort);
        }
      },
      cancel(reason) {
        open = false;
        clearInterval(heartbeatTimer);
        abortController.abort(reason || "client cancelled");
      }
    });

    result.response = new Response(stream, {
      status: result.response.status,
      statusText: result.response.statusText,
      headers: { ...SSE_HEADERS }
    });
  }

  async runIntegrityRecovery(rawResponse, args, options) {
    const first = await this.readRecoverableIntegrityAttempt(
      rawResponse,
      args.model,
      options,
      "initial"
    );
    if (first.kind === "complete") return first.bytes;
    if (first.kind === "terminal_stop" || first.kind === "upstream_error") {
      return this.integrityFailureSSE(first);
    }
    if (first.kind === "invalid_tool" && !options.repairEnabled) {
      return encodeSSEError("invalid_kiro_tool_call", first.message, first.diagnostics);
    }

    const repairKind = ["ellipsis", "short_final", "invalid_tool"].includes(first.kind)
      ? first.kind
      : null;
    const repairBody = repairKind
      ? appendRepairInstruction(args.body, repairKind === "invalid_tool" ? "tool" : repairKind)
      : structuredClone(args.body || {});

    const retry = await BaseExecutor.prototype.execute.call(this, {
      ...args,
      body: repairBody,
      signal: options.signal
    });
    if (!retry?.response?.ok) {
      let body = "";
      try {
        body = await readResponsePrefix(
          retry?.response,
          options.signal,
          Math.min(options.maxBytes, 4096),
          options.stallTimeoutMs
        );
      } catch (error) {
        if (error.name === "AbortError") throw error;
      }
      return encodeSSEError(
        "kiro_integrity_retry_upstream_error",
        body || `Kiro integrity retry failed with HTTP ${retry?.response?.status || 502}`,
        { status: retry?.response?.status || 502 }
      );
    }

    const second = await this.readRecoverableIntegrityAttempt(
      retry.response,
      args.model,
      options,
      "retry"
    );
    if (second.kind === "complete") return second.bytes;
    if (second.kind === "terminal_stop" || second.kind === "upstream_error") {
      return this.integrityFailureSSE(second);
    }
    const code = second.kind === "ellipsis"
      ? "kiro_ellipsis_retry_failed"
      : second.kind === "short_final"
        ? "kiro_short_final_retry_failed"
        : second.kind === "invalid_tool"
          ? "kiro_tool_call_repair_retry_failed"
          : "kiro_missing_terminal_retry_failed";
    return encodeSSEError(
      code,
      `Kiro integrity validation failed after one bounded retry: ${second.message || second.kind}`,
      { attempts: [first.diagnostics, second.diagnostics].filter(Boolean) }
    );
  }

  integrityFailureSSE(attempt) {
    const disposition = attempt.diagnostics?.stop_disposition;
    const code = attempt.diagnostics?.terminal_provenance === "integrity_buffer_exceeded"
      ? "kiro_integrity_buffer_exceeded"
      : attempt.kind === "upstream_error"
      ? "kiro_upstream_eventstream_error"
      : disposition === "terminal_refusal"
        ? "kiro_terminal_refusal"
        : disposition === "terminal_incomplete"
          ? "kiro_terminal_incomplete"
          : "kiro_unknown_stop_reason";
    return encodeSSEError(code, attempt.message || "Kiro stream ended with a terminal failure", attempt.diagnostics);
  }

  async readRecoverableIntegrityAttempt(rawResponse, model, options, attempt) {
    try {
      return await this.readIntegrityAttempt(rawResponse, model, options, attempt);
    } catch (error) {
      if (error.name === "AbortError") throw error;
      return {
        kind: "missing_terminal",
        message: error.message || "Kiro transport read failed",
        diagnostics: {
          attempt,
          terminal_provenance: "transport_read_error",
          transport_state: "upstream_error",
          stop_reason: null,
          stop_disposition: "terminal_incomplete",
          response_state: "no_semantic_output",
          event_counts: {},
          incomplete_frame_bytes: 0
        }
      };
    }
  }

  async readIntegrityAttempt(rawResponse, model, options, attempt) {
    let diagnostics;
    const transformed = this.transformEventStreamToSSE(rawResponse, model, {
      maxToolBytes: Math.max(1, Math.floor(options.maxBytes / 2)),
      onTerminalState: (value) => {
        diagnostics = value;
      }
    });
    const reader = transformed.body.getReader();
    const chunks = [];
    let totalBytes = 0;
    let sawChunk = false;
    const output = { content: "", reasoning: "", hasToolCalls: false, error: null };

    try {
      while (true) {
        const timeoutMs = sawChunk ? options.stallTimeoutMs : options.ttftTimeoutMs;
        const phase = sawChunk ? "stalled" : "timed out before first chunk";
        const { done, value } = await readWithTimeout(
          reader,
          options.signal,
          timeoutMs,
          `Kiro integrity validation ${phase}`
        );
        if (done) break;
        sawChunk = true;
        totalBytes += value.byteLength;
        if (totalBytes > options.maxBytes) {
          await reader.cancel("kiro_integrity_buffer_exceeded").catch(() => {});
          return {
            kind: "terminal_stop",
            message: `Kiro integrity buffer exceeded ${options.maxBytes} bytes`,
            diagnostics: { terminal_provenance: "integrity_buffer_exceeded" }
          };
        }
        chunks.push(value);
        inspectSSEChunk(value, output);
      }
    } catch (error) {
      await reader.cancel(error.message).catch(() => {});
      throw error;
    }

    const safeDiagnostics = {
      attempt,
      terminal_provenance: diagnostics?.terminal_provenance || "missing_terminal_diagnostics",
      transport_state: diagnostics?.transport_state || "unknown",
      stop_reason: diagnostics?.stop_reason || null,
      stop_disposition: diagnostics?.stop_disposition || "terminal_incomplete",
      response_state: diagnostics?.response_state || "no_semantic_output",
      event_counts: diagnostics?.event_counts || {},
      incomplete_frame_bytes: diagnostics?.incomplete_frame_bytes || 0
    };
    if (safeDiagnostics.stop_disposition === "retryable_protocol_failure") {
      const kind = safeDiagnostics.terminal_provenance === "invalid_tool_call"
        ? "invalid_tool"
        : "retryable_stop";
      return { kind, message: output.error?.message, diagnostics: safeDiagnostics };
    }
    if (safeDiagnostics.stop_disposition === "terminal_incomplete" ||
        safeDiagnostics.stop_disposition === "terminal_refusal" ||
        safeDiagnostics.stop_disposition === "unknown_failure") {
      const kind = safeDiagnostics.terminal_provenance === "upstream_eventstream_error"
        ? "upstream_error"
        : safeDiagnostics.terminal_provenance === "integrity_buffer_exceeded"
          ? "terminal_stop"
        : ["metadata_stop_reason", "message_stop_event"].includes(safeDiagnostics.terminal_provenance)
          ? "terminal_stop"
          : "missing_terminal";
      return { kind, message: output.error?.message, diagnostics: safeDiagnostics };
    }
    if (output.error) {
      return { kind: "missing_terminal", message: output.error.message, diagnostics: safeDiagnostics };
    }
    if (!output.hasToolCalls) {
      if (isEllipsisOnly(output.content) ||
          (!output.content.trim() && isEllipsisOnly(output.reasoning))) {
        return { kind: "ellipsis", diagnostics: safeDiagnostics };
      }
      if (isShortFutureAction(output.content)) {
        return { kind: "short_final", diagnostics: safeDiagnostics };
      }
    }
    return { kind: "complete", bytes: concatChunks(chunks, totalBytes), diagnostics: safeDiagnostics };
  }

  transformEventStreamToSSE(response, model, options = {}) {
    return transformEventStreamToSSE(response, model, options);
  }

  async refreshCredentials(credentials, log, proxyOptions = null) {
    if (!credentials.refreshToken) return null;

    try {
      // Use centralized refreshKiroToken function (handles both AWS SSO OIDC and Social Auth)
      const result = await refreshKiroToken(
        credentials.refreshToken,
        credentials.providerSpecificData,
        log,
        proxyOptions
      );

      return result;
    } catch (error) {
      log?.error?.("TOKEN", `Kiro refresh error: ${error.message}`);
      return null;
    }
  }
}


export default KiroExecutor;
