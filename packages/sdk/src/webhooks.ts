import type { AlertWebhook } from "./alerts.js";

/** A webhook request that isn't a genuine, recent 4Shadow notification. Answer it with 400 or 401. */
export class WebhookVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WebhookVerificationError";
  }
}

export interface VerifyWebhookOptions {
  /** Reject notifications whose timestamp is further than this from now (default 300 s). */
  toleranceSeconds?: number;
  /** The current time (for tests). */
  now?: Date | number;
}

/** Request headers as `Headers` (fetch, Request) or a plain object (Node's `req.headers`, Express). */
export type WebhookHeaders = Headers | Record<string, string | string[] | undefined>;

function header(headers: WebhookHeaders, name: string): string | undefined {
  if (typeof (headers as Headers).get === "function") return (headers as Headers).get(name) ?? undefined;
  const record = headers as Record<string, string | string[] | undefined>;
  const key = Object.keys(record).find((k) => k.toLowerCase() === name);
  const value = key === undefined ? undefined : record[key];
  return Array.isArray(value) ? value[0] : value;
}

function base64(text: string): Uint8Array<ArrayBuffer> {
  const bin = atob(text);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * Check that a webhook request came from 4Shadow and return the notification. Notifications follow
 * [Standard Webhooks](https://www.standardwebhooks.com): the `webhook-signature` header holds
 * `v1,` + an HMAC-SHA256 of `{webhook-id}.{webhook-timestamp}.{body}` keyed with the alert's
 * `whsec_` secret. Pass the body exactly as received (a string or bytes), not parsed JSON.
 * A retry has the same `webhook-id`, so you can drop duplicates.
 *
 * ```ts
 * // Express: app.post("/hooks/4shadow", express.text({ type: "*\/*" }), handler)
 * const hook = await verifyWebhook(process.env.ALERT_SECRET!, req.headers, req.body);
 * if (hook.type === "alert.event.created") notify(hook.data.event!);
 * ```
 *
 * Works in Node 20+, browsers, Deno, Bun and edge runtimes (Web Crypto).
 */
export async function verifyWebhook(
  secret: string,
  headers: WebhookHeaders,
  body: string | Uint8Array | ArrayBuffer,
  options: VerifyWebhookOptions = {},
): Promise<AlertWebhook> {
  const id = header(headers, "webhook-id");
  const timestamp = header(headers, "webhook-timestamp");
  const signatures = header(headers, "webhook-signature");
  if (!id || !timestamp || !signatures) {
    throw new WebhookVerificationError("Missing webhook-id, webhook-timestamp or webhook-signature header");
  }
  const sent = Number(timestamp);
  if (!/^\d+$/.test(timestamp) || !Number.isFinite(sent)) throw new WebhookVerificationError("Invalid webhook-timestamp");
  const now = options.now === undefined ? Date.now() : Number(options.now);
  if (Math.abs(now / 1000 - sent) > (options.toleranceSeconds ?? 300)) {
    throw new WebhookVerificationError("The webhook-timestamp is too far from now (a replayed or delayed request?)");
  }

  const text = typeof body === "string" ? body : new TextDecoder().decode(body);
  let keyBytes: Uint8Array<ArrayBuffer>;
  try {
    keyBytes = base64(secret.startsWith("whsec_") ? secret.slice(6) : secret);
  } catch {
    throw new WebhookVerificationError("The secret isn't a whsec_ secret");
  }
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  const signed = new TextEncoder().encode(`${id}.${timestamp}.${text}`);

  for (const part of signatures.split(" ")) {
    const [version, value] = part.split(",", 2);
    if (version !== "v1" || !value) continue;
    let signature: Uint8Array<ArrayBuffer>;
    try {
      signature = base64(value);
    } catch {
      continue;
    }
    if (await crypto.subtle.verify("HMAC", key, signature, signed)) {
      try {
        return JSON.parse(text) as AlertWebhook;
      } catch {
        throw new WebhookVerificationError("The body isn't JSON");
      }
    }
  }
  throw new WebhookVerificationError("No valid signature (wrong secret, or the body was changed)");
}
