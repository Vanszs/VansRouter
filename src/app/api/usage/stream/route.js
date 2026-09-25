import { getActiveRequests, statsEmitter } from "@/lib/usageDb";
import { SSE_HEADERS_DASHBOARD } from "open-sse/utils/sseConstants.js";

export const dynamic = "force-dynamic";

export async function GET(request) {
  const encoder = new TextEncoder();
  let cleanup = () => {};

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      let keepalive = null;

      const close = () => {
        if (closed) return;
        closed = true;
        statsEmitter.off("update", send);
        statsEmitter.off("pending", send);
        clearInterval(keepalive);
        request.signal.removeEventListener("abort", close);
        try {
          controller.close();
        } catch {
          // The browser may already have cancelled the stream.
        }
      };

      const send = async () => {
        if (closed) return;
        try {
          const payload = await getActiveRequests();
          if (closed) return;
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
        } catch {
          close();
        }
      };

      cleanup = close;
      request.signal.addEventListener("abort", close, { once: true });
      if (request.signal.aborted) {
        close();
        return;
      }
      statsEmitter.on("update", send);
      statsEmitter.on("pending", send);
      await send();

      if (!closed) {
        keepalive = setInterval(() => {
          if (closed) return;
          try {
            controller.enqueue(encoder.encode(": ping\n\n"));
          } catch {
            close();
          }
        }, 25_000);
      }
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: SSE_HEADERS_DASHBOARD,
  });
}
