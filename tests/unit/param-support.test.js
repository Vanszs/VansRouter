import { describe, it, expect } from "vitest";

import { stripUnsupportedParams } from "../../open-sse/translator/concerns/paramSupport.js";

describe("stripUnsupportedParams", () => {
  it("flattens Cloudflare AI OpenAI content-part arrays", () => {
    const body = {
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "hello " },
            { type: "image_url", image_url: { url: "data:image/png;base64,xx" } },
            { type: "text", text: "world" },
          ],
        },
      ],
    };

    expect(() => stripUnsupportedParams("cloudflare-ai", "@cf/meta/llama-3.1-8b-instruct", body)).not.toThrow();
    expect(body.messages[0].content).toBe("hello world");
  });

  it("still drops unsupported GitHub model params", () => {
    const body = { temperature: 0.7, top_p: 1 };

    stripUnsupportedParams("github", "gpt-5.4", body);

    expect(body).toEqual({ top_p: 1 });
  });

  it("clamps VolcEngine Ark GLM max token fields to the model output ceiling", () => {
    const body = {
      max_tokens: 131072,
      max_completion_tokens: 131072,
      max_output_tokens: 131072,
    };

    stripUnsupportedParams("volcengine-ark", "GLM-5.2", body);

    expect(body).toEqual({
      max_tokens: 128000,
      max_completion_tokens: 128000,
      max_output_tokens: 128000,
    });
  });

  it("keeps VolcEngine Ark GLM max tokens when already under the ceiling", () => {
    const body = { max_tokens: 64000 };

    stripUnsupportedParams("volcengine-ark", "GLM-5.2", body);

    expect(body.max_tokens).toBe(64000);
  });

  describe("replayed reasoning fields", () => {
    const body = () => ({
      messages: [
        { role: "user", content: "hi" },
        { role: "assistant", content: "ok", reasoning_content: "because", reasoning: "why", reasoning_details: [{ type: "summary" }] },
      ],
    });

    it.each(["groq", "mistral", "cerebras"])("drops assistant reasoning fields for %s", (provider) => {
      const req = body();

      stripUnsupportedParams(provider, "some-model", req);

      expect(req.messages[1]).toEqual({ role: "assistant", content: "ok" });
      expect(req.messages[0]).toEqual({ role: "user", content: "hi" });
    });

    it("leaves other providers' replayed reasoning alone", () => {
      const req = body();

      stripUnsupportedParams("deepseek", "deepseek-reasoner", req);

      expect(req.messages[1].reasoning_content).toBe("because");
    });

    it("keeps the Kimchi reasoning rules untouched", () => {
      const req = { ...body(), reasoning_effort: "high" };

      stripUnsupportedParams("kimchi", "glm-4.6", req);

      expect(req.reasoning_effort).toBeUndefined();
      expect(req.messages[1].reasoning_content).toBe("because");
    });
  });
});
