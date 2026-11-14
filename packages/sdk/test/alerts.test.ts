import { createHmac, randomBytes } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { ForeshadowClient, ForeshadowError, verifyWebhook, WebhookVerificationError } from "../src/index.js";
import { jsonResponse } from "./helpers.js";

function client(handler: (url: URL, init: RequestInit) => Response, options = {}) {
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => handler(new URL(String(input)), init ?? {}));
  return { c: new ForeshadowClient({ baseUrl: "https://api.test", apiKey: "k1", fetch, ...options }), fetch };
}

const call = (fetch: ReturnType<typeof vi.fn>, n = 0) => {
  const [url, init] = fetch.mock.calls[n]! as [string, RequestInit];
  const u = new URL(url);
  return {
    method: init.method,
    path: u.pathname,
    query: Object.fromEntries(u.searchParams),
    headers: init.headers as Record<string, string>,
    body: init.body === undefined ? undefined : JSON.parse(String(init.body)),
  };
};

const rain = {
  name: "Heavy rain",
  area: { type: "Point" as const, coordinates: [125.57, -8.56] as [number, number] },
  conditions: [{ variable: "precip", operator: ">=" as const, threshold: 50, accumulate_hours: 24 }],
};

describe("client.alerts", () => {
  it("sends JSON with the key in the header, even where other calls put it in the query", async () => {
    const { c, fetch } = client(() => jsonResponse({ id: "a1" }, 201), { keyIn: "query" });
    await c.alerts.create({ ...rain, webhook_url: "https://example.org/hook" });
    const r = call(fetch);
    expect(r).toMatchObject({ method: "POST", path: "/v2/alerts", query: {} });
    expect(r.headers["api-key"]).toBe("k1");
    expect(r.headers["content-type"]).toBe("application/json");
    expect(r.body).toEqual({ ...rain, webhook_url: "https://example.org/hook" });
  });

  it("maps each method to its path", async () => {
    const { c, fetch } = client(() => jsonResponse({}));
    await c.alerts.list();
    await c.alerts.get("a1");
    await c.alerts.update("a1", { lead_days: 5 });
    await c.alerts.delete("a1");
    await c.alerts.preview({ area: rain.area, conditions: rain.conditions, run: "2026111300" });
    await c.alerts.events();
    await c.alerts.events({ alert: "a1", status: "all", limit: 10 });
    await c.alerts.eventsGeoJson({ status: "upcoming" });
    await c.alerts.deliveries("a1", { limit: 5 });
    await c.alerts.test("a1");
    await c.alerts.rotateSecret("a1");
    const calls = fetch.mock.calls.map((_, i) => {
      const r = call(fetch, i);
      return `${r.method} ${r.path}${Object.keys(r.query).length ? "?" + new URLSearchParams(r.query) : ""}${r.body ? " +body" : ""}`;
    });
    expect(calls).toEqual([
      "GET /v2/alerts",
      "GET /v2/alerts/a1",
      "PATCH /v2/alerts/a1 +body",
      "DELETE /v2/alerts/a1",
      "POST /v2/alerts/preview +body",
      "GET /v2/alerts/events",
      "GET /v2/alerts/a1/events?status=all&limit=10",
      "GET /v2/alerts/events?status=upcoming&format=geojson",
      "GET /v2/alerts/a1/deliveries?limit=5",
      "POST /v2/alerts/a1/test",
      "POST /v2/alerts/a1/secret",
    ]);
  });

  it("reports the API's problems in the error", async () => {
    const { c } = client(() => jsonResponse({ error: "Invalid alert", detail: ["name is required", "area is required"] }, 422));
    const err = await c.alerts.create({} as never).catch((e) => e);
    expect(err).toBeInstanceOf(ForeshadowError);
    expect(err.status).toBe(422);
    expect(err.detail).toBe("Invalid alert: name is required; area is required");
    const plan = client(() => jsonResponse({ error: "Your plan allows 3 alerts; delete one or upgrade" }, 403));
    expect((await plan.c.alerts.create(rain).catch((e) => e)).detail).toBe("Your plan allows 3 alerts; delete one or upgrade");
  });

  it("needs an API key", async () => {
    const c = new ForeshadowClient({ fetch: vi.fn() });
    expect(() => c.alerts.list()).toThrow(/API key/);
  });
});

// The Standard Webhooks reference vector (standard-webhooks/standard-webhooks, spec tests).
const ref = {
  secret: "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw",
  id: "msg_p5jXN8AQM9LWM0D4loKWxJek",
  timestamp: 1614265330,
  body: '{"test": 2432232314}',
  signature: "v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=",
};
const refHeaders = (signature = ref.signature, timestamp = String(ref.timestamp)) => ({
  "webhook-id": ref.id,
  "webhook-timestamp": timestamp,
  "webhook-signature": signature,
});
const at = { now: ref.timestamp * 1000 };

describe("verifyWebhook", () => {
  it("accepts the Standard Webhooks reference vector", async () => {
    expect(await verifyWebhook(ref.secret, refHeaders(), ref.body, at)).toEqual({ test: 2432232314 });
  });

  it("reads Headers, Node-style header objects and bytes", async () => {
    expect(await verifyWebhook(ref.secret, new Headers(refHeaders()), ref.body, at)).toEqual({ test: 2432232314 });
    const node = { "Webhook-Id": [ref.id], "WEBHOOK-TIMESTAMP": String(ref.timestamp), "webhook-signature": ref.signature };
    expect(await verifyWebhook(ref.secret, node, new TextEncoder().encode(ref.body), at)).toEqual({ test: 2432232314 });
  });

  it("accepts any one valid signature among several", async () => {
    const both = `v1,${Buffer.alloc(32).toString("base64")} v2,whatever ${ref.signature}`;
    expect(await verifyWebhook(ref.secret, refHeaders(both), ref.body, at)).toEqual({ test: 2432232314 });
  });

  it("verifies what the 4Shadow site signs", async () => {
    const secret = `whsec_${randomBytes(24).toString("base64")}`;
    const body = JSON.stringify({ type: "alert.test", timestamp: "2026-11-14T00:00:15Z", data: { alert: { id: "a1", name: "x", metadata: {} } } });
    const ts = Math.floor(Date.now() / 1000);
    const sig = createHmac("sha256", Buffer.from(secret.slice(6), "base64")).update(`msg_1.${ts}.${body}`).digest("base64");
    const hook = await verifyWebhook(secret, { "webhook-id": "msg_1", "webhook-timestamp": String(ts), "webhook-signature": `v1,${sig}` }, body);
    expect(hook.type).toBe("alert.test");
  });

  it.each([
    ["a changed body", ref.secret, refHeaders(), '{"test": 2432232315}', /No valid signature/],
    ["the wrong secret", "whsec_" + Buffer.alloc(24).toString("base64"), refHeaders(), ref.body, /No valid signature/],
    ["an old timestamp", ref.secret, refHeaders(ref.signature, String(ref.timestamp - 301)), ref.body, /too far from now/],
    ["a missing header", ref.secret, { "webhook-id": ref.id }, ref.body, /Missing/],
    ["a bad timestamp", ref.secret, refHeaders(ref.signature, "soon"), ref.body, /Invalid webhook-timestamp/],
  ])("rejects %s", async (_name, secret, headers, body, message) => {
    const err = await verifyWebhook(secret, headers, body, at).catch((e) => e);
    expect(err).toBeInstanceOf(WebhookVerificationError);
    expect(err.message).toMatch(message);
  });
});
