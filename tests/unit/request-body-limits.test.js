import { describe, expect, it } from "vitest";

// Guardrails: oversized bodies are rejected before parse, and the synchronous
// RTK pass is skipped above the size threshold.
process.env.NINEROUTER_MAX_BODY_BYTES = "508";
const { handleChat } = await import("../../src/sse/handlers/chat.js");
const { POST: responsesPost } = await import("../../src/app/api/v1/responses/route.js");
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

  it("rejects a UTF-8 body whose bytes exceed the ceiling despite a shorter JS length", async () => {
    const content = "é".repeat(450);
    const body = JSON.stringify({ model: "x/y", messages: [{ role: "user", content }] });
    expect(body.length).toBeLessThan(508);
    expect(Buffer.byteLength(body, "utf8")).toBeGreaterThan(508);

    const request = new Request("http://localhost:20128/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
    const response = await handleChat(request);
    expect(response.status).toBe(413);
  });

  it("rejects an oversized chunked body that never declares a Content-Length", async () => {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("a".repeat(2000)));
        controller.close();
      },
    });
    const request = new Request("http://localhost:20128/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: stream,
      duplex: "half",
    });
    expect(request.headers.get("content-length")).toBe(null);
    const response = await handleChat(request);
    expect(response.status).toBe(413);
  });

  it("rejects an oversized body through the Responses wrapper route", async () => {
    const request = new Request("http://localhost:20128/v1/responses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "x/y", input: "a".repeat(4000) }),
    });
    const response = await responsesPost(request);
    expect(response.status).toBe(413);
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

describe("bounded body reader", () => {
  it("stops pulling the stream once the ceiling is crossed instead of buffering it whole", async () => {
    const { readBoundedJson } = await import("../../src/sse/utils/boundedBody.js");
    let pulls = 0;
    const stream = new ReadableStream({
      pull(controller) {
        pulls++;
        if (pulls > 50) return controller.close();
        controller.enqueue(new TextEncoder().encode("a".repeat(600)));
      },
    });
    const request = new Request("http://localhost:20128/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: stream,
      duplex: "half",
    });

    const { error } = await readBoundedJson(request, 508);

    expect(error.status).toBe(413);
    // request.text() drained all 51 chunks before the size check; the bounded read
    // cancels as soon as the running count is over the limit.
    expect(pulls).toBeLessThan(5);
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

  it("skips an oversized body before reading it when bytes are known", () => {
    let reads = 0;
    const body = new Proxy({}, {
      get() {
        reads++;
        throw new Error("body read");
      },
    });
    expect(compressMessages(body, true, RTK_MAX_BODY_BYTES + 1)).toBe(null);
    expect(reads).toBe(0);
  });

  it("reads a body when an explicit small size allows compression", () => {
    let reads = 0;
    const body = new Proxy(toolResult("src/app.js:12:  const value = 1;\n".repeat(40)), {
      get(target, property, receiver) {
        reads++;
        return Reflect.get(target, property, receiver);
      },
    });
    expect(compressMessages(body, true, 1)).not.toBe(null);
    expect(reads).toBeGreaterThan(0);
  });

  it("still compresses a small body", () => {
    const body = toolResult("src/app.js:12:  const value = 1;\n".repeat(40));
    const stats = compressMessages(body, true);
    expect(stats).not.toBe(null);
    expect(stats.hits.length).toBeGreaterThan(0);
  });
});
