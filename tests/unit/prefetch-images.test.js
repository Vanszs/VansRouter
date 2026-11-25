import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../open-sse/translator/concerns/image.js", async (orig) => {
  const actual = await orig();
  return {
    ...actual,
    fetchImageAsBase64: vi.fn(async () => ({ url: "data:image/png;base64,QUJD", mimeType: "image/png" })),
  };
});

import { prefetchRemoteImages } from "../../open-sse/translator/concerns/prefetch.js";
import { fetchImageAsBase64 } from "../../open-sse/translator/concerns/image.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { PROVIDERS } from "../../open-sse/config/providers.js";

beforeEach(() => { fetchImageAsBase64.mockClear(); });
afterEach(() => { vi.restoreAllMocks(); });

describe("prefetchRemoteImages", () => {
  it("no-op for targets that accept remote URLs (openai)", async () => {
    const body = { messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: "https://x/a.png" } }] }] };
    const n = await prefetchRemoteImages(body, FORMATS.OPENAI, FORMATS.OPENAI);
    expect(n).toBe(0);
    expect(body.messages[0].content[0].image_url.url).toBe("https://x/a.png");
  });

  it("openai source -> ollama target: converts remote URL to base64", async () => {
    const body = { messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: "https://x/a.png" } }] }] };
    const n = await prefetchRemoteImages(body, FORMATS.OPENAI, FORMATS.OLLAMA);
    expect(n).toBe(1);
    expect(body.messages[0].content[0].image_url.url.startsWith("data:image/png;base64,")).toBe(true);
  });

  it("force converts remote URLs for an openai target (OpenCode Go)", async () => {
    const body = { messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: "https://x/a.png" } }] }] };
    const n = await prefetchRemoteImages(body, FORMATS.OPENAI, FORMATS.OPENAI, { force: true });
    expect(n).toBe(1);
    expect(body.messages[0].content[0].image_url.url.startsWith("data:image/png;base64,")).toBe(true);
  });

  it("force converts nested Responses input_image content parts", async () => {
    const body = {
      input: [
        { type: "message", role: "user", content: [
          { type: "input_text", text: "what is this?" },
          { type: "input_image", image_url: "https://x/a.png" },
        ] },
        { type: "message", role: "user", content: "plain text" },
      ],
    };
    const n = await prefetchRemoteImages(body, FORMATS.OPENAI_RESPONSES, FORMATS.OPENAI_RESPONSES, { force: true });
    expect(n).toBe(1);
    expect(body.input[0].content[1].image_url.startsWith("data:image/png;base64,")).toBe(true);
  });

  it("skips data URI (already inline)", async () => {
    const body = { messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: "data:image/png;base64,xx" } }] }] };
    const n = await prefetchRemoteImages(body, FORMATS.OPENAI, FORMATS.OLLAMA);
    expect(n).toBe(0);
    expect(fetchImageAsBase64).not.toHaveBeenCalled();
  });

  it("gemini source -> gemini target: fileData URL -> inlineData base64", async () => {
    const body = { contents: [{ role: "user", parts: [
      { fileData: { mimeType: "image/png", fileUri: "https://x/a.png" } },
    ] }] };
    const n = await prefetchRemoteImages(body, FORMATS.GEMINI, FORMATS.GEMINI);
    expect(n).toBe(1);
    expect(body.contents[0].parts[0].inlineData).toBeTruthy();
    expect(body.contents[0].parts[0].fileData).toBeUndefined();
  });

  it("claude source -> kiro target: source.url -> base64", async () => {
    const body = { messages: [{ role: "user", content: [
      { type: "image", source: { type: "url", url: "https://x/a.png" } },
    ] }] };
    const n = await prefetchRemoteImages(body, FORMATS.CLAUDE, FORMATS.KIRO);
    expect(n).toBe(1);
    expect(body.messages[0].content[0].source.type).toBe("base64");
  });

  it("openai source -> commandcode target: converts remote URL to base64", async () => {
    const body = { messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: "https://x/a.png" } }] }] };
    const n = await prefetchRemoteImages(body, FORMATS.OPENAI, FORMATS.COMMANDCODE);
    expect(n).toBe(1);
    expect(body.messages[0].content[0].image_url.url.startsWith("data:image/png;base64,")).toBe(true);
    expect(fetchImageAsBase64).toHaveBeenCalled();
  });

  it("claude source -> commandcode target: source.url -> base64", async () => {
    const body = { messages: [{ role: "user", content: [
      { type: "image", source: { type: "url", url: "https://x/a.png" } },
    ] }] };
    const n = await prefetchRemoteImages(body, FORMATS.CLAUDE, FORMATS.COMMANDCODE);
    expect(n).toBe(1);
    expect(body.messages[0].content[0].source.type).toBe("base64");
  });
});

