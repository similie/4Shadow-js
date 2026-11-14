/**
 * The page's door to the 4Shadow API. It forwards a request to FORESHADOW_API_URL with your key in
 * the api-key header, so the key never reaches the browser: the page's SDK client has
 * `baseUrl: location.origin + "/api/4shadow"` and no key. Only this machine can use it
 * (src/lib/server/local-only.ts).
 *
 * For the webhook rig, it also keeps the secret the API returns once when an alert gets a webhook.
 */
import { error, type RequestHandler } from "@sveltejs/kit";
import { FORESHADOW_API_KEY, FORESHADOW_API_URL } from "$app/env/private";
import { forgetSecret, rememberSecret } from "#lib/server/rig.ts";

const REQUEST_HEADERS = ["accept", "content-type", "if-none-match", "if-modified-since"];
const RESPONSE_HEADERS = ["content-type", "cache-control", "etag", "last-modified", "expires", "vary"];
const ALERT = /^v2\/alerts\/([^/]+)$/;

const forward: RequestHandler = async ({ params, url, request }) => {
  const path = params.path ?? "";
  if (!path.startsWith("v2/")) error(404, "Only /v2 paths are forwarded");

  const target = new URL(`${FORESHADOW_API_URL}/${path}`);
  for (const [k, v] of url.searchParams) if (k !== "api-key") target.searchParams.append(k, v);
  const headers = new Headers();
  for (const h of REQUEST_HEADERS) {
    const v = request.headers.get(h);
    if (v) headers.set(h, v);
  }
  if (FORESHADOW_API_KEY) headers.set("api-key", FORESHADOW_API_KEY);
  const method = request.method;
  const body = method === "GET" || method === "HEAD" ? undefined : await request.arrayBuffer();

  let res: Response;
  try {
    res = await fetch(target, { method, headers, body, signal: request.signal });
  } catch (e) {
    error(502, `Can't reach ${FORESHADOW_API_URL}: ${(e as Error).message}`);
  }
  const out = new Headers();
  for (const h of RESPONSE_HEADERS) {
    const v = res.headers.get(h);
    if (v) out.set(h, v);
  }

  // Alerts: keep webhook secrets for the receiver, and drop a deleted alert's.
  if (path.startsWith("v2/alerts") && method !== "GET" && res.ok) {
    const deleted = method === "DELETE" ? ALERT.exec(path)?.[1] : undefined;
    if (deleted) forgetSecret(decodeURIComponent(deleted));
    if (res.headers.get("content-type")?.includes("json")) {
      const text = await res.text();
      try {
        const data = JSON.parse(text) as { id?: string; webhook?: { secret?: string } | null };
        if (data.id && data.webhook?.secret) rememberSecret(data.id, data.webhook.secret);
      } catch {
        // not an alert
      }
      return new Response(text, { status: res.status, headers: out });
    }
  }
  return new Response(res.body, { status: res.status, headers: out });
};

export const GET = forward;
export const POST = forward;
export const PATCH = forward;
export const DELETE = forward;
