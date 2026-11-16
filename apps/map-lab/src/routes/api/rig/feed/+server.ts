/** Webhooks as the receiver gets them, for the page: server-sent events, starting with recent ones. */
import type { RequestHandler } from "@sveltejs/kit";
import { recent, subscribe, type Received } from "#lib/server/rig.ts";

export const GET: RequestHandler = ({ request }) => {
  const encoder = new TextEncoder();
  let stop = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (r: Received) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(r)}\n\n`));
      for (const r of [...recent()].reverse()) send(r);
      const unsubscribe = subscribe(send);
      const ping = setInterval(() => controller.enqueue(encoder.encode(": ping\n\n")), 25_000);
      stop = () => {
        clearInterval(ping);
        unsubscribe();
      };
      request.signal.addEventListener("abort", () => {
        stop();
        try {
          controller.close();
        } catch {
          // already closed
        }
      });
    },
    cancel: () => stop(),
  });
  return new Response(stream, {
    headers: { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" },
  });
};
