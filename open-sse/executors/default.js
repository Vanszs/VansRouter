import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../config/providers.js";
import { OAUTH_ENDPOINTS, buildKimiHeaders } from "../config/appConstants.js";
import { buildClineHeaders } from "../../src/shared/utils/clineAuth.js";
import { getCachedClaudeHeaders } from "../utils/claudeHeaderCache.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";
import { injectReasoningContent } from "../utils/reasoningContentInjector.js";
import { getModelAgenticConfig } from "../config/providerModels.js";

export class DefaultExecutor extends BaseExecutor {
  constructor(provider) {
    super(provider, PROVIDERS[provider] || PROVIDERS.openai);
  }

  transformRequest(model, body) {
    const transformed = this.applyJsonSchemaFallback(body);

    if (transformed && typeof transformed === "object") {
      if (this.provider === "cerebras" || this.provider === "mistral") {
        delete transformed.client_metadata;
      }
    }

    // Don't strip tools/tool_choice for nvidia provider so Kimi 2.6 can still attempt to tool call,
    // and we will parse its XML/special tokens on response.
    return injectReasoningContent({ provider: this.provider, model, body: transformed });
  }

  // Fallback json_schema → json_object for openai-compatible providers without native Structured Output.
  applyJsonSchemaFallback(body) {
    if (!this.provider?.startsWith?.("openai-compatible-")) return body;
    const rf = body?.response_format;
    if (rf?.type !== "json_schema" || !rf.json_schema?.schema) return body;

    const schemaJson = JSON.stringify(rf.json_schema.schema, null, 2);
    const prompt = `You must respond with valid JSON that strictly follows this JSON schema:\n\`\`\`json\n${schemaJson}\n\`\`\`\nRespond ONLY with the JSON object, no other text.`;

    const messages = Array.isArray(body.messages) ? body.messages.map(m => ({ ...m })) : [];
    const sys = messages.find(m => m.role === "system");
    if (sys) {
      if (typeof sys.content === "string") sys.content = `${sys.content}\n\n${prompt}`;
      else if (Array.isArray(sys.content)) sys.content.push({ type: "text", text: `\n\n${prompt}` });
    } else {
      messages.unshift({ role: "system", content: prompt });
    }
    return { ...body, messages, response_format: { type: "json_object" } };
  }

  buildUrl(model, stream, urlIndex = 0, credentials = null) {
    if (this.provider?.startsWith?.("openai-compatible-")) {
      const baseUrl = credentials?.providerSpecificData?.baseUrl || "https://api.openai.com/v1";
      const normalized = baseUrl.replace(/\/$/, "");
      const path = this.provider.includes("responses") ? "/responses" : "/chat/completions";
      return `${normalized}${path}`;
    }
    if (this.provider?.startsWith?.("anthropic-compatible-")) {
      const baseUrl = credentials?.providerSpecificData?.baseUrl || "https://api.anthropic.com/v1";
      const normalized = baseUrl.replace(/\/$/, "");
      return `${normalized}/messages`;
    }
    switch (this.provider) {
      case "claude":
      case "glm":
      case "kimi":
      case "minimax":
      case "minimax-cn":
        return `${this.config.baseUrl}?beta=true`;
      case "kimi-coding":
        return `${this.config.baseUrl}?beta=true`;
      case "gemini":
        return `${this.config.baseUrl}/${model}:${stream ? "streamGenerateContent?alt=sse" : "generateContent"}`;
      default: {
        const url = this.config.baseUrl;
        if (url?.includes("{accountId}")) {
          const accountId = credentials?.providerSpecificData?.accountId;
          if (!accountId) throw new Error(`${this.provider} requires accountId in providerSpecificData`);
          return url.replace("{accountId}", accountId);
        }
        return url;
      }
    }
  }

