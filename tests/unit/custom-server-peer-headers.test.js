import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import http from "node:http";

const require = createRequire(import.meta.url);

let originalCreateServer;
let server;
let baseUrl;
let seenHeaders;

beforeAll(async () => {
  originalCreateServer = http.createServer;
  delete require.cache[require.resolve("../../custom-server.js")];
  require("../../custom-server.js");

  server = http.createServer((req, res) => {
    seenHeaders = req.headers;
    res.end("ok");
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

afterAll(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  http.createServer = originalCreateServer;
  delete require.cache[require.resolve("../../custom-server.js")];
});

async function get(headers = {}) {
  const response = await fetch(baseUrl, { headers });
  await response.arrayBuffer();
  return seenHeaders;
}

describe("custom-server peer header sanitizing", () => {
  it("generates a peer trust token at boot", () => {
    expect(process.env.NINEROUTER_PEER_TOKEN).toMatch(/^[0-9a-f]{48}$/);
  });

  it("replaces a client-supplied real IP with the socket address", async () => {
    const headers = await get({ "x-9r-real-ip": "203.0.113.55" });
    expect(headers["x-9r-real-ip"]).toMatch(/^(::ffff:)?127\.0\.0\.1$/);
  });

  it("stamps and replaces the peer trust token", async () => {
    const headers = await get({ "x-9r-peer-token": "forged-token" });
    expect(headers["x-9r-peer-token"]).toBe(process.env.NINEROUTER_PEER_TOKEN);
    expect(headers["x-9r-peer-token"]).not.toBe("forged-token");
  });

  it("drops a client-supplied proxy marker", async () => {
    const headers = await get({ "x-9r-via-proxy": "1" });
    expect(headers["x-9r-via-proxy"]).toBeUndefined();
  });

  it("adopts forwarded IP only for a loopback proxy hop", async () => {
    const headers = await get({ "x-forwarded-for": "203.0.113.9, 10.0.0.1" });
    expect(headers["x-9r-via-proxy"]).toBe("1");
    expect(headers["x-9r-real-ip"]).toBe("203.0.113.9");
    expect(headers["x-forwarded-for"]).toBeUndefined();
  });
});
