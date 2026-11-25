import { describe, it, expect } from "vitest";
import { CodeBuddyIntlExecutor } from "../../open-sse/executors/codebuddy-intl.js";

describe("CodeBuddyIntlExecutor system prompt & agent sanitization", () => {
  const exec = new CodeBuddyIntlExecutor();

  it("forwards user custom system prompt when provided", () => {
    const out = exec.transformRequest(
      "deepseek-v4.1-flash",
      {
        messages: [
          { role: "system", content: "You are a professional translator." },
          { role: "user", content: "Translate this text." },
        ],
      },
      false,
      {}
    );

    expect(out.messages).toEqual([
      { role: "system", content: "You are CodeBuddy Code." },
      { role: "system", content: "You are a professional translator." },
      { role: "user", content: [{ type: "text", text: "Translate this text." }] },
    ]);
  });

  it("falls back to default system prompt when omitted by client", () => {
    const out = exec.transformRequest(
      "deepseek-v4.1-flash",
      {
        messages: [{ role: "user", content: "Hello" }],
      },
      false,
      {}
    );

    expect(out.messages).toEqual([
      { role: "system", content: "You are CodeBuddy Code." },
      { role: "user", content: [{ type: "text", text: "Hello" }] },
    ]);
  });

  it("rewrites only the CLI identity span and keeps the rest of the prompt", () => {
    const out = exec.transformRequest(
      "deepseek-v4.1-flash",
      {
        messages: [
          { role: "system", content: "You are Claude Code, Anthropic's official CLI for coding. Always answer in English." },
          { role: "user", content: "Hi" },
        ],
      },
      false,
      {}
    );

    const system = out.messages.find((m) => m.role === "system" && m.content.includes("Always answer in English."));
    expect(system).toBeDefined();
    expect(system.content).toContain("Always answer in English.");
    expect(system.content).not.toContain("Claude Code");
  });

  it("keeps a generic user system prompt instead of replacing it", () => {
    const out = exec.transformRequest(
      "deepseek-v4.1-flash",
      {
        messages: [
          { role: "system", content: "You are a helpful AI agent for billing support." },
          { role: "user", content: "Hello" },
        ],
      },
      false,
      {}
    );

    expect(out.messages).toContainEqual({
      role: "system",
      content: "You are a helpful AI agent for billing support.",
    });
  });

  it("neutralizes sensitive third-party agent identity to prevent WAF rejection", () => {
    const out = exec.transformRequest(
      "deepseek-v4.1-flash",
      {
        messages: [
          {
            role: "system",
            content: "You are Claude Code, Anthropic's official CLI for coding.",
          },
          { role: "user", content: "Fix this bug" },
        ],
      },
      false,
      {}
    );

    expect(out.messages).toEqual([
      { role: "system", content: "You are CodeBuddy Code." },
      { role: "system", content: "You are CodeBuddy Code, an expert software engineering assistant." },
      { role: "user", content: [{ type: "text", text: "Fix this bug" }] },
    ]);
  });
});
