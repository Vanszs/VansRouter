import { describe, it, expect } from "vitest";
import { needsTerminationPrompt } from "../../open-sse/handlers/chatCore.js";
import { injectTerminationPrompt, injectToolProtocolPrompt, TERMINATION_PROMPT } from "../../open-sse/rtk/terminationPrompt.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

describe("injectTerminationPrompt", () => {
  it("OpenAI format: appends to existing system message", () => {
    const body = { messages: [{ role: "system", content: "You are helpful." }, { role: "user", content: "hi" }] };
    injectTerminationPrompt(body, FORMATS.OPENAI);
    expect(body.messages[0].content).toContain(TERMINATION_PROMPT);
    expect(body.messages[0].content).toContain("You are helpful.");
  });

  it("OpenAI format: creates system message when none exists", () => {
    const body = { messages: [{ role: "user", content: "hi" }] };
    injectTerminationPrompt(body, FORMATS.OPENAI);
    expect(body.messages[0].role).toBe("system");
    expect(body.messages[0].content).toBe(TERMINATION_PROMPT);
  });

  it("Claude format: appends to body.system string", () => {
    const body = { system: "Be concise.", messages: [] };
    injectTerminationPrompt(body, FORMATS.CLAUDE);
    expect(body.system).toContain("Be concise.");
    expect(body.system).toContain(TERMINATION_PROMPT);
  });

  it("Claude format: pushes block to body.system array", () => {
    const body = { system: [{ type: "text", text: "existing" }], messages: [] };
    injectTerminationPrompt(body, FORMATS.CLAUDE);
    expect(body.system).toHaveLength(2);
    expect(body.system[1]).toEqual({ type: "text", text: TERMINATION_PROMPT });
  });

  it("Gemini format: pushes text to system_instruction.parts", () => {
    const body = { system_instruction: { parts: [{ text: "existing" }] }, contents: [] };
    injectTerminationPrompt(body, FORMATS.GEMINI);
    expect(body.system_instruction.parts).toHaveLength(2);
    expect(body.system_instruction.parts[1]).toEqual({ text: TERMINATION_PROMPT });
  });

  it("idempotent: calling twice does NOT duplicate", () => {
    const body = { messages: [{ role: "system", content: "You are helpful." }, { role: "user", content: "hi" }] };
    injectTerminationPrompt(body, FORMATS.OPENAI);
    injectTerminationPrompt(body, FORMATS.OPENAI);
    const count = body.messages[0].content.split(TERMINATION_PROMPT).length - 1;
    expect(count).toBe(1);
  });

  it("prompt does NOT contain specific tool names", () => {
    expect(TERMINATION_PROMPT).not.toContain("bash");
    expect(TERMINATION_PROMPT).not.toContain("grep");
    expect(TERMINATION_PROMPT).not.toContain("find");
    expect(TERMINATION_PROMPT).not.toContain("read_file");
  });

  it("enables Kimi 2.6/2.7 termination guard", () => {
    expect(needsTerminationPrompt("kimi", "kimi-k2.6")).toBe(true);
    expect(needsTerminationPrompt("kimi", "kimi-k2.7")).toBe(true);
    expect(needsTerminationPrompt("nvidia", "moonshotai/kimi-k2.7")).toBe(true);
    expect(needsTerminationPrompt("openai", "gpt-5.5")).toBe(false);
  });
});

describe("injectToolProtocolPrompt (no-tools fallback)", () => {
  it("injects base protocol text when toolNames is empty", () => {
    const body = { messages: [{ role: "user", content: "hi" }] };
    injectToolProtocolPrompt(body, FORMATS.OPENAI, []);
    const allContent = JSON.stringify(body.messages);
    expect(allContent).toContain("tool_call mechanism");
    expect(allContent).not.toContain("Valid tool names:");
  });

  it("lists valid tool names when toolNames is non-empty", () => {
    const body = { messages: [{ role: "user", content: "hi" }] };
    injectToolProtocolPrompt(body, FORMATS.OPENAI, ["bash", "read"]);
    const allContent = JSON.stringify(body.messages);
    expect(allContent).toContain("Valid tool names: bash, read");
  });
});