  buildHeaders(credentials, stream = true) {
    const headers = { "Content-Type": "application/json", ...this.config.headers };

    switch (this.provider) {
      case "gemini":
        credentials.apiKey ? headers["x-goog-api-key"] = credentials.apiKey : headers["Authorization"] = `Bearer ${credentials.accessToken}`;
        break;
      case "claude": {
        // Overlay live cached headers from real Claude Code client over static defaults.
        // Static headers (Title-Case) remain as cold-start fallback.
        const cached = getCachedClaudeHeaders();
        if (cached) {
          // Remove Title-Case static keys that conflict with incoming lowercase cached keys
          for (const lcKey of Object.keys(cached)) {
            // Build the Title-Case equivalent: "anthropic-version" → "Anthropic-Version"
            const titleKey = lcKey.replace(/(^|-)([a-z])/g, (_, sep, c) => sep + c.toUpperCase());

            // Special handling for Anthropic-Beta to preserve required flags like OAuth
            if (lcKey === "anthropic-beta") {
              const staticBetaStr = headers[titleKey] || headers[lcKey] || "";
              const staticFlags = new Set(staticBetaStr.split(",").flatMap(f => { const t = f.trim(); return t ? [t] : []; }));
              const cachedFlags = new Set(cached[lcKey].split(",").flatMap(f => { const t = f.trim(); return t ? [t] : []; }));

              // Merge all static flags (which contain oauth, thinking, etc) into the cached ones
              for (const flag of staticFlags) {
                cachedFlags.add(flag);
              }

              cached[lcKey] = Array.from(cachedFlags).join(",");
            }

            if (titleKey !== lcKey && headers[titleKey] !== undefined) {
              delete headers[titleKey];
            }
          }
          Object.assign(headers, cached);
        }
        credentials.apiKey
          ? (headers["x-api-key"] = credentials.apiKey)
          : (headers["Authorization"] = `Bearer ${credentials.accessToken}`);
        break;
      }
      case "glm":
      case "kimi":
      case "minimax":
      case "minimax-cn":
      case "kimi-coding":
        headers["x-api-key"] = credentials.apiKey || credentials.accessToken;
        if (this.provider === "kimi-coding") Object.assign(headers, buildKimiHeaders());
        break;
      default:
        if (this.provider?.startsWith?.("anthropic-compatible-")) {
          if (credentials.apiKey) {
            headers["x-api-key"] = credentials.apiKey;
          } else if (credentials.accessToken) {
            headers["Authorization"] = `Bearer ${credentials.accessToken}`;
          }
          if (!headers["anthropic-version"]) {
            headers["anthropic-version"] = "2023-06-01";
          }
        } else if (this.provider === "gitlab") {
          // GitLab Duo uses Bearer token (PAT with ai_features scope, or OAuth access token)
          headers["Authorization"] = `Bearer ${credentials.apiKey || credentials.accessToken}`;
        } else if (this.provider === "codebuddy") {
          headers["Authorization"] = `Bearer ${credentials.apiKey || credentials.accessToken}`;
        } else if (this.provider === "kilocode") {
          headers["Authorization"] = `Bearer ${credentials.apiKey || credentials.accessToken}`;
          if (credentials.providerSpecificData?.orgId) {
            headers["X-Kilocode-OrganizationID"] = credentials.providerSpecificData.orgId;
          }
        } else if (this.provider === "cline") {
          Object.assign(headers, buildClineHeaders(credentials.apiKey || credentials.accessToken));
        } else if (this.config?.format === "claude") {
          // Generic claude-format provider (e.g. agentrouter): x-api-key + anthropic-version
          headers["x-api-key"] = credentials.apiKey || credentials.accessToken;
          if (!headers["anthropic-version"]) headers["anthropic-version"] = "2023-06-01";
        } else {
          headers["Authorization"] = `Bearer ${credentials.apiKey || credentials.accessToken}`;
        }
    }

    // Strip first-party Claude Code identity headers for non-Anthropic anthropic-compatible upstreams
    if (this.provider?.startsWith?.("anthropic-compatible-")) {
      const baseUrl = credentials?.providerSpecificData?.baseUrl || "";
      const isOfficialAnthropic = baseUrl === "" || baseUrl.includes("api.anthropic.com");
      if (!isOfficialAnthropic) {
        // Some third-party Anthropic-compatible gateways require Bearer auth in
        // addition to x-api-key. Send both (x-api-key already set above) so
        // gateways that read either header succeed.
        if (credentials.apiKey && !headers["Authorization"]) {
          headers["Authorization"] = `Bearer ${credentials.apiKey}`;
        }
        delete headers["anthropic-dangerous-direct-browser-access"];
        delete headers["Anthropic-Dangerous-Direct-Browser-Access"];
        delete headers["x-app"];
        delete headers["X-App"];
        // Strip claude-code-20250219 from Anthropic-Beta / anthropic-beta
        for (const betaKey of ["anthropic-beta", "Anthropic-Beta"]) {
          if (headers[betaKey]) {
            const filtered = headers[betaKey]
              .split(",")
              .map(s => s.trim())
              .filter(f => f && f !== "claude-code-20250219")
              .join(",");
            if (filtered) {
              headers[betaKey] = filtered;
            } else {
              delete headers[betaKey];
            }
          }
        }
      }
    }

    if (stream) headers["Accept"] = "text/event-stream";
    return headers;
  }

