import { describe, expect, it } from "vitest";
import {
  PROVIDER_MODELS,
  getModelSupportedFormats,
  getModelTargetFormat,
  getModelUpstreamId,
} from "../../open-sse/config/providerModels.js";
import { PROVIDERS } from "../../open-sse/config/providers.js";
import { resolveTransport } from "../../open-sse/services/provider.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { translateRequest } from "../../open-sse/translator/index.js";
import { OpenCodeGoExecutor } from "../../open-sse/executors/opencode-go.js";
import "../translator/registerAll.js";

const CLI_PROVIDERS_SOURCE = await import("fs").then(({ readFileSync }) =>
  readFileSync(new URL("../../cli/src/cli/menus/providers.js", import.meta.url), "utf8")
);

// Chat-only models (no /messages, no /responses support on opencode-go)
const CHAT_ONLY = [
  "glm-5.3-flash",
  "glm-5.3",
  "glm-5.2",
  "glm-5.1",
  "kimi-k2.7-code",
  "kimi-k2.6",
  "kimi-k3",
  "deepseek-flash",
  "longcat-2.0",
  "mimo-v2.5",
  "mimo-v2.5-pro",
  "hy4-preview",
  "hy3",
];
// Models that also expose the Anthropic /messages endpoint
const CLAUDE_CAPABLE = [
  "minimax-m3",
  "minimax-m2.7",
  "minimax-m2.5",
  "qwen3.8-max",
  "qwen3.8-flash",
  "qwen3.7-max",
  "qwen3.7-plus",
  "qwen3.6-plus",
];
// Models that also expose the OpenAI /responses endpoint
const RESPONSES_CAPABLE = ["deepseek-v4-pro", "deepseek-v4-flash"];
// Models served exclusively by the OpenAI /responses endpoint
const RESPONSES_ONLY = ["muse-spark-1.2-contributor"];

// Mirror of chatCore's per-model transport guard: use the sourceFormat-matched
// transport only when the model declares support for that sourceFormat.
function pickTransport(provider, sourceFormat, alias, model) {
  const supported = getModelSupportedFormats(alias, model);
  const rt = resolveTransport(provider, sourceFormat);
  return supported?.includes(sourceFormat) ? rt : null;
}

describe("OpenCode Go model catalog", () => {
  it("is exposed by the CLI provider setup", () => {
    expect(CLI_PROVIDERS_SOURCE).toContain('"opencode-go": { id: "opencode-go", name: "OpenCode Go" }');
    expect(CLI_PROVIDERS_SOURCE).toContain('"opencode-go": [');
  });

  it("matches the documented model IDs", () => {
    const ids = (PROVIDER_MODELS["opencode-go"] || []).map((m) => m.id);
    expect(ids).toEqual([
      "deepseek-flash",
      "glm-5.3-flash",
      "glm-5.3",
      "glm-5.2",
      "glm-5.1",
      "gpt-5.6-luna",
      "grok-4.6",
      "kimi-k2.7-code",
      "kimi-k2.6",
      "kimi-k3",
      "deepseek-v4-pro",
      "deepseek-v4-flash",
      "deepseek-v4-flash-vision-exp",
      "longcat-2.0",
      "mimo-v2.5",
      "mimo-v2.5-pro",
      "minimax-m3",
      "minimax-m2.7",
      "minimax-m2.5",
      "qwen3.8-max",
      "qwen3.8-flash",
      "qwen3.7-max",
      "qwen3.7-plus",
      "qwen3.6-plus",
      "hy4-preview",
      "hy3",
      "muse-spark-1.2-contributor",
      "muse-spark-1.3-contributor",
    ]);
  });
});

describe("OpenCode Go per-model supportedFormats", () => {
  it("declares [openai, claude] for MiniMax + Qwen models", () => {
    for (const m of CLAUDE_CAPABLE) {
      expect(getModelSupportedFormats("opencode-go", m)).toEqual([
        "openai",
        "claude",
      ]);
    }
  });

  it("declares [openai, claude, openai-responses] for DeepSeek models", () => {
    for (const m of RESPONSES_CAPABLE) {
      expect(getModelSupportedFormats("opencode-go", m)).toEqual([
        "openai",
        "claude",
        "openai-responses",
      ]);
    }
  });

  it("declares [openai] only for chat-only models (GLM/Kimi/MiMo) → guards /messages routing", () => {
    for (const m of CHAT_ONLY) {
      expect(getModelSupportedFormats("opencode-go", m)).toEqual(["openai"]);
    }
  });
});

