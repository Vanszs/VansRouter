/**
 * HuggingFace registry migration to router.huggingface.co
 *
 * The legacy base URL `https://api-inference.huggingface.co` no longer resolves
 * (DNS ENOTFOUND), so every HuggingFace image/STT request failed at the fetch
 * layer. The replacement is `https://router.huggingface.co`, which routes by
 * `<provider>/<providerResolvedModelId>` — the provider-resolved id is NOT the
 * Hub model id and must be resolved from the Hub API's inferenceProviderMapping.
 */

import { describe, it, expect } from "vitest";
import huggingface from "../../open-sse/providers/registry/huggingface.js";
import imageAdapter from "../../open-sse/handlers/imageProviders/huggingface.js";

const DEAD_HOST = "api-inference.huggingface.co";
const LIVE_ROUTER = "router.huggingface.co";
const FAL_SCHNELL = "https://router.huggingface.co/fal-ai/fal-ai/flux/schnell";

// Providers the router actually forwards to. replicate/wavespeed/deepinfra appear
// in the Hub's inferenceProviderMapping but reject every router request with
// "Model not supported by provider <name>", so they must not be used here.
const ROUTABLE_PROVIDERS = new Set(["fal-ai", "hf-inference", "nscale", "together", "novita", "hyperbolic"]);

// Every model the registry must keep advertising, by kind.
const ADVERTISED = {
  image: [
    "black-forest-labs/FLUX.1-schnell",
    "black-forest-labs/FLUX.1-dev",
    "black-forest-labs/FLUX.1-Krea-dev",
    "black-forest-labs/FLUX.1-Kontext-dev",
    "black-forest-labs/FLUX.2-dev",
    "black-forest-labs/FLUX.2-klein-9B",
    "black-forest-labs/FLUX.2-klein-4B",
    "black-forest-labs/FLUX.2-klein-base-9B",
    "black-forest-labs/FLUX.2-klein-base-4B",
    "Qwen/Qwen-Image",
    "Qwen/Qwen-Image-2512",
    "Qwen/Qwen-Image-Edit",
    "Qwen/Qwen-Image-Edit-2509",
    "Qwen/Qwen-Image-Edit-2511",
    "stabilityai/stable-diffusion-xl-base-1.0",
    "stabilityai/stable-diffusion-3.5-large",
    "stabilityai/stable-diffusion-3.5-large-turbo",
    "tencent/HunyuanImage-3.0",
    "Tongyi-MAI/Z-Image-Turbo",
    "krea/Krea-2-Turbo",
    "HiDream-ai/HiDream-I1-Fast",
    "playgroundai/playground-v2.5-1024px-aesthetic",
    "ideogram-ai/ideogram-4-fp8",
  ],
  stt: ["openai/whisper-large-v3", "openai/whisper-large-v3-turbo"],
};

const imageConfig = huggingface.imageConfig;
const modelMap = imageConfig.modelMap || {};
const modelsById = Object.fromEntries(huggingface.models.map((m) => [m.id, m]));

// modelMap values are either a bare path (text-to-image) or
// { path, task: "image-to-image" } for models that require a source image.
const mappingPath = (value) => (typeof value === "string" ? value : value.path);
const mappingTask = (value) => (typeof value === "string" ? "text-to-image" : value.task || "text-to-image");

describe("HuggingFace registry — legacy host removal", () => {
  it("serves both modalities from the live router, never the dead host", () => {
    expect(imageConfig.baseUrl).toContain(LIVE_ROUTER);
    expect(imageConfig.baseUrl).not.toContain(DEAD_HOST);
    expect(huggingface.sttConfig?.baseUrl).not.toContain(DEAD_HOST);
  });
});

describe("HuggingFace STT dispatch", () => {
  it("declares a bearer-apikey ASR sttConfig on the hf-inference route", () => {
    expect(huggingface.sttConfig).toBeDefined();
    expect(huggingface.sttConfig.format).toBe("huggingface-asr");
    expect(huggingface.sttConfig.authType).toBe("apikey");
    expect(huggingface.sttConfig.authHeader).toBe("bearer");
    expect(huggingface.sttConfig.baseUrl).toBe("https://router.huggingface.co/hf-inference/models");
  });

  it("advertises stt in serviceKinds", () => {
    expect(huggingface.serviceKinds).toContain("stt");
  });
});