  async refreshCredentials(credentials, log, proxyOptions = null) {
    if (!credentials.refreshToken) return null;

    const refreshers = {
      claude: () => this.refreshWithJSON(OAUTH_ENDPOINTS.anthropic.token, { grant_type: "refresh_token", refresh_token: credentials.refreshToken, client_id: PROVIDERS.claude.clientId }, proxyOptions),
      codex: () => this.refreshWithForm(OAUTH_ENDPOINTS.openai.token, { grant_type: "refresh_token", refresh_token: credentials.refreshToken, client_id: PROVIDERS.codex.clientId, scope: "openid profile email offline_access" }, proxyOptions),
      qwen: () => this.refreshWithForm(OAUTH_ENDPOINTS.qwen.token, { grant_type: "refresh_token", refresh_token: credentials.refreshToken, client_id: PROVIDERS.qwen.clientId }, proxyOptions),
      iflow: () => this.refreshIflow(credentials.refreshToken, proxyOptions),
      gemini: () => this.refreshGoogle(credentials.refreshToken, proxyOptions),
      kiro: () => this.refreshKiro(credentials.refreshToken, proxyOptions),
      cline: () => this.refreshCline(credentials.refreshToken, proxyOptions),
      "kimi-coding": () => this.refreshKimiCoding(credentials.refreshToken, proxyOptions),
      kilocode: () => this.refreshKilocode(credentials.refreshToken, proxyOptions)
    };

    const refresher = refreshers[this.provider];
    if (!refresher) return null;

    try {
      const result = await refresher();
      if (result) log?.info?.("TOKEN", `${this.provider} refreshed`);
      return result;
    } catch (error) {
      log?.error?.("TOKEN", `${this.provider} refresh error: ${error.message}`);
      return null;
    }
  }

