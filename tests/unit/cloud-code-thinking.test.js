// Unit + structural guards for cloudCodeThinking module.
// Mirrors OmniRoute's gemini-sanitize.test.ts coverage adapted for our fork.

import fs from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";
import {
  shouldStripCloudCodeThinking,
  stripCloudCodeThinkingConfig,
} from "../../open-sse/services/cloudCodeThinking.js";

describe("cloudCodeThinking — shouldStripCloudCodeThinking", () => {
  it("strips Claude models (all variants)", () => {
    expect(shouldStripCloudCodeThinking("antigravity", "claude-sonnet-4-6")).toBe(true);
    expect(shouldStripCloudCodeThinking("antigravity", "claude-opus-4-6-thinking")).toBe(true);
    expect(shouldStripCloudCodeThinking("antigravity", "Claude-Haiku-3")).toBe(true);
  });

  it("strips gpt-oss models", () => {
    expect(shouldStripCloudCodeThinking("antigravity", "gpt-oss-120b-medium")).toBe(true);
    expect(shouldStripCloudCodeThinking("antigravity", "GPT-OSS-20b")).toBe(true);
  });

  it("strips tab_* prefixed models", () => {
    expect(shouldStripCloudCodeThinking("antigravity", "tab_chat")).toBe(true);
  });

  it("keeps Gemini reasoning-capable models", () => {
    expect(shouldStripCloudCodeThinking("antigravity", "gemini-3-flash")).toBe(false);
    expect(shouldStripCloudCodeThinking("antigravity", "gemini-3.5-flash-low")).toBe(false);
    expect(shouldStripCloudCodeThinking("antigravity", "gemini-pro-agent")).toBe(false);
    expect(shouldStripCloudCodeThinking("antigravity", "gemini-3.1-pro-low")).toBe(false);
  });

  it("normalizes model prefixes (models/, antigravity/)", () => {
    expect(shouldStripCloudCodeThinking("antigravity", "models/claude-sonnet-4-6")).toBe(true);
    expect(shouldStripCloudCodeThinking("antigravity", "antigravity/claude-opus-4-6")).toBe(true);
    expect(shouldStripCloudCodeThinking("antigravity", "models/gemini-3-flash")).toBe(false);
  });

  it("returns false for empty/null model", () => {
    expect(shouldStripCloudCodeThinking("antigravity", "")).toBe(false);
    expect(shouldStripCloudCodeThinking("antigravity", null)).toBe(false);
    expect(shouldStripCloudCodeThinking("antigravity", undefined)).toBe(false);
  });
});

describe("cloudCodeThinking — stripCloudCodeThinkingConfig", () => {
  it("removes root thinking fields", () => {
    const out = stripCloudCodeThinkingConfig({
      reasoning_effort: "high",
      reasoning: { test: 1 },
      thinking: { type: "enabled" },
      contents: [],
    });
    expect(out.reasoning_effort).toBeUndefined();
    expect(out.reasoning).toBeUndefined();
    expect(out.thinking).toBeUndefined();
    expect(out.contents).toEqual([]);
  });

  it("removes camelCase thinkingConfig from root generationConfig", () => {
    const out = stripCloudCodeThinkingConfig({
      generationConfig: {
        temperature: 1,
        thinkingConfig: { thinkingBudget: -1, includeThoughts: true },
      },
    });
    expect(out.generationConfig.thinkingConfig).toBeUndefined();
    expect(out.generationConfig.temperature).toBe(1);
  });

  it("removes snake_case thinking_config (Google API accepts both variants)", () => {
    const out = stripCloudCodeThinkingConfig({
      generationConfig: {
        thinking_config: { thinking_budget: 100 },
        topP: 0.9,
      },
    });
    expect(out.generationConfig.thinking_config).toBeUndefined();
    expect(out.generationConfig.topP).toBe(0.9);
  });

  it("removes thinking fields from nested body.request", () => {
    const out = stripCloudCodeThinkingConfig({
      request: {
        reasoning_effort: "low",
        generationConfig: {
          thinkingConfig: { thinkingBudget: 100 },
        },
      },
    });
    expect(out.request.reasoning_effort).toBeUndefined();
    expect(out.request.generationConfig.thinkingConfig).toBeUndefined();
  });

  it("preserves non-thinking fields", () => {
    const out = stripCloudCodeThinkingConfig({
      contents: [{ role: "user", parts: [{ text: "hi" }] }],
      generationConfig: { temperature: 0.7, maxOutputTokens: 1024 },
      safetySettings: [{ category: "HARM", threshold: "NONE" }],
      sessionId: "abc",
    });
    expect(out.contents).toEqual([{ role: "user", parts: [{ text: "hi" }] }]);
    expect(out.generationConfig).toEqual({ temperature: 0.7, maxOutputTokens: 1024 });
    expect(out.safetySettings).toEqual([{ category: "HARM", threshold: "NONE" }]);
    expect(out.sessionId).toBe("abc");
  });

  it("handles null/undefined/non-record input without throwing", () => {
    expect(stripCloudCodeThinkingConfig(null)).toBeNull();
    expect(stripCloudCodeThinkingConfig(undefined)).toBeUndefined();
    expect(stripCloudCodeThinkingConfig("nope")).toBe("nope");
    expect(stripCloudCodeThinkingConfig([1, 2])).toEqual([1, 2]);
  });

  it("returns same-shape object when no thinking fields present", () => {
    const input = { contents: [], generationConfig: { temperature: 1 } };
    const out = stripCloudCodeThinkingConfig(input);
    expect(out).toEqual(input);
    expect(out).not.toBe(input);
  });
});

describe("cloudCodeThinking — antigravity.js integration guard", () => {
  const execPath = path.resolve("open-sse/executors/antigravity.js");

  it("imports the shared module (not inline patterns)", () => {
    const src = fs.readFileSync(execPath, "utf8");
    expect(src).toMatch(/from\s+["']\.\.\/services\/cloudCodeThinking\.js["']/);
    expect(src).toMatch(/shouldStripCloudCodeThinking/);
    expect(src).toMatch(/stripCloudCodeThinkingConfig/);
  });

  it("no longer carries inline AG_REASONING_NATIVE_PATTERNS (delegated)", () => {
    const src = fs.readFileSync(execPath, "utf8");
    expect(src).not.toMatch(/AG_REASONING_NATIVE_PATTERNS/);
    expect(src).not.toMatch(/agModelUsesNativeThinking/);
  });

  it("ANTIGRAVITY_REQUEST_BLACKLIST no longer contains thinkingConfig (model-aware strip handles it)", () => {
    const src = fs.readFileSync(execPath, "utf8");
    const blacklistBlock = src.match(/ANTIGRAVITY_REQUEST_BLACKLIST\s*=\s*\[([\s\S]*?)\]/);
    expect(blacklistBlock).not.toBeNull();
    expect(blacklistBlock[1]).not.toMatch(/thinkingConfig/);
  });
});
