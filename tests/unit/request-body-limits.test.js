import { describe, expect, it } from "vitest";

// Guardrails: oversized bodies are rejected before parse, and the synchronous
// RTK pass is skipped above the size threshold.
process.env.NINEROUTER_MAX_BODY_BYTES = "1000";
const { handleChat } = await import("../../src/sse/handlers/chat.js");
const { compressMessages, RTK_MAX_BODY_BYTES } = await import("../../open-sse/rtk/index.js");

describe("request body ceiling (#132)", () => {
  it("rejects an oversized chat body with 413 before parsing", async () => {
    const request = new Request("http://localhost:20128/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "x/y", messages: [{ role: "user", content: "a".repeat(4000) }] }),
    });
    const response = await handleChat(request);
    expect(response.status).toBe(413);
    const payload = await response.json();
    expect(payload.error.message).toContain("too large");
  });

  it("lets a body under the ceiling reach normal handling", async () => {
    const request = new Request("http://localhost:20128/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "x/y", messages: [{ role: "user", content: "hi" }] }),
    });
    const response = await handleChat(request);
    expect(response.status).not.toBe(413);
  });

  it("still rejects malformed JSON with 400", async () => {
    const request = new Request("http://localhost:20128/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{not json",
    });
    const response = await handleChat(request);
    expect(response.status).toBe(400);
  });
});

describe("RTK size threshold (#132)", () => {
  const toolResult = (text) => ({
    messages: [{ role: "tool", content: text }],
  });

  it("skips compression when the body exceeds the threshold", () => {
    const body = toolResult("line\n".repeat(Math.ceil(RTK_MAX_BODY_BYTES / 5) + 100));
    expect(compressMessages(body, true)).toBe(null);
  });

  it("still compresses a small body", () => {
    const body = toolResult("src/app.js:12:  const value = 1;\n".repeat(40));
    const stats = compressMessages(body, true);
    expect(stats).not.toBe(null);
    expect(stats.hits.length).toBeGreaterThan(0);
  });
});