describe("HuggingFace image URL builder", () => {
  it("resolves Hub ids to the provider-resolved router path", () => {
    expect(imageAdapter.buildUrl("black-forest-labs/FLUX.1-schnell")).toBe(FAL_SCHNELL);
    expect(imageAdapter.buildUrl("stabilityai/stable-diffusion-xl-base-1.0")).toBe(
      "https://router.huggingface.co/fal-ai/fal-ai/fast-sdxl"
    );
    expect(imageAdapter.buildUrl("black-forest-labs/FLUX.1-schnell")).not.toContain(DEAD_HOST);
  });

  it("throws a descriptive error for a model with no provider mapping", () => {
    expect(() => imageAdapter.buildUrl("some-org/not-mapped-model")).toThrow(/no HuggingFace router mapping/i);
    expect(() => imageAdapter.buildUrl("some-org/unknown")).toThrow(/no HuggingFace router mapping/i);
  });

  it("lets a connection override the endpoint and passes the Hub id through verbatim", () => {
    const creds = { providerSpecificData: { baseUrl: "https://tgi.internal/" } };

    expect(imageAdapter.buildUrl("my-org/my-tgi-model", creds)).toBe("https://tgi.internal/my-org/my-tgi-model");
    // The custom endpoint knows its own model ids — the router mapping is not applied.
    expect(imageAdapter.buildUrl("black-forest-labs/FLUX.1-schnell", creds)).toBe(
      "https://tgi.internal/black-forest-labs/FLUX.1-schnell"
    );
    expect(imageAdapter.buildUrl("black-forest-labs/FLUX.1-schnell", { providerSpecificData: { baseUrl: "  " } })).toBe(
      FAL_SCHNELL
    );
  });

  it("rejects traversal or query injection in the model id on a custom endpoint", () => {
    const creds = { providerSpecificData: { baseUrl: "https://tgi.internal" } };

    for (const model of ["x/../../admin", "org//model", "model?x=1", "model#f"]) {
      expect(() => imageAdapter.buildUrl(model, creds), model).toThrow(/invalid model ID/i);
    }
  });
});

