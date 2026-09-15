#!/usr/bin/env node
import readline from "node:readline";

const methods = [];
const rl = readline.createInterface({ input: process.stdin });
let prompt = false;
const writeJson = (value, fragmented = false) => {
  const output = JSON.stringify(value) + "\n";
  if (fragmented) {
    process.stdout.write(output.slice(0, 7));
    setTimeout(() => process.stdout.write(output.slice(7)), 1);
  } else {
    process.stdout.write(output);
  }
};

process.stderr.write(`FAKE_DEVIN_OBSERVED ${JSON.stringify({
  cwd: process.cwd(),
  secret: process.env.SECRET_ENV,
  apiKey: process.env.WINDSURF_API_KEY,
})}\n`);

rl.on("line", (line) => {
  const request = JSON.parse(line);
  methods.push(request.method);
  if (request.method === "initialize") {
    writeJson({ jsonrpc: "2.0", id: request.id, result: {} });
  } else if (request.method === "session/new") {
    writeJson({ jsonrpc: "2.0", id: request.id, result: { sessionId: "fake-session" } });
  } else if (request.method === "session/prompt") {
    prompt = true;
    process.stderr.write(`FAKE_DEVIN_OBSERVED ${methods.join(",")}\n`);
    if (request.params?.content?.[0]?.text === "[User]\nhang") return;
    if (request.params?.content?.[0]?.text === "[User]\ncorrelated") {
      setTimeout(() => writeJson({ jsonrpc: "2.0", id: request.id, result: { text: "correlated result", stopReason: "end_turn" } }), 5);
      return;
    }
    let finished = false;
    const update = (type, text) => writeJson({ jsonrpc: "2.0", method: "session/update", params: { type, text } }, true);
    update("text_delta", "frag");
    setTimeout(() => update("text_delta", "mented"), 10);
    setTimeout(() => {
      update("message_stop");
      finished = true;
    }, 25);
  }
});
process.stdin.on("end", () => {
  const tryExit = () => {
    if (!prompt || finished) process.exit(0);
    else setTimeout(tryExit, 10);
  };
  tryExit();
});
