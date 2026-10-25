// Verify that combo strategies preserve X-VansRoute-Selected-Connection-Id
// headers from underlying model calls and degrade gracefully on total failure.
import { describe, it, expect, vi } from "vitest";
import { handleComboChat, handleFusionChat, isZeroContentResponse } from "../../open-sse/services/combo.js";

const log = { info: () => {}, warn: () => {}, debug: () => {} };

function okResponse(content, connectionId) {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (connectionId) headers.set("X-VansRoute-Selected-Connection-Id", connectionId);
  return new Response(
    JSON.stringify({ choices: [{ message: { role: "assistant", content } }] }),
    { status: 200, headers }
  );
}

function errResponse(status, message, connectionId) {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (connectionId) headers.set("X-VansRoute-Selected-Connection-Id", connectionId);
  return new Response(
    JSON.stringify({ error: { message } }),
    { status, headers }
  );
}

describe("combo fallback header propagation", () => {
  it("returns the selected-connection header of the succeeding model", async () => {
    const handleSingleModel = vi.fn(async (_body, model) => {
      if (model === "openai/gpt-4o") return errResponse(429, "rate limit exceeded", "conn-failed");
      return okResponse("hello from gemini", "conn-gemini-ok");
    });

    const res = await handleComboChat({
      body: { messages: [{ role: "user", content: "hi" }] },
      models: ["openai/gpt-4o", "gemini/gemini-1.5-flash"],
      handleSingleModel,
      log,
      comboName: "test-combo",
      comboStrategy: "fallback",
    });

    expect(res.ok).toBe(true);
    expect(res.headers.get("X-VansRoute-Selected-Connection-Id")).toBe("conn-gemini-ok");
    expect(handleSingleModel).toHaveBeenCalledTimes(2);
  });

  it("does not add a connection header when all models fail", async () => {
    const handleSingleModel = vi.fn(async () => errResponse(503, "overloaded"));

    const res = await handleComboChat({
      body: { messages: [{ role: "user", content: "hi" }] },
      models: ["openai/gpt-4o", "gemini/gemini-1.5-flash"],
      handleSingleModel,
      log,
      comboName: "test-combo",
      comboStrategy: "fallback",
    });

    expect(res.ok).toBe(false);
    expect(res.status).toBe(503);
    expect(res.headers.get("X-VansRoute-Selected-Connection-Id")).toBeNull();
  });

  it("preserves the header through a daily-quota 429 fallback", async () => {
    const handleSingleModel = vi.fn(async (_body, model) => {
      if (model === "openai/gpt-4o") {
        return errResponse(429, "today's quota exhausted", "conn-daily-quota");
      }
      return okResponse("hello", "conn-backup");
    });

    const res = await handleComboChat({
      body: { messages: [{ role: "user", content: "hi" }] },
      models: ["openai/gpt-4o", "anthropic/claude-3-haiku"],
      handleSingleModel,
      log,
      comboName: "test-combo",
      comboStrategy: "fallback",
    });

    expect(res.ok).toBe(true);
    expect(res.headers.get("X-VansRoute-Selected-Connection-Id")).toBe("conn-backup");
  });
});