describe("HuggingFace registry model table", () => {
  it("advertises every expected model with its kind, and no dead whisper-small", () => {
    for (const [kind, ids] of Object.entries(ADVERTISED)) {
      for (const id of ids) {
        expect(modelsById[id]?.kind, `${id} should be registered as ${kind}`).toBe(kind);
      }
    }
    expect(modelsById["openai/whisper-small"]).toBeUndefined();
  });

  it("every image model is present in imageConfig.modelMap", () => {
    for (const model of huggingface.models.filter((m) => m.kind === "image")) {
      expect(modelMap[model.id], `model ${model.id} is missing from imageConfig.modelMap`).toBeTruthy();
    }
  });

  it("every modelMap entry is a provider/model path at a routable provider", () => {
    for (const [hubId, value] of Object.entries(modelMap)) {
      const path = String(mappingPath(value));
      const provider = path.split("/")[0];
      expect(path, `${hubId} has a malformed target`).toMatch(/^[a-z0-9-]+\/[A-Za-z0-9._/-]+$/);
      expect(ROUTABLE_PROVIDERS.has(provider), `${hubId} -> unsupported provider ${provider}`).toBe(true);
    }
  });

  it("keeps the model table free of duplicates", () => {
    const ids = huggingface.models.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("keeps STT models free of image-only router mappings", () => {
    for (const model of huggingface.models.filter((m) => m.kind === "stt")) {
      expect(modelMap[model.id], `STT model ${model.id} should not be in the image model map`).toBeUndefined();
    }
  });
});

// The router is a switchboard in front of many providers; every Hub model that is
// `pipeline_tag: image-to-image` needs a source image, and the request shape differs
// from text-to-image: `inputs` carries the base64 source image and the prompt moves
// under `parameters.prompt`.
describe("HuggingFace image-to-image models", () => {
  const IMAGE_TO_IMAGE = [
    "black-forest-labs/FLUX.2-dev",
    "black-forest-labs/FLUX.1-Kontext-dev",
    "black-forest-labs/FLUX.2-klein-9B",
    "black-forest-labs/FLUX.2-klein-4B",
    "black-forest-labs/FLUX.2-klein-base-9B",
    "black-forest-labs/FLUX.2-klein-base-4B",
    "Qwen/Qwen-Image-Edit",
    "Qwen/Qwen-Image-Edit-2509",
    "Qwen/Qwen-Image-Edit-2511",
  ];

  it("declares image-to-image only for the models that take a source image", () => {
    for (const [hubId, value] of Object.entries(modelMap)) {
      const expected = IMAGE_TO_IMAGE.includes(hubId) ? "image-to-image" : "text-to-image";
      expect(mappingTask(value), `${hubId} should be ${expected}`).toBe(expected);
    }
  });

  it("sends the source image as inputs and the prompt under parameters", async () => {
    const body = await imageAdapter.buildBody("Qwen/Qwen-Image-Edit", {
      prompt: "make it snow",
      image: "data:image/png;base64,AAAA",
    });

    expect(body.inputs).toBe("AAAA");
    expect(body.parameters).toEqual({ prompt: "make it snow" });

    // A bare base64 payload and an `images` array are both accepted.
    expect((await imageAdapter.buildBody("black-forest-labs/FLUX.2-dev", { prompt: "winter", image: "AAAA" })).inputs).toBe(
      "AAAA"
    );
    expect(
      (await imageAdapter.buildBody("Qwen/Qwen-Image-Edit-2509", { prompt: "winter", images: ["data:image/png;base64,BBBB"] }))
        .inputs
    ).toBe("BBBB");
  });

  it("throws a descriptive error when an image-to-image model gets no source image", async () => {
    await expect(imageAdapter.buildBody("black-forest-labs/FLUX.1-Kontext-dev", { prompt: "winter" })).rejects.toThrow(
      /requires a source image/i
    );
  });

  it("keeps the text-to-image shape prompt-only", async () => {
    const body = await imageAdapter.buildBody("black-forest-labs/FLUX.1-schnell", {
      prompt: "a lighthouse",
      image: "data:image/png;base64,AAAA",
    });

    expect(body).toEqual({ inputs: "a lighthouse" });
  });
});

// The dashboard's GenericExampleCard only renders the source-image field when the
// selected model declares capabilities: ["edit"], and it then sends the value as
// `image`. Without the flag the edit models are unusable from the UI even though the
// adapter supports them.
describe("HuggingFace edit models reach the dashboard", () => {
  it("declares the edit capability exactly on the image-to-image models", () => {
    for (const hubId of ["black-forest-labs/FLUX.2-dev", "Qwen/Qwen-Image-Edit"]) {
      expect(modelsById[hubId]?.capabilities, `${hubId} must declare the edit capability`).toContain("edit");
    }
    expect(modelsById["black-forest-labs/FLUX.1-schnell"]?.capabilities || []).not.toContain("edit");
  });
});

describe("HuggingFace registry prototype safety", () => {
  it("does not resolve inherited object keys as models", () => {
    // A plain-object map returns a truthy inherited value for these, which would
    // build a URL like `<base>/function Object() { [native code] }`.
    for (const key of ["toString", "constructor", "__proto__", "hasOwnProperty"]) {
      expect(() => imageAdapter.buildUrl(key)).toThrow(/no HuggingFace router mapping/i);
    }
  });
});

describe("HuggingFace STT model parameters", () => {
  it("does not advertise a language parameter the ASR route cannot carry", () => {
    // transcribeHuggingFace posts raw audio bytes and never reads formData, and the
    // router's ASR payload has no `language` field — so a UI-declared "language"
    // param is silently dropped. Declaring it lies to the dashboard.
    for (const model of huggingface.models.filter((m) => m.kind === "stt")) {
      expect(model.params, `${model.id} advertises an unusable language param`).toEqual([]);
    }
  });
});