  async refreshWithJSON(url, body, proxyOptions = null) {
    const response = await proxyAwareFetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify(body)
    }, proxyOptions);
    if (!response.ok) return null;
    const tokens = await response.json();
    return { accessToken: tokens.access_token, refreshToken: tokens.refresh_token || body.refresh_token, expiresIn: tokens.expires_in };
  }

  async refreshWithForm(url, params, proxyOptions = null) {
    const response = await proxyAwareFetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "Accept": "application/json" },
      body: new URLSearchParams(params)
    }, proxyOptions);
    if (!response.ok) return null;
    const tokens = await response.json();
    return { accessToken: tokens.access_token, refreshToken: tokens.refresh_token || params.refresh_token, expiresIn: tokens.expires_in };
  }

  async refreshIflow(refreshToken, proxyOptions = null) {
    const basicAuth = btoa(`${PROVIDERS.iflow.clientId}:${PROVIDERS.iflow.clientSecret}`);
    const response = await proxyAwareFetch(OAUTH_ENDPOINTS.iflow.token, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "Accept": "application/json", "Authorization": `Basic ${basicAuth}` },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken, client_id: PROVIDERS.iflow.clientId, client_secret: PROVIDERS.iflow.clientSecret })
    }, proxyOptions);
    if (!response.ok) return null;
    const tokens = await response.json();
    return { accessToken: tokens.access_token, refreshToken: tokens.refresh_token || refreshToken, expiresIn: tokens.expires_in };
  }

  async refreshGoogle(refreshToken, proxyOptions = null) {
    const response = await proxyAwareFetch(OAUTH_ENDPOINTS.google.token, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "Accept": "application/json" },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken, client_id: this.config.clientId, client_secret: this.config.clientSecret })
    }, proxyOptions);
    if (!response.ok) return null;
    const tokens = await response.json();
    return { accessToken: tokens.access_token, refreshToken: tokens.refresh_token || refreshToken, expiresIn: tokens.expires_in };
  }

  async refreshKiro(refreshToken, proxyOptions = null) {
    const response = await proxyAwareFetch(PROVIDERS.kiro.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json", "User-Agent": "kiro-cli/1.0.0" },
      body: JSON.stringify({ refreshToken })
    }, proxyOptions);
    if (!response.ok) return null;
    const tokens = await response.json();
    return { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken || refreshToken, expiresIn: tokens.expiresIn };
  }

  async refreshCline(refreshToken, proxyOptions = null) {
    console.log('[DEBUG] Refreshing Cline token, refreshToken length:', refreshToken?.length);
    const response = await proxyAwareFetch("https://api.cline.bot/api/v1/auth/refresh", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify({ refreshToken, grantType: "refresh_token", clientType: "extension" })
    }, proxyOptions);
    console.log('[DEBUG] Cline refresh response status:', response.status);
    if (!response.ok) {
      const errorText = await response.text();
      console.log('[DEBUG] Cline refresh error:', errorText);
      return null;
    }
    const payload = await response.json();
    console.log('[DEBUG] Cline refresh payload:', JSON.stringify(payload).substring(0, 200));
    const data = payload?.data || payload;
    const expiresAtIso = data?.expiresAt;
    const expiresIn = expiresAtIso ? Math.max(1, Math.floor((new Date(expiresAtIso).getTime() - Date.now()) / 1000)) : undefined;
    console.log('[DEBUG] Cline refresh success, expiresIn:', expiresIn);
    return { accessToken: data?.accessToken, refreshToken: data?.refreshToken || refreshToken, expiresIn };
  }

  async refreshKimiCoding(refreshToken, proxyOptions = null) {
    const kimiHeaders = buildKimiHeaders();
    const response = await proxyAwareFetch("https://auth.kimi.com/api/oauth/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Accept": "application/json",
        ...kimiHeaders
      },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken, client_id: "17e5f671-d194-4dfb-9706-5516cb48c098" })
    }, proxyOptions);
    if (!response.ok) return null;
    const tokens = await response.json();
    return { accessToken: tokens.access_token, refreshToken: tokens.refresh_token || refreshToken, expiresIn: tokens.expires_in };
  }

  async refreshKilocode(refreshToken, proxyOptions = null) {
    // Kilocode uses device code flow, no refresh token support
    return null;
  }

  async execute({ model, body, stream, credentials, signal, log, proxyOptions = null }) {
    const isKimiModel = typeof model === "string" && model.includes("kimi-k2.6");
    const isClaudeFormat = this.provider === "claude" || this.provider === "kimi" || this.provider === "kimi-coding" || this.provider === "minimax" || this.provider === "minimax-cn" || this.provider === "glm";
    const expectsToolCalls = requestExpectsToolCalls(body);

    // Honor client params (no forced tool_choice, no injected default). The ONLY
    // interference: clamp max_tokens to a safe ceiling — empirically a large max_tokens
    // (≥~32k) makes NVIDIA NIM kimi-k2.6 degenerate/loop. Smaller client values pass through.
    let effectiveBody = body;
    if (isKimiModel && !isClaudeFormat) {
      const { maxTokensCeiling } = getModelAgenticConfig(this.provider, model);
      if (maxTokensCeiling && typeof body.max_tokens === "number" && body.max_tokens > maxTokensCeiling) {
        effectiveBody = { ...body, max_tokens: maxTokensCeiling };
        log?.debug?.("KIMI-NIM", `clamped max_tokens ${body.max_tokens}→${maxTokensCeiling} for ${model}`);
      }
    }

    const result = await super.execute({ model, body: effectiveBody, stream, credentials, signal, log, proxyOptions });

    if (isKimiModel && !isClaudeFormat) {
      const response = result.response;
      if (stream) {
        const transformedStream = transformKimiStream(response.body, { expectsToolCalls });
        result.response = new Response(transformedStream, {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers
        });
      } else {
        const text = await response.text();
        try {
          const parsed = JSON.parse(text);
          const choice = parsed.choices?.[0];
          const stopReason = choice?.stop_reason || choice?.finish_reason || parsed?.stop_reason || "";
          const content = typeof choice?.message?.content === "string" ? choice.message.content : "";

          // If NVIDIA already returned native tool_calls (tool_choice=required path), skip XML parsing.
          const hasNativeToolCalls = Array.isArray(choice?.message?.tool_calls) && choice.message.tool_calls.length > 0;

          if (!hasNativeToolCalls && isKimiToolFailure({ stopReason, content, expectsToolCalls })) {
            throw new Error(`Kimi tool-call failure: ${stopReason || "invalid tool output"}`);
          }

          if (!hasNativeToolCalls && choice?.message?.content) {
            const toolCalls = parseKimiToolCalls(content);
            if (toolCalls.length > 0) {
              choice.message.tool_calls = toolCalls;
              choice.message.content = cleanKimiContent(content) || null;
              choice.finish_reason = "tool_calls";
            }
          }
          result.response = new Response(JSON.stringify(parsed), {
            status: response.status,
            statusText: response.statusText,
            headers: response.headers
          });
        } catch (e) {
          if (e instanceof Error && e.message.startsWith("Kimi tool-call failure:")) {
            throw e;
          }
          result.response = new Response(text, {
            status: response.status,
            statusText: response.statusText,
            headers: response.headers
          });
        }
      }
    }
    return result;
  }
}

