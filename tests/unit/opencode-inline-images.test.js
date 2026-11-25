// Offline end-to-end guard for the OpenCode inline-image requirement.
//
// Drives the REAL handleChatCore (source detection → prefetch → translation →
// executor dispatch); only the executor's HTTP call is mocked. Asserts on the
// body that would actually be sent upstream: OpenCode Go accepts text and
// inline (base64 data URL) images only, so any surviving http(s) image URL is a
// production 400 [unsupported_media].
import { describe, it, expect, vi, beforeEach } from "vitest";

const { executeMock, fetchMock } = vi.hoisted(() => ({
  executeMock: vi.fn(),
  fetchMock: vi.fn(async () => ({
    url: "data:image/png;base64,QUJD",
    mimeType: "image/png",
  })),
}));

vi.mock("../../open-sse/executors/index.js", () => ({
  getExecutor: () => ({ noAuth: true, execute: executeMock }),
}));

vi.mock("../../open-sse/utils/requestLogger.js", () => ({
  createRequestLogger: async () => ({
    logClientRawRequest: vi.fn(),
    logRawRequest: vi.fn(),
    logTargetRequest: vi.fn(),
    logProviderResponse: vi.fn(),
    logConvertedResponse: vi.fn(),
    logError: vi.fn(),
  }),
}));

vi.mock("../../open-sse/utils/stream.js", () => ({
  COLORS: { red: "", reset: "" },
  createPassthroughStreamWithLogger: vi.fn(() => new TransformStream()),
}));

vi.mock("uuid", () => ({
  v4: () => "00000000-0000-4000-8000-000000000000",
}));

vi.mock("@/lib/usageDb.js", () => ({
  trackPendingRequest: vi.fn(),
  appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
  saveRequestUsage: vi.fn(async () => {}),
}));

vi.mock("../../open-sse/translator/concerns/image.js", async (orig) => {
  const actual = await orig();
  return { ...actual, fetchImageAsBase64: fetchMock };
});

const { handleChatCore } = await import("../../open-sse/handlers/chatCore.js");

const MODEL = "deepseek-v4.1-flash";
const REMOTE = "https://cdn.example.com/cat.png";

const COMPLETION = {
  id: "chatcmpl-1",
  object: "chat.completion",
  model: "test",
  choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
  usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
};

// The free lane declares forceStream: the upstream always answers in SSE, so
// the mocked executor has to answer in the same shape.
const SSE_COMPLETION = `data: ${JSON.stringify(COMPLETION)}\n\ndata: [DONE]\n\n`;

const chatBody = () => ({
  model: `opencode-go/${MODEL}`,
  stream: false,
  messages: [{
    role: "user",
    content: [
      { type: "text", text: "what is this?" },
      { type: "image_url", image_url: { url: REMOTE } },
    ],
  }],
});

const responsesBody = () => ({
  model: `opencode-go/${MODEL}`,
  stream: false,
  input: [{
    type: "message",
    role: "user",
    content: [
      { type: "input_text", text: "what is this?" },
      { type: "input_image", image_url: REMOTE },
    ],
  }],
});

const claudeBody = () => ({
  model: `opencode-go/${MODEL}`,
  stream: false,
  max_tokens: 16,
  messages: [{
    role: "user",
    content: [
      { type: "text", text: "what is this?" },
      { type: "image", source: { type: "url", url: REMOTE } },
    ],
  }],
});

async function run({ provider = "opencode-go", model = MODEL, body, sourceFormat, sse = false }) {
  executeMock.mockImplementationOnce(async ({ body: outbound }) => ({
    response: new Response(sse ? SSE_COMPLETION : JSON.stringify(COMPLETION), {
      status: 200,
      headers: { "content-type": sse ? "text/event-stream" : "application/json" },
    }),
    url: "https://opencode.ai/inference/go/openai/v1/chat/completions",
    headers: {},
    transformedBody: null,
    outbound,
  }));
  const result = await handleChatCore({
    body,
    modelInfo: { provider, model },
    credentials: { apiKey: "test-key", providerSpecificData: {} },
    connectionId: "inline-image-test",
    sourceFormatOverride: sourceFormat,
    log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn() },
  });
  return { result, outbound: executeMock.mock.calls.at(-1)[0].body };
}

