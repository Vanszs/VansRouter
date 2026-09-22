/**
 * Helpers for the OpenCode Zen free-tier client fingerprint.
 *
 * The free tier gates on the lowercase file-search quartet (bash/glob/grep/read):
 * every request must declare each member exactly once. Agent clients declare the
 * same tools capitalised (Claude Code's Bash/Glob/Grep/Read), so the request side
 * canonicalises those spellings while the response side restores the caller's own
 * names — otherwise the client receives a tool name it never registered.
 */

/** Canonical names required by the upstream free-tier gate. */
export const OPENCODE_FINGERPRINT_TOOLS = ["bash", "glob", "grep", "read"];

// Request body -> names renamed for that request. transformRequest() mutates the
// same body object chatCore passed into the executor, so a WeakMap keeps the
// mapping request-local without putting transport metadata on the wire.
const renamedToolNames = new WeakMap();

/** Canonical lowercase quartet name for `name`; "" when it is not a member. */
export function fingerprintToolKey(name) {
  const lower = String(name ?? "").trim().toLowerCase();
  return OPENCODE_FINGERPRINT_TOOLS.includes(lower) ? lower : "";
}

/** Tool name from either flat ({name}) or chat ({function:{name}}) shape. */
function toolNameOf(tool) {
  if (!tool || typeof tool !== "object" || Array.isArray(tool)) return "";
  if (typeof tool.name === "string" && tool.name.trim()) return tool.name.trim();
  const fn = tool.function;
  return fn && typeof fn === "object" && !Array.isArray(fn) && typeof fn.name === "string"
    ? fn.name.trim()
    : "";
}

/**
 * Rename the quartet to its canonical lowercase spelling and drop duplicate
 * spellings of one member (upstream rejects `Bash` + `bash` as a duplicate).
 * Non-fingerprint tools are preserved verbatim, including tools whose names
 * differ only by case — they are outside the fingerprint contract.
 *
 * @param {Array} tools
 * @returns {{ tools: Array, map: Map<string,string> }} map: sent name -> original name
 */
export function concealFingerprintToolNames(tools) {
  const map = new Map();
  if (!Array.isArray(tools) || tools.length === 0) {
    return { tools: Array.isArray(tools) ? tools : [], map };
  }

  const seenQuartet = new Set();
  const out = [];
  for (const tool of tools) {
    if (!tool || typeof tool !== "object" || Array.isArray(tool)) {
      out.push(tool);
      continue;
    }

    const current = toolNameOf(tool);
    const key = fingerprintToolKey(current);
    if (!key) {
      out.push(tool);
      continue;
    }
    if (seenQuartet.has(key)) continue;
    seenQuartet.add(key);

    if (current === key) {
      out.push(tool);
      continue;
    }
    map.set(key, current);
    const fn = tool.function && typeof tool.function === "object" && !Array.isArray(tool.function)
      ? tool.function
      : null;
    out.push(fn ? { ...tool, function: { ...fn, name: key } } : { ...tool, name: key });
  }
  return { tools: out, map };
}

/** Point a forced tool_choice at the canonical name of a tool we renamed. */
function retargetToolChoice(body, map) {
  if (!body || typeof body !== "object" || !map?.size) return;
  const choice = body.tool_choice;
  if (!choice || typeof choice !== "object" || Array.isArray(choice)) return;

  const direct = fingerprintToolKey(choice.name);
  if (direct && map.has(direct)) {
    body.tool_choice = { ...choice, name: direct };
    return;
  }

  const fn = choice.function;
  if (fn && typeof fn === "object" && !Array.isArray(fn)) {
    const nested = fingerprintToolKey(fn.name);
    if (nested && map.has(nested)) {
      body.tool_choice = { ...choice, function: { ...fn, name: nested } };
    }
  }
}

/**
 * Request-side pass: canonicalise quartet case variants, drop duplicates and
 * append the members no caller tool covers.
 *
 * @param {object} body
 * @param {(name: string) => object} decoy - shape-specific decoy tool factory
 * @returns {Map<string,string>} map: sent name -> original name
 */
export function applyFingerprintToolNames(body, decoy) {
  if (!body || typeof body !== "object") return new Map();

  const { tools, map } = concealFingerprintToolNames(body.tools);
  const declared = new Set(tools.map((tool) => fingerprintToolKey(toolNameOf(tool))));
  const missing = OPENCODE_FINGERPRINT_TOOLS.filter((name) => !declared.has(name));
  body.tools = [...tools, ...missing.map((name) => decoy(name))];
  retargetToolChoice(body, map);

  recordRenamedToolNames(body, map);
  return map;
}

/** Store the rename map against `body` so the response side can find it. */
function recordRenamedToolNames(body, map) {
  if (body && typeof body === "object" && map?.size) renamedToolNames.set(body, map);
}

/** Rename map recorded for `body`, or null. */
export function takeRenamedToolNames(body) {
  return body && typeof body === "object" ? renamedToolNames.get(body) || null : null;
}

// Response side -------------------------------------------------------------

/** Restore caller tool spellings in supported response/event shapes. */
export function restoreToolNames(payload, map) {
  if (!map?.size || !payload) return payload;
  if (Array.isArray(payload)) return payload.map((item) => restoreToolNames(item, map));
  if (typeof payload !== "object") return payload;

  let out = payload;
  const put = (key, value) => {
    if (out === payload) out = { ...payload };
    out[key] = value;
  };

  // Claude streaming content_block_start event.
  if (payload.type === "content_block_start") {
    const block = payload.content_block;
    if (block?.type === "tool_use" && typeof block.name === "string" && map.has(block.name)) {
      put("content_block", { ...block, name: map.get(block.name) });
    }
  }

  // Claude non-streaming message body.
  if (Array.isArray(payload.content)) {
    put("content", payload.content.map((block) =>
      block?.type === "tool_use" && typeof block.name === "string" && map.has(block.name)
        ? { ...block, name: map.get(block.name) }
        : block));
  }

  // OpenAI Chat Completions, both streaming delta and JSON message shapes.
  if (Array.isArray(payload.choices)) {
    put("choices", payload.choices.map((choice) => {
      let changed = false;
      const next = { ...choice };
      for (const holder of ["delta", "message"]) {
        const value = choice?.[holder];
        if (!value || !Array.isArray(value.tool_calls) || value.tool_calls.length === 0) continue;
        const calls = value.tool_calls.map((call) => {
          const name = call?.function?.name;
          if (typeof name === "string" && map.has(name)) {
            changed = true;
            return { ...call, function: { ...call.function, name: map.get(name) } };
          }
          return call;
        });
        next[holder] = { ...value, tool_calls: calls };
      }
      return changed ? next : choice;
    }));
  }

  // OpenAI Responses final JSON body.
  if (Array.isArray(payload.output)) {
    put("output", payload.output.map((item) =>
      item?.type === "function_call" && typeof item.name === "string" && map.has(item.name)
        ? { ...item, name: map.get(item.name) }
        : item));
  }

  // OpenAI Responses SSE events such as response.output_item.added/done.
  const item = payload.item;
  if (item?.type === "function_call" && typeof item.name === "string" && map.has(item.name)) {
    put("item", { ...item, name: map.get(item.name) });
  }

  return out;
}
