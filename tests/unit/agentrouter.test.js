// Guards the AgentRouter registry entry (Claude-format passthrough provider).
// AgentRouter proxies to agentrouter.org/v1/messages using x-api-key auth and
// dynamic Claude Code compatible wire image.
import { describe, it, expect } from "vitest";
import agentrouter from "../../open-sse/providers/registry/agentrouter.js";
import { getExecutor } from "../../open-sse/executors/index.js";
import { checkFallbackError } from "../../open-sse/services/accountFallback.js";
import { AI_PROVIDERS, FREE_TIER_PROVIDERS, getAclProviderList } from "@/shared/constants/providers";

describe("agentrouter registry entry", () => {
  it("exposes the canonical identity fields", () => {
    expect(agentrouter.id).toBe("agentrouter");
    expect(agentrouter.alias).toBe("agentrouter");
    expect(agentrouter.uiAlias).toBe("agentrouter");
  });

  it("is a free-tier, apikey, passthrough LLM-only provider", () => {
    expect(agentrouter.category).toBe("freeTier");
    expect(agentrouter.authType).toBe("apikey");
    expect(agentrouter.hasOAuth).toBe(false);
    expect(agentrouter.authModes).toEqual(["apikey"]);
    expect(agentrouter.serviceKinds).toEqual(["llm"]);
    expect(agentrouter.passthroughModels).toBe(true);
  });

  it("declares the Claude-format transport with x-api-key auth + retry policy", () => {
    const t = agentrouter.transport;
    expect(t.baseUrl).toBe("https://agentrouter.org/v1/messages");
    expect(t.format).toBe("claude");
    expect(t.timeoutMs).toBe(600000);
    expect(t.auth.apiKey).toMatchObject({
      header: "x-api-key",
    });
    expect(t.retry).toMatchObject({
      429: { attempts: 3, delayMs: 500 },
      502: { attempts: 3, delayMs: 500 },
      503: { attempts: 3, delayMs: 1000 },
    });
  });

  it("sends dynamic Claude-Code compatible wire image headers from the executor", () => {
    const executor = getExecutor("agentrouter");
    const headers = executor.buildHeaders({ apiKey: "sk-agentrouter" }, true);
    // AgentRouter validates these to ensure the request comes from a Claude CLI/compatible client.
    expect(headers["User-Agent"]).toBe("claude-cli/2.1.195 (external, sdk-cli)");
    expect(headers["x-app"]).toBe("cli");
    expect(headers["anthropic-dangerous-direct-browser-access"]).toBe("true");
    expect(headers["anthropic-beta"]).toContain("claude-code-20250219");
    expect(headers["X-Stainless-Lang"]).toBe("js");
    expect(headers["x-api-key"]).toBe("sk-agentrouter");
  });

  it("requires stream:true (forceStream) because AgentRouter rejects non-streaming", () => {
    expect(agentrouter.transport.forceStream).toBe(true);
  });

  it("carries display + free-credit hint", () => {
    expect(agentrouter.display.name).toBe("AgentRouter");
    expect(agentrouter.display.website).toBe("https://agentrouter.org");
    const hint = "Get $200 free credits at https://agentrouter.org/register — no credit card required.";
    expect(agentrouter.display.notice.apiHint).toBe(hint);
    // Current provider-detail UI renders notice.text / notice.apiKeyUrl.
    expect(agentrouter.display.notice.text).toBe(hint);
    expect(agentrouter.display.notice.apiKeyUrl).toBe("https://agentrouter.org/register");
  });
});

describe("agentrouter integration via providers.js", () => {
  it("is registered in AI_PROVIDERS and FREE_TIER_PROVIDERS", () => {
    expect(AI_PROVIDERS.agentrouter).toBeTruthy();
    expect(FREE_TIER_PROVIDERS.agentrouter).toBeTruthy();
    expect(AI_PROVIDERS.agentrouter.id).toBe("agentrouter");
    expect(AI_PROVIDERS.agentrouter.alias).toBe("agentrouter");
    expect(AI_PROVIDERS.agentrouter.passthroughModels).toBe(true);
  });

  it("appears in the derived ACL provider picker (non-hidden, apikey)", () => {
    const list = getAclProviderList();
    const entry = list.find((p) => p.alias === "agentrouter");
    expect(entry).toBeTruthy();
    expect(entry.name).toBe("AgentRouter");
  });
});

describe("agentrouter content-blocked fallback handling", () => {
  it("does not trigger fallback for content-blocked errors", () => {
    const errorText = '{"error":{"code":"content-blocked","message":"content-blocked (request id: 123)","param":"","type":"agent_router_api_error"}}';
    const result = checkFallbackError(400, errorText);
    expect(result.shouldFallback).toBe(false);
  });

  it("does not trigger fallback for content_blocked errors", () => {
    const result = checkFallbackError(400, "content_blocked");
    expect(result.shouldFallback).toBe(false);
  });
});
