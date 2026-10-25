import { EventEmitter } from "events";
import http2 from "http2";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearCursorModelCache,
  mergeCursorModelFlags,
  parseCursorAvailableModels,
  parseCursorUsableModels,
  resolveAutoModelSelection,
  resolveCursorModels,
} from "../../open-sse/services/cursorModels.js";

function createMockHttp2Session({ status = 200, body = Buffer.alloc(0), error = null } = {}) {
  const client = new EventEmitter();
  client.close = vi.fn();
  client.request = vi.fn((reqHeaders) => {
    const stream = new EventEmitter();
    stream.reqHeaders = reqHeaders;
    stream.end = vi.fn(() => {
      queueMicrotask(() => {
        if (error) {
          stream.emit("error", error);
        } else {
          stream.emit("response", { ":status": status });
          if (body && body.length) {
            stream.emit("data", Buffer.from(body));
          }
          stream.emit("end");
        }
      });
    });
    return stream;
  });
  return client;
}

function varint(value) {
  const bytes = [];
  while (value >= 0x80) {
    bytes.push((value & 0x7f) | 0x80);
    value >>>= 7;
  }
  bytes.push(value);
  return Uint8Array.from(bytes);
}

function field(fieldNumber, value) {
  return Uint8Array.from([(fieldNumber << 3) | 2, ...varint(value.length), ...value]);
}

function boolField(fieldNumber, value) {
  return Uint8Array.from([(fieldNumber << 3), ...varint(value ? 1 : 0)]);
}

function text(value) {
  return new TextEncoder().encode(value);
}

function concat(...parts) {
  const size = parts.reduce((sum, part) => sum + part.length, 0);
  const result = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

function model(id, name) {
  return field(1, concat(field(1, text(id)), field(4, text(name))));
}

function availableModel(id, { defaultOn = false, chatOnly = false, agent = true, hidden = false } = {}) {
  return field(2, concat(
    field(1, text(id)),
    boolField(2, defaultOn),
    boolField(4, chatOnly),
    boolField(5, agent),
    boolField(35, hidden),
  ));
}

describe("Cursor live model catalog", () => {
  beforeEach(() => {
    clearCursorModelCache();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    clearCursorModelCache();
  });

  it("decodes the GetUsableModels protobuf response", () => {
    const payload = concat(
      model("default", "Auto"),
      model("gpt-5.3-codex", "GPT 5.3 Codex"),
      model("gpt-5.3-codex", "Duplicate"),
    );

    expect(parseCursorUsableModels(payload)).toEqual([
      { id: "default", name: "Auto" },
      { id: "gpt-5.3-codex", name: "GPT 5.3 Codex" },
    ]);
  });

  it("fetches the account-specific catalog and caches it", async () => {
    const payload = concat(model("claude-4.6-opus", "Claude 4.6 Opus"));
    const mockSession = createMockHttp2Session({ status: 200, body: payload });
    const connectSpy = vi.spyOn(http2, "connect").mockReturnValue(mockSession);

    const credentials = {
      accessToken: "cursor-token",
      providerSpecificData: { machineId: "machine-id" },
    };

    await expect(resolveCursorModels(credentials)).resolves.toEqual({
      models: [{ id: "claude-4.6-opus", name: "Claude 4.6 Opus" }],
    });
    await expect(resolveCursorModels(credentials)).resolves.toEqual({
      models: [{ id: "claude-4.6-opus", name: "Claude 4.6 Opus" }],
    });

    expect(connectSpy).toHaveBeenCalledTimes(1);
    expect(connectSpy).toHaveBeenCalledWith("https://agent.api5.cursor.sh");
    expect(mockSession.request).toHaveBeenCalledWith(
      expect.objectContaining({
        ":method": "POST",
        ":path": "/agent.v1.AgentService/GetUsableModels",
        ":authority": "agent.api5.cursor.sh",
        ":scheme": "https",
        "content-type": "application/proto",
        accept: "application/proto",
      }),
    );
  });

  it("parses and merges AvailableModels flags", () => {
    const payload = concat(
      model("claude-4.6-opus", "Claude 4.6 Opus"),
      availableModel("claude-4.6-opus", { defaultOn: true }),
      availableModel("chat-model", { chatOnly: true, agent: false }),
    );
    const models = parseCursorUsableModels(payload);
    expect(parseCursorAvailableModels(payload)).toMatchObject([
      { id: "claude-4.6-opus", defaultOn: true, supportsAgent: true },
      { id: "chat-model", isChatOnly: true, supportsAgent: false },
    ]);
    expect(mergeCursorModelFlags(models, payload)).toMatchObject([
      { id: "claude-4.6-opus", supportsAgent: true, defaultOn: true },
    ]);
  });

  it("prefers the default agent-capable model and skips chat-only or hidden models", () => {
    expect(resolveAutoModelSelection([
      { id: "chat-only", supportsAgent: false, defaultOn: true },
      { id: "hidden", supportsAgent: true, isHidden: true, defaultOn: true },
      { id: "default-agent", supportsAgent: true, defaultOn: true },
      { id: "other-agent", supportsAgent: true },
    ])).toEqual({ modelId: "default-agent", matchedBy: "auto-default" });
    expect(resolveAutoModelSelection([{ id: "fallback", supportsAgent: true }])).toEqual({
      modelId: "fallback",
      matchedBy: "auto-default",
    });
    expect(resolveAutoModelSelection([{ id: "chat-only", supportsAgent: false }])).toBeNull();
  });

  it("fails open when the Cursor catalog request fails", async () => {
    const mockSession = createMockHttp2Session({ status: 403 });
    vi.spyOn(http2, "connect").mockReturnValue(mockSession);

    await expect(resolveCursorModels({
      accessToken: "cursor-token",
      providerSpecificData: { machineId: "machine-id" },
    })).resolves.toBeNull();
  });
});
