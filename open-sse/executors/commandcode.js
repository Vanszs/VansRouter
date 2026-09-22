import { randomUUID } from "crypto";
import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../config/providers.js";
import { inspectAndWrapCommandCodeResponse, parseCommandCodeError } from "./commandcodeResponse.js";

/**
 * CommandCodeExecutor — talks to https://api.commandcode.ai/alpha/generate
 *
 * Auth: Bearer <user_xxx> API key (stored as the connection's apiKey).
 * Adds the per-request `x-session-id` header expected by CommandCode upstream.
 */
export class CommandCodeExecutor extends BaseExecutor {
  constructor() {
    super("commandcode", PROVIDERS.commandcode);
  }

  transformRequest(model, body, stream, credentials) {
    body.stream = true;
    return body;
  }

  buildHeaders(credentials, stream = true) {
    const headers = {
      "Content-Type": "application/json",
      ...(this.config.headers || {}),
      "x-session-id": randomUUID(),
    };

    const token = credentials?.apiKey || credentials?.accessToken;
    if (token) headers["Authorization"] = `Bearer ${token}`;
    if (stream) headers["Accept"] = "text/event-stream";
    return headers;
  }

  async execute(opts) {
    const maxRetries = 2;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const result = await super.execute(opts);
      if (!result?.response?.ok || !result.response.body) return result;

      const wrappedResponse = await inspectAndWrapCommandCodeResponse(result.response, opts.model);
      // An in-band error event arrives as HTTP 200 + NDJSON error, so the base
      // executor's status retry never sees it; retry the transient ones here.
      if (!wrappedResponse.ok && attempt < maxRetries) {
        const { status } = wrappedResponse;
        if (status === 502 || status === 503 || status === 504) {
          opts.log?.debug?.("RETRY", `CommandCode upstream returned status ${status}, retrying ${attempt + 1}/${maxRetries}...`);
          await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
          continue;
        }
      }

      result.response = wrappedResponse;
      return result;
    }
  }

  parseError(response, bodyText) {
    let parsed = null;
    try { parsed = JSON.parse(bodyText || "{}"); } catch { parsed = null; }
    const errObj = parsed?.error || parsed;
    const msg = errObj?.message || parsed?.message || bodyText || response.statusText;
    const status = Number(errObj?.code || errObj?.statusCode || response.status) || response.status;
    return { status, message: msg || `CommandCode upstream error: ${response.status}` };
  }
}

export { inspectAndWrapCommandCodeResponse, parseCommandCodeError };