describe("forced inline images (OpenCode)", () => {
  const TINY_PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

  it("drops an unfetchable remote image instead of leaving a URL the upstream rejects", async () => {
    fetchImageAsBase64.mockResolvedValueOnce(null);
    const onDrop = vi.fn();
    const body = { messages: [{ role: "user", content: [
      { type: "text", text: "hi" },
      { type: "image_url", image_url: { url: "https://blocked.example/a.png" } },
    ] }] };
    const n = await prefetchRemoteImages(body, FORMATS.OPENAI, FORMATS.OPENAI, {
      force: true, onDrop,
    });
    expect(n).toBe(0);
    expect(body.messages[0].content[1]).toEqual({
      type: "text",
      text: expect.stringContaining("[image omitted"),
    });
    expect(onDrop).toHaveBeenCalledWith({ reason: "fetch-failed" });
  });

  it("drops a local file path that cannot be inlined", async () => {
    const onDrop = vi.fn();
    const body = { messages: [{ role: "user", content: [
      { type: "image_url", image_url: { url: "file:///tmp/shot.png" } },
    ] }] };
    const n = await prefetchRemoteImages(body, FORMATS.OPENAI, FORMATS.OPENAI, {
      force: true, onDrop,
    });
    expect(n).toBe(0);
    expect(fetchImageAsBase64).not.toHaveBeenCalled();
    expect(body.messages[0].content[0].type).toBe("text");
    expect(onDrop).toHaveBeenCalledWith({ reason: "invalid-url" });
  });

  it("normalizes bare base64 into a data URL", async () => {
    const body = { messages: [{ role: "user", content: [
      { type: "image_url", image_url: { url: TINY_PNG } },
    ] }] };
    const n = await prefetchRemoteImages(body, FORMATS.OPENAI, FORMATS.OPENAI, { force: true });
    expect(n).toBe(1);
    expect(fetchImageAsBase64).not.toHaveBeenCalled();
    expect(body.messages[0].content[0].image_url.url).toBe(`data:image/png;base64,${TINY_PNG}`);
  });

  it("drops a non-image data URI parked in an image slot", async () => {
    const onDrop = vi.fn();
    const body = { messages: [{ role: "user", content: [
      { type: "image_url", image_url: { url: "data:application/pdf;base64,JVBERi0=" } },
    ] }] };
    const n = await prefetchRemoteImages(body, FORMATS.OPENAI, FORMATS.OPENAI, {
      force: true, onDrop,
    });
    expect(n).toBe(0);
    expect(onDrop).toHaveBeenCalledWith({ reason: "not-an-image" });
    expect(body.messages[0].content[0].type).toBe("text");
  });

  it("drops an unfetchable image when the target needs inline", async () => {
    fetchImageAsBase64.mockResolvedValueOnce(null);
    const body = { messages: [{ role: "user", content: [
      { type: "image_url", image_url: { url: "https://x/a.png" } },
    ] }] };
    const n = await prefetchRemoteImages(body, FORMATS.OPENAI, FORMATS.OLLAMA);
    expect(n).toBe(0);
    expect(body.messages[0].content[0].type).toBe("text");
  });
});

