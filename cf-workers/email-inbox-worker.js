// Cloudflare Email Routing Inbox Worker
// Catch-all email inbox via Email Routing + KV.
// Deploy: wrangler deploy
// Set route: catch-all *@yourdomain.com → this worker
//
// API:
//   GET  /api/address             → {address:"cf-xxx@yourdomain.com"}
//   GET  /api/messages?addr=xxx   → [{from,subject,text,receivedAt}]
//  GET  /api/messages/:id/raw    → {html} (fetch full HTML body)
// DELETE /api/messages?addr=xxx   → clear inbox for addr

function decodeQuotedPrintable(str) {
  return str
    .replace(/=\r?\n/g, "")                     // soft line break continuation
    .replace(/=([0-9A-Fa-f]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

function parseMime(raw) {
  const headerEnd = raw.indexOf("\r\n\r\n");
  const body = headerEnd !== -1 ? raw.slice(headerEnd + 4) : raw;
  let text = "", html = "";
  const ctMatch = raw.match(/Content-Transfer-Encoding:\s*(\S+)/i);
  const isQP = ctMatch && ctMatch[1].toLowerCase() === "quoted-printable";
  const boundaryMatch = raw.match(/boundary="?([^"\s;]+)"?/);
  if (boundaryMatch) {
    const boundary = boundaryMatch[1];
    const parts = body.split(`--${boundary}`);
    for (const part of parts) {
      const sep = part.indexOf("\r\n\r\n");
      if (sep === -1) continue;
      const h = part.slice(0, sep);
      const b = part.slice(sep + 4).trim();
      const isPartQP = /Content-Transfer-Encoding:\s*quoted-printable/i.test(h) || isQP;
      const decoded = isPartQP ? decodeQuotedPrintable(b) : b;
      if (h.includes("text/html") && !h.includes('name=')) html = decoded;
      else if (h.includes("text/plain") && !h.includes('name=')) text = text || decoded;
    }
  }
  if (!text && !html) { text = body; html = body; }
  return { text, html };
}

const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
function randomLocal() {
  let s = "cf";
  for (let i = 0; i < 12; i++) s += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return s;
}

export default {
  async email(message, env, ctx) {
    const to = message.to.toLowerCase();
    const rawText = await new Response(message.raw).text();
    const { text, html } = parseMime(rawText);
    const headers = {};
    message.headers.forEach((val, key) => { headers[key] = val; });
    const entry = {
      from: message.from,
      to,
      subject: message.subject || "",
      text,
      html,
      receivedAt: new Date().toISOString(),
      headers,
    };
    const key = `inbox:${to}`;
    const existing = await env.INBOX.get(key, "text");
    const list = existing ? JSON.parse(existing) : [];
    list.push(entry);
    if (list.length > 50) list.shift();
    await env.INBOX.put(key, JSON.stringify(list));
    ctx.waitUntil(Promise.resolve());
  },

  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const method = request.method;

    if (method === "GET" && url.pathname === "/api/address") {
      const local = url.searchParams.get("local") || randomLocal();
      const domain = env.DOMAIN || url.searchParams.get("domain") || "tandatangan.io";
      const address = `${local}@${domain}`;
      return Response.json({ address });
    }

    if (url.pathname === "/api/messages") {
      const addr = url.searchParams.get("addr") || "";
      if (!addr) return Response.json({ error: "missing addr" }, { status: 400 });

      if (method === "GET") {
        const key = `inbox:${addr.toLowerCase()}`;
        const raw = await env.INBOX.get(key, "text");
        const list = raw ? JSON.parse(raw) : [];
        return Response.json(list);
      }

      if (method === "DELETE") {
        const key = `inbox:${addr.toLowerCase()}`;
        await env.INBOX.delete(key);
        return Response.json({ ok: true });
      }
    }

    if (method === "GET" && url.pathname.startsWith("/api/messages/") && url.pathname.endsWith("/raw")) {
      const idx = parseInt(url.pathname.split("/")[3], 10);
      const addr = url.searchParams.get("addr") || "";
      if (!addr) return Response.json({ error: "missing addr" }, { status: 400 });
      const key = `inbox:${addr.toLowerCase()}`;
      const raw = await env.INBOX.get(key, "text");
      const list = raw ? JSON.parse(raw) : [];
      if (idx < 0 || idx >= list.length) return Response.json({ error: "not found" }, { status: 404 });
      return Response.json({ html: list[idx].html || list[idx].text || "" });
    }

    return new Response("not found", { status: 404 });
  },
};