describe("OpenCode Go multi-endpoint transports", () => {
  it("declares openai / claude / openai-responses transports", () => {
    const formats = (PROVIDERS["opencode-go"].transports || []).map(
      (t) => t.format,
    );
    expect(formats).toEqual(["openai", "claude", "openai-responses"]);
  });

  it("resolveTransport picks the endpoint matching the client sourceFormat", () => {
    expect(resolveTransport("opencode-go", "claude").baseUrl).toBe(
      "https://opencode.ai/zen/go/v1/messages",
    );
    expect(resolveTransport("opencode-go", "openai-responses").baseUrl).toBe(
      "https://opencode.ai/zen/go/v1/responses",
    );
    expect(resolveTransport("opencode-go", "openai").baseUrl).toBe(
      "https://opencode.ai/zen/go/v1/chat/completions",
    );
  });

  it("uses x-api-key + anthropicVersion on the claude transport", () => {
    const t = resolveTransport("opencode-go", "claude");
    expect(t.auth.header).toBe("x-api-key");
    expect(t.auth.anthropicVersion).toBe(true);
  });
});

describe("OpenCode Go per-model transport guard (chatCore logic)", () => {
  it("routes MiniMax/Qwen + claude-format client to /messages", () => {
    for (const m of CLAUDE_CAPABLE) {
      expect(
        pickTransport("opencode-go", "claude", "opencode-go", m)?.baseUrl,
      ).toBe("https://opencode.ai/zen/go/v1/messages");
    }
  });

  it("does NOT route chat-only models to /messages on a claude-format request", () => {
    for (const m of CHAT_ONLY) {
      expect(
        pickTransport("opencode-go", "claude", "opencode-go", m),
      ).toBeNull();
    }
  });

  it("routes DeepSeek + responses-format client to /responses", () => {
    for (const m of RESPONSES_CAPABLE) {
      expect(
        pickTransport("opencode-go", "openai-responses", "opencode-go", m)
          ?.baseUrl,
      ).toBe("https://opencode.ai/zen/go/v1/responses");
    }
  });

  it("does NOT route MiniMax (no responses support) to /responses", () => {
    for (const m of CLAUDE_CAPABLE) {
      expect(
        pickTransport("opencode-go", "openai-responses", "opencode-go", m),
      ).toBeNull();
    }
  });
});

describe("OpenCode Go session affinity headers", () => {
  it("sends x-opencode-session on every request (chat, messages, responses)", () => {
    const executor = new OpenCodeGoExecutor();
    const creds = { apiKey: "test", connectionId: "conn-1" };
    for (const [model, expectedUrl] of [
      ["glm-5.2", "https://opencode.ai/zen/go/v1/chat/completions"],
      ["minimax-m3", "https://opencode.ai/zen/go/v1/messages"],
      ["deepseek-v4-flash", "https://opencode.ai/zen/go/v1/chat/completions"],
    ]) {
      executor.buildUrl(model);
      const headers = executor.buildHeaders(creds, true);
      expect(headers["x-opencode-session"]).toBeTruthy();
      expect(executor.buildUrl(model)).toBe(expectedUrl);
    }
  });

  it("keeps the session stable across turns of one conversation", () => {
    const executor = new OpenCodeGoExecutor();
    const creds = { apiKey: "test", connectionId: "conn-1" };
    const body = { model: "glm-5.2", messages: [{ role: "user", content: "hi" }] };
    executor.buildUrl("glm-5.2");
    executor.transformRequest("glm-5.2", body, true, creds);
    const first = executor.buildHeaders(creds, true)["x-opencode-session"];
    const second = executor.buildHeaders(creds, true)["x-opencode-session"];
    expect(first).toBeTruthy();
    expect(second).toBe(first);
  });

  it("client-provided x-opencode-session header wins", () => {
    const executor = new OpenCodeGoExecutor();
    const creds = {
      apiKey: "test",
      rawHeaders: { "x-opencode-session": "client-provided-session" },
    };
    executor.buildUrl("glm-5.2");
    const headers = executor.buildHeaders(creds, true);
    expect(headers["x-opencode-session"]).toBe("client-provided-session");
  });

  it("sets the full x-opencode-* header family", () => {
    const executor = new OpenCodeGoExecutor();
    const creds = { apiKey: "test" };
    executor.buildUrl("glm-5.2");
    const headers = executor.buildHeaders(creds, true);
    expect(headers["x-opencode-client"]).toBe("desktop");
    expect(headers["x-opencode-session"]).toMatch(/^ses_/);
    expect(headers["x-opencode-request"]).toMatch(/^msg_/);
    expect(headers["x-opencode-project"]).toBe("global");
    expect(headers["Authorization"]).toBe("Bearer test");
  });

  it("keeps x-api-key auth on messages-format models while adding session headers", () => {
    const executor = new OpenCodeGoExecutor();
    const creds = { apiKey: "test" };
    executor.buildUrl("minimax-m3");
    const headers = executor.buildHeaders(creds, true);
    expect(headers["x-api-key"]).toBe("test");
    expect(headers["anthropic-version"]).toBeDefined();
    expect(headers["x-opencode-session"]).toMatch(/^ses_/);
  });
});