describe("image URL validation for every target", () => {
  const TINY_PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

  it("keeps a normal https URL without fetching it for Codex", async () => {
    const body = { messages: [{ role: "user", content: [
      { type: "image_url", image_url: { url: "https://x/a.png" } },
    ] }] };
    const n = await prefetchRemoteImages(body, FORMATS.OPENAI, FORMATS.OPENAI_RESPONSES, {});
    expect(n).toBe(0);
    expect(fetchImageAsBase64).not.toHaveBeenCalled();
    expect(body.messages[0].content[0].image_url.url).toBe("https://x/a.png");
  });

  it("drops a file path instead of sending it to Codex", async () => {
    const onDrop = vi.fn();
    const body = { messages: [{ role: "user", content: [
      { type: "image_url", image_url: { url: "file:///tmp/shot.png" } },
    ] }] };
    const n = await prefetchRemoteImages(body, FORMATS.OPENAI, FORMATS.OPENAI_RESPONSES, {
      onDrop,
    });
    expect(n).toBe(0);
    expect(body.messages[0].content[0]).toEqual({ type: "text", text: expect.stringContaining("[image omitted") });
    expect(onDrop).toHaveBeenCalledWith({ reason: "invalid-url" });
  });

  it("wraps bare base64 for a normal URL target", async () => {
    const body = { messages: [{ role: "user", content: [
      { type: "image_url", image_url: { url: TINY_PNG } },
    ] }] };
    const n = await prefetchRemoteImages(body, FORMATS.OPENAI, FORMATS.OPENAI_RESPONSES, {});
    expect(n).toBe(1);
    expect(body.messages[0].content[0].image_url.url).toBe(`data:image/png;base64,${TINY_PNG}`);
  });

  it("compacts whitespace in a data URL", async () => {
    const body = { messages: [{ role: "user", content: [
      { type: "image_url", image_url: { url: `data:image/png;base64,${TINY_PNG.slice(0, 20)}\n${TINY_PNG.slice(20)}` } },
    ] }] };
    const n = await prefetchRemoteImages(body, FORMATS.OPENAI, FORMATS.OPENAI_RESPONSES, {});
    expect(n).toBe(1);
    expect(body.messages[0].content[0].image_url.url).toBe(`data:image/png;base64,${TINY_PNG}`);
  });

  it("drops a malformed http URL and an empty data URL", async () => {
    const onDrop = vi.fn();
    const body = { messages: [{ role: "user", content: [
      { type: "image_url", image_url: { url: "https://" } },
      { type: "image_url", image_url: { url: "data:image/png;base64," } },
    ] }] };
    await prefetchRemoteImages(body, FORMATS.OPENAI, FORMATS.OPENAI_RESPONSES, {
      onDrop,
    });
    expect(onDrop.mock.calls.map(([a]) => a.reason)).toEqual(["invalid-url", "invalid-data-uri"]);
    expect(body.messages[0].content.every((b) => b.type === "text")).toBe(true);
  });

  it("drops an image_url object that carries no URL at all", async () => {
    const body = { messages: [{ role: "user", content: [
      { type: "image_url", image_url: {} },
    ] }] };
    await prefetchRemoteImages(body, FORMATS.OPENAI, FORMATS.OPENAI_RESPONSES, {});
    expect(body.messages[0].content[0].type).toBe("text");
  });

  it("preserves gs:// only for Gemini-family targets", async () => {
    const gemini = { contents: [{ parts: [{ fileData: { fileUri: "gs://bucket/x.png", mimeType: "image/png" } }] }] };
    expect(await prefetchRemoteImages(gemini, FORMATS.GEMINI, FORMATS.GEMINI, {})).toBe(0);
    expect(gemini.contents[0].parts[0].fileData.fileUri).toBe("gs://bucket/x.png");

    const openai = { messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: "gs://bucket/x.png" } }] }] };
    await prefetchRemoteImages(openai, FORMATS.OPENAI, FORMATS.OPENAI_RESPONSES, {});
    expect(openai.messages[0].content[0].type).toBe("text");
  });
});

describe("provider inline-image quirk", () => {
  it("declares it for both OpenCode lanes", () => {
    expect(PROVIDERS.opencode?.quirks?.requiresInlineImages).toBe(true);
    expect(PROVIDERS["opencode-go"]?.quirks?.requiresInlineImages).toBe(true);
  });
});
