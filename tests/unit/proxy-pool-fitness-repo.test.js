import { describe, expect, it, vi } from "vitest";

const db = { run: vi.fn(), all: vi.fn(() => []), get: vi.fn() };

vi.mock("../../src/lib/db/driver.js", () => ({ getAdapter: async () => db }));

import {
  clearProxyPoolFitness,
  deleteExpiredProxyPoolFitness,
  escapeLikePattern,
} from "../../src/lib/db/repos/proxyPoolFitnessRepo.js";

describe("proxy pool fitness repo", () => {
  it("treats % and _ in a provider filter as literals", async () => {
    db.run.mockClear();
    await clearProxyPoolFitness("a%b_c");
    expect(db.run).toHaveBeenCalledWith(
      expect.stringContaining("ESCAPE '\\'"),
      ["a\\%b\\_c::%"],
    );
    expect(escapeLikePattern("a%b_c\\")).toBe("a\\%b\\_c\\\\");
  });

  it("deletes every row when no provider is given", async () => {
    db.run.mockClear();
    await clearProxyPoolFitness();
    expect(db.run).toHaveBeenCalledWith("DELETE FROM proxyPoolFitness");
  });

  it("deletes expired rows in one statement", async () => {
    db.run.mockClear();
    await deleteExpiredProxyPoolFitness(123);
    expect(db.run).toHaveBeenCalledWith("DELETE FROM proxyPoolFitness WHERE until <= ?", [123]);
  });
});
