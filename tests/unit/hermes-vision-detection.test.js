import { describe, it, expect } from "vitest";
import { detectRequiredCapabilities } from "../../open-sse/services/combo.js";
import { augmentModelsWithCapacityAdapter, getCapacityAdapterModels, stripHistoryForContext } from "../../open-sse/services/capacityAdapter.js";
import { stripUnsupportedModalities } from "../../open-sse/translator/concerns/modality.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

describe("Hermes Vision Image Detection", () => {
  it("detects vision from Ollama / Hermes images array", () => {
    const body = {
      messages: [
        {
          role: "user",
          content: "Please analyze this image from Hermes",
          images: ["iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="],
        },
      ],
    };
    const caps = detectRequiredCapabilities(body);
    expect(caps.has("vision")).toBe(true);
  });

  it("detects vision from Vercel AI SDK / Hermes experimental_attachments", () => {
    const body = {
      messages: [
        {
          role: "user",
          content: "Describe this attachment",
          experimental_attachments: [
            {
              contentType: "image/png",
              url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
            },
          ],
        },
      ],
    };
    const caps = detectRequiredCapabilities(body);
    expect(caps.has("vision")).toBe(true);
  });

  it("detects vision from Hermes attachments array", () => {
    const body = {
      messages: [
        {
          role: "user",
          content: "Look at this photo",
          attachments: [
            {
              mediaType: "image/jpeg",
              url: "https://example.com/photo.jpg",
            },
          ],
        },
      ],
    };
    const caps = detectRequiredCapabilities(body);
    expect(caps.has("vision")).toBe(true);
  });

  it("detects vision from embedded data:image URI in string content", () => {
    const body = {
      messages: [
        {
          role: "user",
          content: "Here is an inline image: data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
        },
      ],
    };
    const caps = detectRequiredCapabilities(body);
    expect(caps.has("vision")).toBe(true);
  });

  it("auto-switches non-vision model to Vision Adapter model", () => {
    const body = {
      messages: [
        {
          role: "user",
          content: "Analyze image",
          images: ["base64data..."],
        },
      ],
    };
    const reqCaps = detectRequiredCapabilities(body);
    const settings = {
      capacityAdapter: {
        vision: {
          enabled: true,
          models: ["gemini/gemini-2.5-flash"],
        },
      },
    };

    const augmented = augmentModelsWithCapacityAdapter(["deepseek/deepseek-chat"], reqCaps, settings);
    expect(augmented).toEqual(["gemini/gemini-2.5-flash", "deepseek/deepseek-chat"]);
  });

  it("strips msg.images and attachments when model does not support vision", () => {
    const body = {
      messages: [
        {
          role: "user",
          content: "Test text",
          images: ["base64..."],
          experimental_attachments: [{ contentType: "image/png", url: "data:image/png;base64,..." }],
        },
      ],
    };
    const noVisionCaps = { vision: false, pdf: false, audioInput: false };

    stripUnsupportedModalities(body, FORMATS.OPENAI, noVisionCaps);

    expect(body.messages[0].images).toBeUndefined();
    expect(body.messages[0].experimental_attachments).toHaveLength(0);
  });
});

describe("Capacity Adapter stripHistoryForContext", () => {
  it("preserves system instructions and trailing turn while trimming middle", () => {
    const body = {
      messages: [
        { role: "system", content: "You are a helpful assistant" },
        { role: "user", content: "x".repeat(100000) },
        { role: "assistant", content: "y".repeat(100000) },
        { role: "user", content: "here is an image" },
      ],
    };
    const stripped = stripHistoryForContext(body, 10000); // 10k token window -> 8k budget -> 32k chars
    expect(stripped.messages[0].role).toBe("system");
    expect(stripped.messages[stripped.messages.length - 1].content).toBe("here is an image");
  });
});
