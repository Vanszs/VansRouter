const http = require("http");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { assertProductionSecrets } = require("./runtime-secrets.cjs");

assertProductionSecrets();

const MAX_H2C_BODY_BYTES = 64 * 1024 * 1024;
const H2C_CRLF = Buffer.from("\r\n");
const H2C_CRLF_CRLF = Buffer.from("\r\n\r\n");

function parseChunkedBody(input, { maxBytes = MAX_H2C_BODY_BYTES } = {}) {
  const buffer = Buffer.isBuffer(input) ? input : Buffer.from(input);
  const chunks = [];
  let offset = 0;
  let bodyBytes = 0;

  while (true) {
    const lineEnd = buffer.indexOf(H2C_CRLF, offset);
    if (lineEnd === -1) return null;
    const sizeToken = buffer.subarray(offset, lineEnd).toString("ascii").split(";", 1)[0].trim();
    if (!/^[0-9a-f]+$/i.test(sizeToken)) {
      throw new Error(`Invalid chunk size: ${sizeToken || "<empty>"}`);
    }
    const size = Number.parseInt(sizeToken, 16);
    if (!Number.isSafeInteger(size)) throw new Error(`Chunk size is too large: ${sizeToken}`);
    offset = lineEnd + H2C_CRLF.length;

    if (size === 0) {
      if (buffer.length >= offset + 2 && buffer.subarray(offset, offset + 2).equals(H2C_CRLF)) {
        return { body: Buffer.concat(chunks), end: offset + 2 };
      }
      const trailerEnd = buffer.indexOf(H2C_CRLF_CRLF, offset);
      if (trailerEnd === -1) return null;
      return { body: Buffer.concat(chunks), end: trailerEnd + H2C_CRLF_CRLF.length };
    }

    bodyBytes += size;
    if (bodyBytes > maxBytes) throw new Error(`Chunked body exceeds ${maxBytes} bytes`);
    if (buffer.length < offset + size + 2) return null;
    chunks.push(buffer.subarray(offset, offset + size));
    offset += size;
    if (!buffer.subarray(offset, offset + 2).equals(H2C_CRLF)) {
      throw new Error("Chunk data is not terminated by CRLF");
    }
    offset += 2;
  }
}

const portArgIndex = process.argv.indexOf("--port");
if (portArgIndex !== -1) {
  const requestedPort = Number.parseInt(process.argv[portArgIndex + 1], 10);
  if (Number.isInteger(requestedPort) && requestedPort > 0 && requestedPort <= 65535) {
    process.env.PORT = String(requestedPort);
  }
}

const origCreate = http.createServer.bind(http);
const PEER_TOKEN = crypto.randomBytes(24).toString("hex");
process.env.VANSROUTER_PEER_TOKEN = PEER_TOKEN;
process.env.NINEROUTER_PEER_TOKEN = PEER_TOKEN; // legacy alias

