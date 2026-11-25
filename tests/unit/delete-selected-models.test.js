import { describe, it, expect, vi } from "vitest";
import { deleteSelectedModels } from "../../src/shared/utils/deleteSelectedModels.js";

describe("selected model removal", () => {
  it("deduplicates scoped custom entries and removes only matching aliases", async () => {
    const fetchFn = vi.fn(async () => ({ ok: true }));
    const m = { id: "a/b", type: "llm", source: "custom" };
    await deleteSelectedModels([m, m], "oc", { mine: "oc/a/b", other: "other/a/b" }, fetchFn);
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(fetchFn.mock.calls[0][0]).toContain("providerAlias=oc&id=a%2Fb&type=llm");
    expect(fetchFn.mock.calls[1][0]).toBe("/api/models/alias?alias=mine");
  });
  it("removes legacy aliases without deleting a custom registration", async () => {
    const f = vi.fn(async () => ({ ok: true }));
    await deleteSelectedModels([{ id: "m", source: "legacyAlias" }], "oc", { a: "oc/m" }, f);
    expect(f).toHaveBeenCalledTimes(1);
    expect(f.mock.calls[0][0]).toBe("/api/models/alias?alias=a");
  });
  it("stops on failed writes and explicitly reports partial failure", async () => {
    const f = vi.fn(async () => ({ ok: false }));
    await expect(deleteSelectedModels([{ id: "x", source: "custom" }, { id: "y", source: "custom" }], "oc", {}, f)).rejects.toThrow("may already have been removed");
    expect(f).toHaveBeenCalledTimes(1);
  });
});