describe("OpenCode Go Muse Spark (responses-only model)", () => {
  it("declares openai-responses as the only supported format and target", () => {
    for (const m of RESPONSES_ONLY) {
      expect(getModelSupportedFormats("opencode-go", m)).toEqual([
        "openai-responses",
      ]);
      expect(getModelTargetFormat("opencode-go", m)).toBe("openai-responses");
    }
  });

  it("translates an OpenAI Chat request to the Responses shape (no `messages` upstream)", () => {
    const body = {
      model: "ocg/muse-spark-1.2-contributor",
      messages: [{ role: "user", content: "Think, then answer: 2 + 2?" }],
      reasoning_effort: "max",
      max_tokens: 131072,
    };

    // Mirrors chatCore targetFormat resolution: transport guard (openai not in
    // supportedFormats) → null, model-level targetFormat → openai-responses.
    const translated = translateRequest(
      FORMATS.OPENAI,
      FORMATS.OPENAI_RESPONSES,
      "muse-spark-1.2-contributor",
      body,
      true,
      {},
      "opencode-go",
    );
    const out = new OpenCodeGoExecutor().transformRequest(
      "muse-spark-1.2-contributor",
      translated,
      true,
      {},
    );

    expect(out.input).toBeDefined();
    expect(out.messages).toBeUndefined();
    expect(out.reasoning).toEqual({ effort: "xhigh", summary: "auto" });
    expect(out.max_output_tokens).toBe(131072);
    expect(out.max_tokens).toBeUndefined();
  });

  it("routes Muse Spark to /responses only", () => {
    const executor = new OpenCodeGoExecutor();
    expect(executor.buildUrl("muse-spark-1.2-contributor")).toBe(
      "https://opencode.ai/zen/go/v1/responses",
    );
  });
});

describe("OpenCode Go responses-only routing (registry-driven)", () => {
  // Config decides the list — no hardcoded model ids in the executor anymore.
  const responsesOnlyModels = (PROVIDER_MODELS["opencode-go"] || []).filter(
    (m) => m.targetFormat === "openai-responses",
  );

  it("resolves thinking suffixes to the base registry entry", () => {
    for (const m of ["gpt-5.6-luna(high)", "grok-4.6(high)"]) {
      expect(getModelSupportedFormats("opencode-go", m)).toEqual([
        "openai-responses",
      ]);
      expect(getModelTargetFormat("opencode-go", m)).toBe("openai-responses");
      expect(getModelUpstreamId("opencode-go", m)).toBe(m.replace("(high)", ""));
    }
  });

  it("routes every registry responses-only model, with or without a thinking suffix", () => {
    const executor = new OpenCodeGoExecutor();
    expect(responsesOnlyModels.length).toBeGreaterThan(0);
    for (const m of responsesOnlyModels) {
      expect(executor.buildUrl(m.id)).toBe("https://opencode.ai/zen/go/v1/responses");
      expect(executor.buildUrl(`${m.id}(high)`)).toBe(
        "https://opencode.ai/zen/go/v1/responses",
      );
    }
  });

  it("keeps /responses when a stale chat/completions transport leaks in", () => {
    const executor = new OpenCodeGoExecutor();
    const runtimeTransport = resolveTransport("opencode-go", "openai");
    for (const m of ["gpt-5.6-luna(high)", "grok-4.6(high)"]) {
      expect(
        executor.buildUrl(m, true, 0, { apiKey: "sk-go-test", runtimeTransport }),
      ).toBe("https://opencode.ai/zen/go/v1/responses");
    }
  });

  it("normalizes the Responses body even with a leaked transport", () => {
    const executor = new OpenCodeGoExecutor();
    const runtimeTransport = resolveTransport("opencode-go", "openai");
    const body = {
      messages: [{ role: "user", content: "hi" }],
      max_tokens: 123,
      reasoning_effort: "high",
    };
    const out = executor.transformRequest("grok-4.6(high)", body, true, {
      apiKey: "sk-go-test",
      runtimeTransport,
    });
    expect(out).toMatchObject({
      max_output_tokens: 123,
      reasoning: { effort: "high", summary: "auto" },
    });
    expect(out.max_tokens).toBeUndefined();
  });
});