// Wrap Next standalone HTTP server: derive client IP from the TCP socket
// (unspoofable) and strip client-supplied forwarding headers so downstream
// rate-limiting keys on the real peer address instead of attacker-controlled XFF.
http.createServer = (...args) => {
  const handler = args.find((a) => typeof a === "function");
  const rest = args.filter((a) => typeof a !== "function");
  if (!handler) return origCreate(...args);
  const wrapped = (req, res) => {
    const socketIp = req.socket && req.socket.remoteAddress ? req.socket.remoteAddress : "";
    const xff = req.headers["x-forwarded-for"];
    const xRealIp = req.headers["x-real-ip"];
    const viaProxy = !!(xff || xRealIp);
    const isLoopbackProxy = socketIp === "127.0.0.1" || socketIp === "::1" || socketIp === "::ffff:127.0.0.1";
    // Trust forwarding headers only when the TCP peer is a local reverse proxy.
    // Direct/public sockets remain keyed by the unspoofable peer address.
    const proxyIp = xRealIp || (xff ? String(xff).split(",")[0].trim() : "");
    const ip = isLoopbackProxy && proxyIp ? proxyIp : socketIp;
    delete req.headers["x-9r-real-ip"];
    delete req.headers["x-forwarded-for"];
    delete req.headers["x-9r-via-proxy"];
    delete req.headers["x-9r-peer-token"];
    req.headers["x-9r-real-ip"] = ip;
    req.headers["x-9r-peer-token"] = PEER_TOKEN;
    if (viaProxy) req.headers["x-9r-via-proxy"] = "1";
    return handler(req, res);
  };
  const server = origCreate(...rest, wrapped);
  const origEmit = server.emit;

  // JBR 25 sends h2c upgrades that the HTTP/1.1 server would otherwise close.
  server.emit = function (event, ...eventArgs) {
    const [req, socket, head = Buffer.alloc(0)] = eventArgs;
    if (event !== "upgrade" || String(req.headers.upgrade || "").toLowerCase() !== "h2c") {
      return origEmit.call(this, event, ...eventArgs);
    }

    const contentLengthHeader = req.headers["content-length"];
    const transferEncodingHeader = req.headers["transfer-encoding"];
    const rejectRequest = (message) => {
      if (!socket.destroyed) {
        const body = Buffer.from(message);
        socket.end(`HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: ${body.length}\r\n\r\n${body}`);
      }
    };

    if (contentLengthHeader !== undefined && transferEncodingHeader !== undefined) {
      rejectRequest("Content-Length and Transfer-Encoding cannot be combined\n");
      return true;
    }

    const transferEncoding = transferEncodingHeader === undefined
      ? null
      : String(transferEncodingHeader).split(",").map((value) => value.trim().toLowerCase()).filter(Boolean);
    if (transferEncoding && (transferEncoding.length !== 1 || transferEncoding[0] !== "chunked")) {
      rejectRequest("Unsupported h2c transfer encoding\n");
      return true;
    }

    let expectedLength = 0;
    if (contentLengthHeader !== undefined) {
      expectedLength = Number(contentLengthHeader);
      if (!Number.isSafeInteger(expectedLength) || expectedLength < 0) {
        rejectRequest("Invalid Content-Length\n");
        return true;
      }
    }
    if (expectedLength > MAX_H2C_BODY_BYTES || head.length > MAX_H2C_BODY_BYTES) {
      rejectRequest("h2c body is too large\n");
      return true;
    }

    const chunks = [head];
    let received = head.length;
    let settled = false;
    const serve = (body) => {
      if (settled) return;
      settled = true;
      socket.off("data", readBody);
      const replay = new http.IncomingMessage(socket);
      Object.assign(replay, { method: req.method, url: req.url, headers: req.headers, complete: true });
      if (body?.length) replay.push(body);
      replay.push(null);

      const res = new http.ServerResponse(replay);
      res.shouldKeepAlive = false;
      res.assignSocket(socket);
      res.once("finish", () => socket.end());
      Promise.resolve()
        .then(() => wrapped(replay, res))
        .catch((error) => {
          console.error("Failed to downgrade h2c request", error);
          socket.destroy();
        });
    };
    const fail = (error) => {
      if (settled) return;
      settled = true;
      socket.off("data", readBody);
      rejectRequest(`${error.message}\n`);
    };
    const tryComplete = () => {
      try {
        if (transferEncoding) {
          const result = parseChunkedBody(Buffer.concat(chunks, received));
          if (result) serve(result.body);
          return;
        }
        if (received >= expectedLength) {
          serve(Buffer.concat(chunks, received).subarray(0, expectedLength));
        }
      } catch (error) {
        fail(error);
      }
    };
    const readBody = (chunk) => {
      if (settled) return;
      chunks.push(chunk);
      received += chunk.length;
      if (received > MAX_H2C_BODY_BYTES) {
        fail(new Error("h2c body is too large"));
        return;
      }
      tryComplete();
    };

    if (transferEncoding || received < expectedLength) {
      socket.on("data", readBody);
      socket.on("end", () => {
        if (!settled) fail(new Error("h2c request ended before the body was complete"));
      });
      socket.resume();
    }
    tryComplete();

    delete req.headers.upgrade;
    delete req.headers["http2-settings"];
    req.headers.connection = "close";
    return true;
  };

  return server;
};

if (require.main === module) {
  const standalone = path.join(__dirname, "server.js");
  if (fs.existsSync(standalone)) {
    require(standalone);
  } else {
    // Source checkouts may not have a standalone build beside custom-server.js.
    const nextBin = require.resolve("next/dist/bin/next");
    process.argv = [process.argv[0], nextBin, "start", ...process.argv.slice(2)];
    require(nextBin);
  }
}