// Collect every image reference that survived into the outbound body. Covers
// all three wire shapes VansRouter can dispatch: OpenAI image_url, Responses
// input_image, and Claude image source. The Claude lane stays inline base64
// rather than a data URL, which OpenCode also accepts.
function collectOutboundImages(body) {
  const urls = [];
  const pushClaude = (block) => {
    if (block?.source?.type === "url") urls.push(block.source.url);
    else if (block?.source?.type === "base64") {
      urls.push(`data:${block.source.media_type};base64,${block.source.data}`);
    }
  };
  for (const msg of body?.messages || []) {
    if (!Array.isArray(msg.content)) continue;
    for (const block of msg.content) {
      if (block?.type === "image_url") {
        urls.push(typeof block.image_url === "string" ? block.image_url : block.image_url?.url);
      }
      if (block?.type === "image") pushClaude(block);
    }
  }
  for (const item of body?.input || []) {
    if (!Array.isArray(item?.content)) continue;
    for (const block of item.content) {
      if (block?.type === "input_image") urls.push(block.image_url?.url || block.image_url);
    }
  }
  return urls.filter(Boolean);
}

const outboundImages = (body) => collectOutboundImages(body);
const remoteOutboundImages = (body) => collectOutboundImages(body).filter((u) => /^https?:\/\//.test(u));

beforeEach(() => {
  executeMock.mockReset();
  fetchMock.mockClear();
});

describe("OpenCode Go inline images (real handleChatCore)", () => {
  it("converts an OpenAI chat image_url before dispatch", async () => {
    const { result, outbound } = await run({ body: chatBody(), sourceFormat: "openai" });
    expect(result.success).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(remoteOutboundImages(outbound)).toEqual([]);
    expect(outboundImages(outbound)).toHaveLength(1);
  });

  it("converts a nested Responses input_image before dispatch", async () => {
    const { result, outbound } = await run({ body: responsesBody(), sourceFormat: "openai-responses" });
    expect(result.success).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(remoteOutboundImages(outbound)).toEqual([]);
    expect(outboundImages(outbound)).toHaveLength(1);
  });

  it("converts a Claude URL image instead of dropping it", async () => {
    const { result, outbound } = await run({ body: claudeBody(), sourceFormat: "claude" });
    expect(result.success).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(remoteOutboundImages(outbound)).toEqual([]);
    expect(outboundImages(outbound)).toHaveLength(1);
  });

  it("converts OpenAI chat images on the free OpenCode lane too", async () => {
    const body = chatBody();
    body.model = `opencode/${MODEL}-free`;
    const { result, outbound } = await run({
      provider: "opencode",
      model: `${MODEL}-free`,
      body,
      sourceFormat: "openai",
      sse: true,
    });
    expect(result.success).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(remoteOutboundImages(outbound)).toEqual([]);
    expect(outboundImages(outbound)).toHaveLength(1);
  });

  it("keeps the request text-only when a history image cannot be fetched", async () => {
    fetchMock.mockResolvedValueOnce(null);
    const { result, outbound } = await run({ body: chatBody(), sourceFormat: "openai" });
    expect(result.success).toBe(true);
    expect(remoteOutboundImages(outbound)).toEqual([]);
    expect(outboundImages(outbound)).toEqual([]);
    expect(JSON.stringify(outbound)).toContain("[image omitted");
  });

  it("normalizes bare base64 images before dispatch", async () => {
    const body = chatBody();
    body.messages[0].content[1].image_url.url =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    const { result, outbound } = await run({ body, sourceFormat: "openai" });
    expect(result.success).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(outboundImages(outbound)[0].startsWith("data:image/png;base64,")).toBe(true);
  });

  it("leaves an already-inline data URL untouched and does not fetch it", async () => {
    const body = chatBody();
    body.messages[0].content[1].image_url.url = "data:image/png;base64,QUJD";
    const { result, outbound } = await run({ body, sourceFormat: "openai" });
    expect(result.success).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(outboundImages(outbound)[0]).toBe("data:image/png;base64,QUJD");
  });

  it("does not force inline conversion for providers that accept remote URLs", async () => {
    const body = chatBody();
    body.model = `openai/${MODEL}`;
    const { result, outbound } = await run({ provider: "openai", body, sourceFormat: "openai" });
    expect(result.success).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(remoteOutboundImages(outbound)).toEqual([REMOTE]);
  });
});
