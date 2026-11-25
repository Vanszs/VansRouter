import { describe, it, expect } from "vitest";
import { KiroExecutor } from "../../open-sse/executors/kiro.js";

describe("KiroExecutor.getOrderedBaseUrls — IdC regional routing (abc0add0)", () => {
  const executor = new KiroExecutor();

  it("routes idc auth to the CodeWhisperer *.amazonaws.com surface", () => {
    const urls = executor.getOrderedBaseUrls({
      providerSpecificData: { authMethod: "idc" },
    });
    expect(urls.length).toBeGreaterThan(0);
    expect(urls[0]).toMatch(/amazonaws\.com/);
  });

  it("regionalizes only regions the q host actually serves", () => {
    const covered = executor.getOrderedBaseUrls({
      providerSpecificData: { authMethod: "idc", region: "eu-central-1" },
    });
    expect(covered).toEqual([
      "https://q.eu-central-1.amazonaws.com/generateAssistantResponse",
    ]);
  });

  it("never builds a host in a region that service does not serve", () => {
    // eu-west-1/ap-southeast-1 have no Kiro host; splicing them yields NXDOMAIN
    // and would send the bearer token to an unresolvable origin.
    for (const region of ["eu-west-1", "ap-southeast-1"]) {
      const urls = executor.getOrderedBaseUrls({
        providerSpecificData: { authMethod: "idc", region },
      });
      for (const url of urls) {
        expect(url).not.toContain(`.${region}.amazonaws.com`);
      }
    }
  });

  it("rejects an injected region before it reaches the hostname", () => {
    expect(() =>
      executor.getOrderedBaseUrls({
        providerSpecificData: { authMethod: "idc", region: "x.attacker.tld#" },
      }),
    ).toThrow(/Invalid region/);
  });

  it("keeps us-east-1 endpoints unchanged when region is not set", () => {
    const urls = executor.getOrderedBaseUrls({
      providerSpecificData: { authMethod: "idc" },
    });
    const amazon = urls.filter((u) => u.includes("amazonaws.com"));
    expect(amazon.length).toBeGreaterThan(0);
    for (const u of amazon) {
      expect(u).toMatch(/\.us-east-1\.amazonaws\.com/);
    }
  });

  it("does not regionalize non-CodeWhisperer kiro.dev endpoints", () => {
    const urls = executor.getOrderedBaseUrls({
      providerSpecificData: { authMethod: "idc", region: "eu-west-1" },
    });
    const others = urls.filter((u) => !u.includes("amazonaws.com"));
    for (const u of others) {
      expect(u).not.toMatch(/\.eu-west-1\./);
    }
  });

  it("treats idc same as api_key/external_idp for surface selection", () => {
    const idc = executor.getOrderedBaseUrls({
      providerSpecificData: { authMethod: "idc", region: "us-west-2" },
    });
    const apiKey = executor.getOrderedBaseUrls({
      providerSpecificData: { authMethod: "api_key", region: "us-west-2" },
    });
    expect(idc[0]).toMatch(/amazonaws\.com/);
    expect(apiKey[0]).toMatch(/amazonaws\.com/);
  });
});
