import { DefaultExecutor } from "./default.js";
import { randomUUID } from "node:crypto";

export class AgentRouterExecutor extends DefaultExecutor {
  constructor() {
    super("agentrouter");
  }

  buildUrl(model, stream, urlIndex = 0, credentials = null) {
    // Keeps own registry baseUrl + ?beta=true
    return "https://agentrouter.org/v1/messages?beta=true";
  }

  buildHeaders(credentials, stream = true) {
    const sessionId = randomUUID();
    const headers = {};

    // We build the keys in the EXACT order defined by OmniRoute's "claude-code-compatible" fingerprint:
    // headerOrder: [
    //   "Host",
    //   "Content-Type",
    //   "Authorization", (none)
    //   "anthropic-version",
    //   "anthropic-beta",
    //   "anthropic-dangerous-direct-browser-access",
    //   "x-app",
    //   "User-Agent",
    //   "X-Claude-Code-Session-Id",
    //   "X-Stainless-Retry-Count",
    //   "X-Stainless-Timeout",
    //   "X-Stainless-Lang",
    //   "X-Stainless-Package-Version",
    //   "X-Stainless-OS",
    //   "X-Stainless-Arch",
    //   "X-Stainless-Runtime",
    //   "X-Stainless-Runtime-Version",
    //   "Accept",
    //   "accept-encoding",
    //   "Connection", (none)
    // ]
    
    headers["Content-Type"] = "application/json";
    headers["anthropic-version"] = "2023-06-01";
    headers["anthropic-beta"] = "claude-code-20250219,interleaved-thinking-2025-05-14,effort-2025-11-24";
    headers["anthropic-dangerous-direct-browser-access"] = "true";
    headers["x-app"] = "cli";
    headers["User-Agent"] = "claude-cli/2.1.195 (external, sdk-cli)";
    headers["X-Claude-Code-Session-Id"] = sessionId;
    headers["X-Stainless-Retry-Count"] = "0";
    headers["X-Stainless-Timeout"] = "600";
    headers["X-Stainless-Lang"] = "js";
    headers["X-Stainless-Package-Version"] = "0.94.0";
    headers["X-Stainless-OS"] = "MacOS";
    headers["X-Stainless-Arch"] = "arm64";
    headers["X-Stainless-Runtime"] = "node";
    headers["X-Stainless-Runtime-Version"] = "v24.3.0";
    headers["Accept"] = stream ? "text/event-stream" : "application/json";
    headers["accept-encoding"] = "gzip, deflate, br, zstd";
    
    if (credentials?.apiKey) {
      headers["x-api-key"] = credentials.apiKey;
    }

    return headers;
  }

  transformRequest(model, body, stream, credentials) {
    const transformed = super.transformRequest(model, body, stream, credentials);
    if (!transformed || typeof transformed !== "object") return transformed;

    // Reorder keys according to "claude-code-compatible" bodyFieldOrder:
    // [
    //   "model",
    //   "messages",
    //   "system",
    //   "tools",
    //   "tool_choice",
    //   "metadata",
    //   "max_tokens",
    //   "thinking",
    //   "output_config",
    //   "stream",
    // ]
    const order = [
      "model",
      "messages",
      "system",
      "tools",
      "tool_choice",
      "metadata",
      "max_tokens",
      "thinking",
      "output_config",
      "stream",
    ];

    const reordered = {};
    const remaining = new Set(Object.keys(transformed));

    for (const key of order) {
      if (key in transformed) {
        reordered[key] = transformed[key];
        remaining.delete(key);
      }
    }

    for (const key of remaining) {
      reordered[key] = transformed[key];
    }

    return reordered;
  }
}

export default AgentRouterExecutor;