describe("fusion combo header propagation", () => {
  it("returns the judge's selected-connection header when panel succeeds", async () => {
    const handleSingleModel = vi.fn(async (_body, model) => {
      if (model === "p/judge") return okResponse("final answer", "conn-judge");
      return okResponse(`panel answer from ${model}`, `conn-${model}`);
    });

    const res = await handleFusionChat({
      body: { messages: [{ role: "user", content: "hi" }] },
      models: ["p/a", "p/b"],
      handleSingleModel,
      log,
      comboName: "test-fusion",
      judgeModel: "p/judge",
      tuning: { minPanel: 2, stragglerGraceMs: 50, panelHardTimeoutMs: 5000 },
    });

    expect(res.ok).toBe(true);
    expect(res.headers.get("X-VansRoute-Selected-Connection-Id")).toBe("conn-judge");
  });

  it("returns the lone survivor's header when only one panel succeeds", async () => {
    const handleSingleModel = vi.fn(async (_body, model) => {
      if (model === "p/ok") return okResponse("lone survivor", "conn-lone");
      if (model === "p/judge") return okResponse("should not be called", "conn-judge");
      return errResponse(500, "failed");
    });

    const res = await handleFusionChat({
      body: { messages: [{ role: "user", content: "hi" }] },
      models: ["p/ok", "p/bad"],
      handleSingleModel,
      log,
      comboName: "test-fusion",
      judgeModel: "p/judge",
      tuning: { minPanel: 2, stragglerGraceMs: 50, panelHardTimeoutMs: 5000 },
    });

    expect(res.ok).toBe(true);
    expect(res.headers.get("X-VansRoute-Selected-Connection-Id")).toBe("conn-lone");
    expect(handleSingleModel.mock.calls.some(([, m]) => m === "p/judge")).toBe(false);
  });

  it("does not add a connection header when the whole panel fails", async () => {
    const handleSingleModel = vi.fn(async () => errResponse(503, "overloaded"));

    const res = await handleFusionChat({
      body: { messages: [{ role: "user", content: "hi" }] },
      models: ["p/a", "p/b"],
      handleSingleModel,
      log,
      comboName: "test-fusion",
      tuning: { minPanel: 2, stragglerGraceMs: 50, panelHardTimeoutMs: 5000 },
    });

    expect(res.ok).toBe(false);
    expect(res.status).toBe(503);
    expect(res.headers.get("X-VansRoute-Selected-Connection-Id")).toBeNull();
  });
});

