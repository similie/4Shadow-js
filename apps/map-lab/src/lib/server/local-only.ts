/**
 * Who may use the lab's server. Through a tunnel (`npm run tunnel`) the dev server is on the internet so
 * that 4Shadow can deliver webhooks, but the API proxy would hand anyone your key, and Vite would serve
 * your files. So a request from anywhere but this machine may only deliver a webhook.
 *
 * A public map (`MAP_MODE=public`, see public-map.ts) is the other way round: anyone may read pages and
 * map data, nobody may write, and the early-warning rig (webhooks, its feed) is closed.
 *
 * Used by the Vite dev server (vite.config.ts, ahead of Vite's own file serving) and by SvelteKit
 * (src/hooks.server.ts, for `npm start`).
 */

/** The one thing the internet may do here. */
export const WEBHOOK_PATH = "/hooks/4shadow";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
/** Set by tunnels and proxies. A browser on this machine talking to the lab directly never sends them. */
const FORWARDED = ["x-forwarded-for", "x-forwarded-host", "forwarded", "cf-connecting-ip", "ngrok-trace-id"];

type HeaderBag = Headers | Record<string, string | string[] | undefined>;

function has(headers: HeaderBag, name: string): boolean {
  return headers instanceof Headers ? headers.has(name) : headers[name] !== undefined;
}

/** A request from a browser or script on this machine, not through a tunnel or proxy. */
export function isLocal(host: string | undefined, headers: HeaderBag): boolean {
  const hostname = (host ?? "").replace(/:\d+$/, "").toLowerCase();
  return LOCAL_HOSTS.has(hostname) && !FORWARDED.some((h) => has(headers, h));
}

export type MapMode = "local" | "public";

export function allowed(method: string, path: string, host: string | undefined, headers: HeaderBag, mode: MapMode = "local"): boolean {
  if (mode === "public") {
    return (method === "GET" || method === "HEAD") && !path.startsWith("/api/rig") && !path.startsWith("/hooks/");
  }
  return isLocal(host, headers) || (method === "POST" && path === WEBHOOK_PATH);
}
