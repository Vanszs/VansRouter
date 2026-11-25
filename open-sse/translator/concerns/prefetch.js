// Pre-fetch remote image URLs into base64 BEFORE translation, for target
// formats whose upstream providers cannot fetch remote URLs themselves
// (they require inline base64). Runs on the source-format body.
import { FORMATS } from "../formats.js";
import { fetchImageAsBase64, parseDataUri } from "./image.js";

// Targets that require inline base64 images (cannot accept remote URLs).
const TARGETS_NEED_BASE64 = new Set([
  FORMATS.GEMINI, FORMATS.GEMINI_CLI, FORMATS.VERTEX,
  FORMATS.ANTIGRAVITY, FORMATS.OLLAMA, FORMATS.KIRO,
  FORMATS.COMMANDCODE,
]);

// Replaces an image the request cannot inline, so a provider that only accepts
// inline images still gets a valid text-only request instead of a hard 400.
const OMITTED_IMAGE_TEXT = "[image omitted: the image could not be inlined for this model]";

// Bare base64 (no data: prefix) is sent by some clients. Only accept payloads
// whose magic bytes identify a real image, so arbitrary text never gets wrapped.
const BASE64_MIME_SIGNATURES = [
  ["iVBORw0KGgo", "image/png"],
  ["/9j/", "image/jpeg"],
  ["R0lGOD", "image/gif"],
  ["UklGR", "image/webp"],
];