describe("combo per-target timeout", () => {
  it("times out a hanging model and falls back to the next model", async () => {
    const handleSingleModel = vi.fn(async (_body, model) => {
      if (model === "openai/gpt-4o") {
        return new Promise(() => {}); // never resolves
      }
      return okResponse("hello from gemini", "conn-gemini-ok");
    });

    const res = await handleComboChat({
      body: { messages: [{ role: "user", content: "hi" }] },
      models: ["openai/gpt-4o", "gemini/gemini-1.5-flash"],
      handleSingleModel,
      log,
      comboName: "test-combo",
      comboStrategy: "fallback",
      timeoutMs: 50,
    });

    expect(res.ok).toBe(true);
    expect(res.headers.get("X-VansRoute-Selected-Connection-Id")).toBe("conn-gemini-ok");
    expect(handleSingleModel).toHaveBeenCalledTimes(2);
  });

  it("propagates a timeout signal to the model handler", async () => {
    const handleSingleModel = vi.fn(async (_body, model, opts) => {
      if (model === "openai/gpt-4o") {
        return new Promise((resolve, reject) => {
          const timer = setTimeout(() => resolve(okResponse("slow", "conn-slow")), 10_000);
          opts?.signal?.addEventListener("abort", () => {
            clearTimeout(timer);
            reject(new Error("aborted by combo timeout"));
          }, { once: true });
        });
      }
      return okResponse("hello from gemini", "conn-gemini-ok");
    });

    const res = await handleComboChat({
      body: { messages: [{ role: "user", content: "hi" }] },
      models: ["openai/gpt-4o", "gemini/gemini-1.5-flash"],
      handleSingleModel,
      log,
      comboName: "test-combo",
      comboStrategy: "fallback",
      timeoutMs: 50,
    });

    expect(res.ok).toBe(true);
    expect(handleSingleModel).toHaveBeenCalledTimes(2);
  });

  it("aborts the current target when the external signal is aborted", async () => {
    const controller = new AbortController();
    const handleSingleModel = vi.fn(async (_body, model, opts) => {
      if (model === "openai/gpt-4o") {
        return new Promise((resolve, reject) => {
          const timer = setTimeout(() => resolve(okResponse("slow", "conn-slow")), 10_000);
          opts?.signal?.addEventListener("abort", () => {
            clearTimeout(timer);
            reject(new Error("aborted by client"));
          }, { once: true });
        });
      }
      return okResponse("should not be reached", "conn-other");
    });

    const promise = handleComboChat({
      body: { messages: [{ role: "user", content: "hi" }] },
      models: ["openai/gpt-4o", "gemini/gemini-1.5-flash"],
      handleSingleModel,
      log,
      comboName: "test-combo",
      comboStrategy: "fallback",
      signal: controller.signal,
      timeoutMs: 10_000,
    });

    setTimeout(() => controller.abort(), 50);

    const res = await promise;
    expect(res.status).toBe(499);
  });

  it("returns a 524 when every combo model times out", async () => {
    const handleSingleModel = vi.fn(async () => new Promise(() => {}));

    const res = await handleComboChat({
      body: { messages: [{ role: "user", content: "hi" }] },
      models: ["openai/gpt-4o", "gemini/gemini-1.5-flash"],
      handleSingleModel,
      log,
      comboName: "test-combo",
      comboStrategy: "fallback",
      timeoutMs: 50,
    });

    expect(res.ok).toBe(false);
    expect(res.status).toBe(524);
    expect(handleSingleModel).toHaveBeenCalledTimes(2);
  });

  it("falls back after a non-final empty 200 and returns the next response", async () => {
    const empty = new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "" }, finish_reason: "incomplete" }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
    const handleSingleModel = vi.fn(async (_body, model) =>
      model === "openai/empty" ? empty : okResponse("backup answer", "conn-backup"));

    const result = await handleComboChat({
      body: { messages: [{ role: "user", content: "hi" }] },
      models: ["openai/empty", "gemini/gemini-1.5-flash"],
      handleSingleModel,
      log,
      comboName: "empty-content-fallback",
      comboStrategy: "fallback",
    });

    expect(result.ok).toBe(true);
    expect(await result.json()).toMatchObject({ choices: [{ message: { content: "backup answer" } }] });
    expect(handleSingleModel).toHaveBeenCalledTimes(2);
  });

  it("keeps the final seat's empty 200 response", async () => {
    const empty = new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "" } }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
    const handleSingleModel = vi.fn(async () => empty);

    const result = await handleComboChat({
      body: { messages: [{ role: "user", content: "hi" }] },
      models: ["openai/only"],
      handleSingleModel,
      log,
      comboName: "empty-final-seat",
      comboStrategy: "fallback",
    });

    expect(result).toBe(empty);
    expect(handleSingleModel).toHaveBeenCalledTimes(1);
  });

  it("detects empty JSON chat and Anthropic responses but preserves valid tool calls", () => {
    expect(isZeroContentResponse({ choices: [] })).toBe(true);
    expect(isZeroContentResponse({ choices: [{ message: { content: " " } }] })).toBe(true);
    expect(isZeroContentResponse({ choices: [{ message: { tool_calls: [{ id: "call_1" }] }, finish_reason: "tool_calls" }] })).toBe(false);
    expect(isZeroContentResponse({ content: [], stop_reason: "in_progress" })).toBe(true);
    expect(isZeroContentResponse({ content: [{ type: "tool_use" }], stop_reason: "tool_use" })).toBe(false);
    expect(isZeroContentResponse({ candidates: [] })).toBe(false);
  });

  it("passes maxQueueSize through to the model handler", async () => {
    const handleSingleModel = vi.fn(async (_body, model, opts) => {
      if (model === "openai/gpt-4o") {
        expect(opts?.maxQueueSize).toBe(0);
        return errResponse(429, "rate limit", "conn-a");
      }
      expect(opts?.maxQueueSize).toBe(0);
      return okResponse("hello", "conn-b");
    });

    const res = await handleComboChat({
      body: { messages: [{ role: "user", content: "hi" }] },
      models: ["openai/gpt-4o", "gemini/gemini-1.5-flash"],
      handleSingleModel,
      log,
      comboName: "test-combo",
      comboStrategy: "fallback",
      queueDepth: 0,
    });

    expect(res.ok).toBe(true);
    expect(handleSingleModel).toHaveBeenCalledTimes(2);
  });
});
