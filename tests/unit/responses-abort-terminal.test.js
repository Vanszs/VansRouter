import { describe, expect, it } from "vitest";

import { createDisconnectAwareStream, pipeWithDisconnect } from "../../open-sse/utils/streamHandler.js";
import { buildAbortedResponsesTerminalBytes } from "../../open-sse/utils/responsesStreamHelpers.js";
import { buildStreamErrorBytes } from "../../open-sse/utils/streamHelpers.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

// Minimal stream controller stub
function makeController() {
  let connected = true;
  return {
    signal: new AbortController().signal,
    startTime: Date.now(),
    isConnected: () => connected,
    handleComplete: () => { connected = false; },
    handleError: () => { connected = false; },
    handleDisconnect: () => { connected = false; },
    abort: () => { connected = false; },
  };
}

async function readAll(stream) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let text = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
  }
  text += decoder.decode();
  return text;
}

describe("Responses abort terminal synthesis", () => {
  it("emits response.failed + [DONE] when upstream errors (abort/stall)", async () => {
    // Upstream readable that errors mid-stream (simulates fetch abort on stall)
    const upstream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("event: response.created\ndata: {}\n\n"));
        controller.error(new Error("stream stall timeout"));
      },
    });

    const out = createDisconnectAwareStream(
      { readable: upstream, writable: { getWriter: () => ({ abort: () => Promise.resolve() }) } },
      makeController(),
      buildAbortedResponsesTerminalBytes
    );

    const text = await readAll(out);
    expect(text).toContain("event: response.failed");
    expect(text).toContain("data: [DONE]");
  });

  it("does not synthesize terminal for non-Responses streams (callback null)", async () => {
    const upstream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("data: hi\n\n"));
        controller.error(new Error("socket hang up"));
      },
    });

    const out = createDisconnectAwareStream(
      { readable: upstream, writable: { getWriter: () => ({ abort: () => Promise.resolve() }) } },
      makeController(),
      null
    );

    const text = await readAll(out);
    expect(text).not.toContain("response.failed");
    expect(text).not.toContain("[DONE]");
  });

  it("emits an in-band error frame + [DONE] for an OpenAI client when the upstream aborts", async () => {
    const upstream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"hi"}}]}\n\n'));
        controller.error(new Error("socket hang up"));
      },
    });

    const out = pipeWithDisconnect(
      new Response(upstream, { status: 200 }),
      new TransformStream(),
      makeController(),
      (message) => buildStreamErrorBytes(504, message, FORMATS.OPENAI),
      60_000
    );

    const text = await readAll(out);
    expect(text).toContain('"error"');
    expect(text).toContain("upstream connection lost");
    // Error frame first, [DONE] after — and never a synthetic clean finish_reason.
    expect(text.indexOf('"error"')).toBeLessThan(text.indexOf("data: [DONE]"));
    expect(text).not.toContain("finish_reason");
  });

  it("frames the abort as `event: error` for Claude clients", async () => {
    const stream = createDisconnectAwareStream(
      {
        readable: new ReadableStream({
          start(controller) {
            controller.error(new Error("stream stall timeout"));
          },
        }),
        writable: { getWriter: () => ({ abort: () => Promise.resolve() }) },
      },
      makeController(),
      (message) => buildStreamErrorBytes(504, message, FORMATS.CLAUDE)
    );

    const text = await readAll(stream);
    expect(text).toContain("event: error");
    expect(text).toContain('"type":"server_error"');
    expect(text).not.toContain("[DONE]");
  });
});
