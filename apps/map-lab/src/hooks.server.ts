import type { Handle } from "@sveltejs/kit/hooks";
import { allowed } from "#lib/server/local-only.ts";

// The same rule as the dev server's (vite.config.ts), for `npm start`: through a tunnel, only webhook
// deliveries get in. Everything else, the API proxy above all, answers only this machine.
export const handle: Handle = ({ event, resolve }) => {
  const { request, url } = event;
  if (!allowed(request.method, url.pathname, request.headers.get("host") ?? undefined, request.headers)) {
    return new Response("Not found", { status: 404 });
  }
  return resolve(event);
};
