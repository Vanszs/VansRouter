import { describe, it, expect, vi } from "vitest";
import { importSelectedModels } from "../../src/shared/utils/importSelectedModels.js";

describe("selected model import", () => {
  it("writes only the confirmed models and reports the server count", async () => {
    const selected = [{ id: "m", providerAlias: "oc", type: "llm" }];
    const f = vi.fn(async () => ({ ok: true, json: async () => ({ count: 0 }) }));
    expect(await importSelectedModels(selected, f)).toBe(0);
    expect(JSON.parse(f.mock.calls[0][1].body)).toEqual({ models: selected });
  });
  it("does not send an empty selection", async () => {
    const f = vi.fn();
    expect(await importSelectedModels([], f)).toBe(0);
    expect(f).not.toHaveBeenCalled();
  });
  it("surfaces a failed write instead of treating it as success", async () => {
    const f = vi.fn(async () => ({ ok: false, json: async () => ({ error: "DB unavailable" }) }));
    await expect(importSelectedModels([{ id: "m" }], f)).rejects.toThrow("DB unavailable");
  });
});
