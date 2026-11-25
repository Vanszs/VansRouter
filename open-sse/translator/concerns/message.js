import { OPENAI_BLOCK } from "../schema/index.js";

// Collapse an OpenAI content-part array: if ALL parts are text, join into a plain string;
// otherwise return the array as-is. Matches OpenAI canonical format. Cache-aware targets
// keep the array so marked blocks survive the trip.
export function collapseTextParts(parts, opts = {}) {
  const preserve = opts.preserveCacheControl && parts.some((p) => p.cache_control);
  if (!preserve && parts.every((p) => p.type === OPENAI_BLOCK.TEXT)) {
    return parts.map((p) => p.text).join("\n");
  }
  return parts;
}
