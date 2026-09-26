// The suggested-models filter used to carry a hardcoded DEAD_FREE_OPENCODE_MODELS
// set — a snapshot of which free-tier ids upstream rejects. That snapshot could
// not expire, protected nothing (/v1/models and request routing never consulted
// it), and was wrong twice: it hid two live models, and one of its four entries
// was unreachable behind the "-free" suffix rule. The contract is now simply:
// offer what upstream lists, and let the request error name the bad id.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { FILTERS } from "@/app/api/providers/suggested-models/filters.js";

const suggest = (ids) => FILTERS["opencode-free"](ids.map((id) => ({ id }))).map((m) => m.id);

describe("opencode-free suggestion filter", () => {
  it("offers every free id upstream lists, including ones previously called dead", () => {
    // If upstream ever revives one of these, it must reappear without a code edit.
    const ids = ["space-bunny-free", "big-pickle", "hy3-free", "deepseek-v4-flash-free", "jev-1.13-free"];
    expect(suggest(ids)).toEqual(ids);
  });

  it("keeps the -free suffix and the known non-suffix id as the only rules", () => {
    expect(suggest(["space-bunny-free", "big-pickle", "gpt-4o", "claude-3"])).toEqual([
      "space-bunny-free",
      "big-pickle",
    ]);
  });

  it("has no hardcoded exclusion list left to go stale", () => {
    const src = readFileSync(new URL("../../src/app/api/providers/suggested-models/filters.js", import.meta.url), "utf8");
    expect(src).not.toMatch(/DEAD_FREE/);
  });

  it("tolerates a missing id rather than throwing", () => {
    expect(suggest([undefined, "space-bunny-free"])).toEqual(["space-bunny-free"]);
  });
});