function isRemoteUrl(url) {
  if (typeof url !== "string" || !/^https?:\/\//i.test(url)) return false;
  try {
    const parsed = new URL(url);
    return (parsed.protocol === "http:" || parsed.protocol === "https:") && !!parsed.hostname;
  } catch {
    return false;
  }
}

function isGcsUri(url) {
  return typeof url === "string" && url.startsWith("gs://");
}

// Gemini-family targets accept Cloud Storage URIs directly; other targets do not.
const GEMINI_TARGETS = new Set([
  FORMATS.GEMINI, FORMATS.GEMINI_CLI, FORMATS.VERTEX, FORMATS.ANTIGRAVITY,
]);

function sniffBareBase64Image(value) {
  if (typeof value !== "string") return null;
  const compact = value.replace(/\s+/g, "");
  if (compact.length < 64 || !/^[A-Za-z0-9+/=]+$/.test(compact)) return null;
  const signature = BASE64_MIME_SIGNATURES.find(([prefix]) => compact.startsWith(prefix));
  return signature ? { mimeType: signature[1], base64: compact } : null;
}

function applyInlineImage(ref, mimeType, base64) {
  if (ref.set) {
    ref.set(`data:${mimeType};base64,${base64}`);
  } else if (ref.part) {
    delete ref.part.fileData;
    ref.part.inlineData = { mimeType, data: base64 };
  } else if (ref.claudeBlock) {
    ref.claudeBlock.source = { type: "base64", media_type: mimeType, data: base64 };
  }
}

// Collect accessors for every image reference in a source body. References are
// collected even when they are not remote URLs: a provider that requires inline
// images must never receive a file path or a bare base64 blob either.
function collectImageRefs(body, sourceFormat) {
  const refs = [];
  const pushOpenAIBlock = (block) => {
    if (block?.type !== "image_url") return;
    const url = typeof block.image_url === "string" ? block.image_url : block.image_url?.url;
    if (typeof url !== "string") {
      refs.push({ get: () => null, drop: () => {
        block.type = "text";
        block.text = OMITTED_IMAGE_TEXT;
        delete block.image_url;
      } });
      return;
    }
    refs.push({
      get: () => url,
      set: (v) => {
        if (typeof block.image_url === "string") block.image_url = v; else block.image_url.url = v;
      },
      drop: () => {
        block.type = "text";
        block.text = OMITTED_IMAGE_TEXT;
        delete block.image_url;
      },
    });
  };
  const pushOpenAI = (messages) => {
    for (const msg of messages || []) {
      if (!Array.isArray(msg.content)) continue;
      for (const block of msg.content) pushOpenAIBlock(block);
    }
  };
  // Responses image parts live in input[].content[] (message items); a bare
  // top-level input_image is not a valid request item.
  const pushResponses = (input) => {
    for (const item of input || []) {
      if (!Array.isArray(item?.content)) continue;
      for (const block of item.content) {
        if (block?.type !== "input_image") continue;
        const url = typeof block.image_url === "string" ? block.image_url : block.image_url?.url;
        if (typeof url !== "string") {
          refs.push({ get: () => null, drop: () => {
            block.type = "input_text";
            block.text = OMITTED_IMAGE_TEXT;
            delete block.image_url;
            delete block.detail;
          } });
          continue;
        }
        refs.push({
          get: () => url,
          set: (v) => {
            if (typeof block.image_url === "string") block.image_url = v; else block.image_url.url = v;
          },
          drop: () => {
            block.type = "input_text";
            block.text = OMITTED_IMAGE_TEXT;
            delete block.image_url;
            delete block.detail;
          },
        });
      }
    }
  };
  const pushClaude = (messages) => {
    for (const msg of messages || []) {
      if (!Array.isArray(msg.content)) continue;
      for (const block of msg.content) {
        if (block?.type !== "image" || block.source?.type !== "url") continue;
        if (typeof block.source.url !== "string") {
          refs.push({ get: () => null, drop: () => {
            block.type = "text";
            block.text = OMITTED_IMAGE_TEXT;
            delete block.source;
          } });
          continue;
        }
        refs.push({
          get: () => block.source.url,
          claudeBlock: block,
          drop: () => {
            block.type = "text";
            block.text = OMITTED_IMAGE_TEXT;
            delete block.source;
          },
        });
      }
    }
  };
  const pushGemini = (contents) => {
    for (const c of contents || []) {
      for (const p of c.parts || []) {
        const uri = p?.fileData?.fileUri;
        if (typeof uri !== "string") continue;
        refs.push({
          get: () => uri,
          part: p,
          drop: () => {
            delete p.fileData;
            p.text = OMITTED_IMAGE_TEXT;
          },
        });
      }
    }
  };

  switch (sourceFormat) {
    case FORMATS.OPENAI:
    case FORMATS.OLLAMA:
    case FORMATS.KIRO:
    case FORMATS.CURSOR:
    case FORMATS.COMMANDCODE:
      pushOpenAI(body.messages);
      break;
    case FORMATS.CLAUDE:
      pushClaude(body.messages);
      break;
    case FORMATS.GEMINI:
    case FORMATS.GEMINI_CLI:
    case FORMATS.VERTEX:
      pushGemini(body.contents);
      break;
    case FORMATS.ANTIGRAVITY:
      pushGemini(body?.request?.contents);
      break;
    case FORMATS.OPENAI_RESPONSES:
      pushResponses(body.input);
      break;
    default:
      pushOpenAI(body.messages);
  }
  return refs;
}

/**
 * Replace image references with inline base64 when the target needs inline data.
 * No-op when target accepts remote URLs (e.g. openai, claude) or body has none.
 *
 * Every image reference is validated for every target: valid http(s) is kept,
 * data URLs are validated/compacted, bare base64 is wrapped, and anything else
 * is replaced with a text placeholder. Remote URLs are fetched only when the
 * target cannot fetch them itself (or options.force declares an inline need).
 * @returns {Promise<number>} count of images converted/normalized
 */
export async function prefetchRemoteImages(body, sourceFormat, targetFormat, options = {}) {
  const needsInline = TARGETS_NEED_BASE64.has(targetFormat) || options.force === true;
  if (!body) return 0;
  const refs = collectImageRefs(body, sourceFormat);
  if (!refs.length) return 0;

  const results = await Promise.all(refs.map(async (ref) => {
    const url = ref.get();
    const dataUri = parseDataUri(url);
    if (dataUri) {
      if (!/^image\//i.test(dataUri.mimeType || "")) {
        ref.drop?.();
        options.onDrop?.({ reason: "not-an-image" });
        return 0;
      }
      // Some clients line-wrap base64; compact it so strict URL validators
      // (Codex Responses) accept the data URL.
      const base64 = String(dataUri.base64 || "").replace(/\s+/g, "");
      if (!base64) {
        ref.drop?.();
        options.onDrop?.({ reason: "empty-data-uri" });
        return 0;
      }
      const normalized = `data:${dataUri.mimeType};base64,${base64}`;
      if (normalized !== url) {
        applyInlineImage(ref, dataUri.mimeType, base64);
        return 1;
      }
      return 0; // already inline
    }

    // A data: prefix that parseDataUri cannot parse (empty, URL-encoded, or
    // non-base64) is not a valid URL for any remote provider.
    if (typeof url === "string" && /^data:/i.test(url)) {
      ref.drop?.();
      options.onDrop?.({ reason: "invalid-data-uri" });
      return 0;
    }

    // Some clients send raw base64 instead of a data URL. Normalize it so the
    // provider receives the only shape it accepts.
    const bare = sniffBareBase64Image(url);
    if (bare) {
      applyInlineImage(ref, bare.mimeType, bare.base64);
      return 1;
    }

    // Gemini/Vertex accept gs:// file references; other targets cannot use them.
    if (isGcsUri(url)) {
      if (GEMINI_TARGETS.has(targetFormat)) return 0;
      ref.drop?.();
      options.onDrop?.({ reason: "unsupported-uri" });
      return 0;
    }

    if (!isRemoteUrl(url)) {
      ref.drop?.();
      options.onDrop?.({ reason: "invalid-url" });
      return 0;
    }

    // A remote URL is valid for targets that can fetch it themselves (Codex,
    // OpenAI, Claude). Only inline it when the target cannot.
    if (!needsInline) return 0;

    const fetched = await fetchImageAsBase64(url, options);
    if (fetched) {
      applyInlineImage(ref, fetched.mimeType, fetched.url.split(",")[1]);
      return 1;
    }
    ref.drop?.();
    options.onDrop?.({ reason: "fetch-failed" });
    return 0;
  }));

  return results.reduce((acc, n) => acc + n, 0);
}