function requestExpectsToolCalls(body) {
  return Array.isArray(body?.tools) && body.tools.length > 0 && body?.tool_choice !== "none";
}

function isKimiToolFailure({ stopReason = "", content = "", expectsToolCalls = false }) {
  if (!expectsToolCalls) return false;
  const normalizedStopReason = String(stopReason || "").toLowerCase();
  if (normalizedStopReason === "repetition" || normalizedStopReason === "repetition_detected") {
    return true;
  }

  const toolCalls = parseKimiToolCalls(content);
  if (toolCalls.length > 0) return false;

  const trimmed = cleanKimiContent(String(content || ""));
  if (!trimmed) return false;

  // If the model was explicitly asked to call a tool but returned a long plain-text answer
  // without any structured tool call markers, treat it as an upstream tool-call failure.
  return trimmed.length > 200;
}

// Helpers to parse and sanitize Kimi 2.6 tool calls
function parseKimiToolCalls(content) {
  const toolCalls = [];
  
  if (content.includes("<|tool_calls_section_begin|>")) {
    const escapedRegex = /<\|tool_call_begin\|>\s*(\S+)\s*<\|tool_call_argument_begin\|>\s*([\s\S]*?)\s*<\|tool_call_end\|>/g;
    let match;
    let index = 0;
    while ((match = escapedRegex.exec(content)) !== null) {
      const rawName = match[1];
      const name = rawName.replace(/^functions\./, "").replace(/[:\d]+$/, "");
      const args = match[2].trim();
      toolCalls.push({
        id: `call_${Math.random().toString(36).substring(2, 11)}_${index++}`,
        type: "function",
        function: {
          name,
          arguments: args
        }
      });
    }
  } else if (content.includes("<invoke")) {
    const regex = /<invoke\s+name=["'](.*?)["']\s*>([\s\S]*?)<\/invoke>/g;
    let match;
    let index = 0;
    while ((match = regex.exec(content)) !== null) {
      const rawName = match[1];
      const name = rawName.replace(/^functions\./, "").replace(/[:\d]+$/, "");
      const inner = match[2];
      
      const paramRegex = /<parameter\s+name=["'](.*?)["']\s*>([\s\S]*?)<\/parameter>/g;
      let paramMatch;
      const argsObj = {};
      while ((paramMatch = paramRegex.exec(inner)) !== null) {
        argsObj[paramMatch[1]] = paramMatch[2].trim();
      }
      
      toolCalls.push({
        id: `call_${Math.random().toString(36).substring(2, 11)}_${index++}`,
        type: "function",
        function: {
          name,
          arguments: JSON.stringify(argsObj)
        }
      });
    }
  }
  
  return toolCalls;
}

function cleanKimiContent(content) {
  let cleaned = content;
  cleaned = cleaned.replace(/<\|tool_calls_section_begin\|>[\s\S]*?<\|tool_calls_section_end\|>/g, "");
  cleaned = cleaned.replace(/<invoke[\s\S]*?<\/invoke>/g, "");
  return cleaned.trim();
}

function transformKimiStream(responseStream, options = {}) {
  const reader = responseStream.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";
  const expectsToolCalls = options.expectsToolCalls === true;

  let accumulatedText = "";
  let sseId = null;
  let sseModel = null;
  let lastChunkObj = null;
  let latestStopReason = "";
  let emittedStructuredToolCall = false;

  const transformStream = new ReadableStream({
    async start(controller) {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            // Flush any remaining line in buffer
            if (buffer) {
              processLine(buffer, controller);
            }
            // Flush any remaining accumulated text
            if (accumulatedText) {
              if (isKimiToolFailure({ stopReason: latestStopReason, content: accumulatedText, expectsToolCalls }) && !emittedStructuredToolCall) {
                controller.error(new Error(`Kimi tool-call failure: ${latestStopReason || "invalid tool output"}`));
                return;
              }
              const flushChunk = createTextChunk(sseId, sseModel, accumulatedText, lastChunkObj);
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(flushChunk)}\n\n`));
            }
            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
            controller.close();
            break;
          }

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            processLine(line, controller);
          }
        }
      } catch (err) {
        controller.error(err);
      }
    }
  });

  return transformStream;

  function processLine(line, controller) {
    const trimmed = line.trim();
    if (!trimmed) {
      return;
    }
    if (!trimmed.startsWith("data:")) {
      controller.enqueue(encoder.encode(line + "\n"));
      return;
    }

    const rawData = trimmed.slice(5).trim();
    if (rawData === "[DONE]") {
      return;
    }

    let parsed;
    try {
      parsed = JSON.parse(rawData);
    } catch {
      controller.enqueue(encoder.encode(line + "\n"));
      return;
    }

    if (parsed.id) sseId = parsed.id;
    if (parsed.model) sseModel = parsed.model;
    lastChunkObj = parsed;

    const choice = parsed.choices?.[0];
    // NIM sends integer stop_reason (e.g. 163586) alongside string finish_reason.
    // Normalize: prefer string finish_reason; only store stop_reason if it's a string.
    const rawStopReason = choice?.stop_reason;
    const rawFinishReason = choice?.finish_reason;
    if (rawFinishReason) latestStopReason = String(rawFinishReason);
    else if (rawStopReason && typeof rawStopReason === "string") latestStopReason = rawStopReason;
    const delta = choice?.delta;
    const content = delta?.content || "";

    if (!content) {
      if (choice?.finish_reason && accumulatedText) {
        const toolCalls = parseKimiToolCalls(accumulatedText);
        if (toolCalls.length > 0) {
          emittedStructuredToolCall = true;
          const tcChunk = createToolCallChunk(sseId, sseModel, toolCalls, lastChunkObj);
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(tcChunk)}\n\n`));
        } else if (isKimiToolFailure({ stopReason: latestStopReason, content: accumulatedText, expectsToolCalls })) {
          controller.error(new Error(`Kimi tool-call failure: ${latestStopReason || "invalid tool output"}`));
          return;
        } else {
          const textChunk = createTextChunk(sseId, sseModel, accumulatedText, lastChunkObj);
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(textChunk)}\n\n`));
        }
        accumulatedText = "";
      }
      controller.enqueue(encoder.encode(`data: ${JSON.stringify(parsed)}\n\n`));
      return;
    }

    accumulatedText += content;

    const hasFormat1Start = accumulatedText.includes("<|tool_calls_section_begin|>");
    const hasFormat2Start = accumulatedText.includes("<invoke");

    if (!hasFormat1Start && !hasFormat2Start) {
      // In plain chat mode (no tools expected): always forward chunks immediately.
      // In tool mode: buffer until stream end so cross-chunk tool markers can be assembled.
      // NOTE: NIM sends integer stop_reason (e.g. 163586) rather than string "stop".
      // We must flush on finish_reason regardless of stop_reason type.
      if (!expectsToolCalls) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(parsed)}\n\n`));
        accumulatedText = "";
      }
      return;
    }

    const startTag = hasFormat1Start ? "<|tool_calls_section_begin|>" : "<invoke";
    const startIdx = accumulatedText.indexOf(startTag);
    if (startIdx > 0) {
      const prefixText = accumulatedText.slice(0, startIdx);
      const prefixChunk = createTextChunk(sseId, sseModel, prefixText, parsed);
      controller.enqueue(encoder.encode(`data: ${JSON.stringify(prefixChunk)}\n\n`));
      accumulatedText = accumulatedText.slice(startIdx);
    }

    const endTag = hasFormat1Start ? "<|tool_calls_section_end|>" : "</invoke>";
    const endIdx = accumulatedText.indexOf(endTag);
    if (endIdx !== -1) {
      const endTagLength = endTag.length;
      const fullToolCallBlock = accumulatedText.slice(0, endIdx + endTagLength);
      const remainder = accumulatedText.slice(endIdx + endTagLength);

      const toolCalls = parseKimiToolCalls(fullToolCallBlock);
      if (toolCalls.length > 0) {
        emittedStructuredToolCall = true;
        const tcChunk = createToolCallChunk(sseId, sseModel, toolCalls, parsed);
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(tcChunk)}\n\n`));
      } else {
        const textChunk = createTextChunk(sseId, sseModel, fullToolCallBlock, parsed);
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(textChunk)}\n\n`));
      }

      accumulatedText = remainder;
      if (accumulatedText) {
        const trailingChunk = createTextChunk(sseId, sseModel, accumulatedText, parsed);
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(trailingChunk)}\n\n`));
        accumulatedText = "";
      }
    }
  }

  function createTextChunk(id, model, text, templateObj) {
    const chunk = JSON.parse(JSON.stringify(templateObj || {}));
    chunk.id = id;
    chunk.model = model;
    if (!chunk.choices) chunk.choices = [{}];
    if (!chunk.choices[0].delta) chunk.choices[0].delta = {};
    chunk.choices[0].delta.content = text;
    return chunk;
  }

  function createToolCallChunk(id, model, toolCalls, templateObj) {
    const chunk = JSON.parse(JSON.stringify(templateObj || {}));
    chunk.id = id;
    chunk.model = model;
    if (!chunk.choices) chunk.choices = [{}];
    if (!chunk.choices[0].delta) chunk.choices[0].delta = {};
    chunk.choices[0].delta.tool_calls = toolCalls;
    chunk.choices[0].finish_reason = "tool_calls";
    return chunk;
  }
}

export const __testing = {
  requestExpectsToolCalls,
  isKimiToolFailure,
  parseKimiToolCalls,
  cleanKimiContent,
};

export default DefaultExecutor;