describe("OpenCode Go executor runtime transports", () => {
  const executor = new OpenCodeGoExecutor();
  const credentials = { apiKey: "sk-go-test" };

  it("uses the Claude transport for Qwen URL and auth", () => {
    const runtimeTransport = resolveTransport("opencode-go", "claude");
    expect(executor.buildUrl("qwen3.7-max", true, 0, { ...credentials, runtimeTransport })).toBe(
      "https://opencode.ai/zen/go/v1/messages",
    );
    expect(executor.buildHeaders({ ...credentials, runtimeTransport }, true)).toMatchObject({
      "x-api-key": "sk-go-test",
      "anthropic-version": expect.any(String),
      Accept: "text/event-stream",
    });
  });

  it("uses the Claude transport for DeepSeek instead of model sets", () => {
    const runtimeTransport = resolveTransport("opencode-go", "claude");
    expect(executor.buildUrl("deepseek-v4-flash", true, 0, { ...credentials, runtimeTransport })).toBe(
      "https://opencode.ai/zen/go/v1/messages",
    );
    expect(executor.buildHeaders({ ...credentials, runtimeTransport }, true)).toMatchObject({
      "x-api-key": "sk-go-test",
    });
    expect(executor.buildHeaders({ ...credentials, runtimeTransport }, true)).not.toHaveProperty(
      "Authorization",
    );
  });

  it("uses the Responses transport and normalizes DeepSeek requests", () => {
    const runtimeTransport = resolveTransport("opencode-go", "openai-responses");
    const body = {
      messages: [{ role: "user", content: "hi" }],
      max_tokens: 123,
      reasoning_effort: "high",
    };
    expect(executor.buildUrl("deepseek-v4-flash", true, 0, { ...credentials, runtimeTransport })).toBe(
      "https://opencode.ai/zen/go/v1/responses",
    );
    expect(executor.transformRequest("deepseek-v4-flash", body, true, {
      ...credentials,
      runtimeTransport,
    })).toMatchObject({
      max_output_tokens: 123,
      reasoning: { effort: "high", summary: "auto" },
    });
    expect(body.max_tokens).toBeUndefined();
  });

  it("keeps legacy Muse fallback when runtime transport is absent", () => {
    const body = { input: "hi", max_tokens: 123, reasoning_effort: "high" };
    expect(executor.buildUrl("muse-spark-1.2-contributor")).toBe(
      "https://opencode.ai/zen/go/v1/responses",
    );
    expect(executor.buildHeaders({ apiKey: "sk-go-test" }, true)).toMatchObject({
      Authorization: "Bearer sk-go-test",
    });
    expect(executor.transformRequest("muse-spark-1.2-contributor", body, true, {})).toMatchObject({
      max_output_tokens: 123,
      reasoning: { effort: "high", summary: "auto" },
    });
  });

  it("normalizes legacy model suffixes before selecting URL and auth", () => {
    const credentials = { apiKey: "sk-go-test" };
    expect(executor.buildUrl("minimax-m3(high)", true, 0, credentials)).toBe(
      "https://opencode.ai/zen/go/v1/messages",
    );
    expect(executor.buildHeaders(credentials, true, "minimax-m3(high)")).toMatchObject({
      "x-api-key": "sk-go-test",
      "anthropic-version": expect.any(String),
    });
    expect(executor.buildHeaders(credentials, true, "minimax-m3(high)")).not.toHaveProperty(
      "Authorization",
    );
  });

  it("adds a stable per-connection session header", () => {
    const credentials = { apiKey: "sk-go-test", connectionId: "connection-1" };
    const first = executor.buildHeaders(credentials, true);
    const second = executor.buildHeaders(credentials, true);

    expect(first["x-opencode-session"]).toBe(second["x-opencode-session"]);
    expect(first["x-opencode-session"]).toMatch(/^[-a-f0-9]+$/);
  });
});
