import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { checkField, PublicMap, RULES } from "./public-map.ts";

const API = "https://api.example.test";
const RUN = "2026111600";

/** A fake 4Shadow: records what it was asked, answers fields with bytes and everything else with JSON. */
function upstream(status = 200) {
  const calls: { url: string; key: string | null }[] = [];
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, key: new Headers(init?.headers).get("api-key") });
    if (status !== 200) return Response.json({ detail: "Run not found" }, { status });
    if (url.includes("/fields/")) {
      return new Response(new Uint8Array(4096).fill(7), { headers: { "content-type": "application/octet-stream", "x-forecast-run": RUN } });
    }
    if (url.endsWith(".png")) return new Response(new Uint8Array([137, 80, 78, 71]), { headers: { "content-type": "image/png" } });
    return Response.json({ ok: true });
  }) as typeof globalThis.fetch;
  return { calls, fetch };
}

function setup(options: { status?: number; cacheBytes?: number } = {}) {
  const up = upstream(options.status);
  let t = 1_000_000;
  const map = new PublicMap({ apiUrl: API, apiKey: "secret-key", fetch: up.fetch, now: () => t, cacheBytes: options.cacheBytes });
  const get = (path: string, address = "203.0.113.5", gzip = false, method = "GET") =>
    map.handle(method, path.split("?")[0]!, new URL(`http://map.test/api/4shadow/${path}`), address, gzip);
  return { map, up, get, tick: (s: number) => (t += s * 1000) };
}

describe("public map door", () => {
  it("forwards the map's reads with the key, and only the parameters each one takes", async () => {
    const { up, get } = setup();
    const res = await get("v2/forecast?lat=-8.55&lon=125.56&hours=48&api-key=stolen&evil=1");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("public, max-age=300");
    expect(up.calls).toEqual([{ url: `${API}/v2/forecast?lat=-8.55&lon=125.56&hours=48`, key: "secret-key" }]);
  });

  it("refuses writes, early warnings and anything the map doesn't use", async () => {
    const { up, get } = setup();
    expect((await get("v2/alerts")).status).toBe(404);
    expect((await get("v2/alerts", undefined, false, "POST")).status).toBe(404);
    expect((await get("v2/forecast?lat=1&lon=2", undefined, false, "POST")).status).toBe(405);
    expect((await get("v2/keys")).status).toBe(404);
    expect((await get("v1/forecast")).status).toBe(404);
    const body = (await (await get("v2/alerts")).json()) as { detail: string };
    expect(body.detail).toMatch(/Early warnings are off/);
    expect(up.calls).toHaveLength(0);
  });

  it("checks field requests: a few variables, and the full-resolution globe only for an area", () => {
    const q = (s: string) => new URLSearchParams(s);
    expect(checkField(q("vars=u10,v10&stride=2"))).toBeNull();
    expect(checkField(q("vars=u10,v10&stride=1&bbox=100,-20,140,10"))).toBeNull();
    expect(checkField(q("vars=u10,v10&stride=1"))).toMatch(/whole globe/);
    expect(checkField(q("vars=a,b,c,d,e&stride=2"))).toMatch(/up to 4/);
    expect(checkField(q("vars=U10&stride=2"))).toMatch(/vars/);
    expect(checkField(q("vars=t2m&stride=9"))).toMatch(/stride/);
    expect(checkField(q("vars=t2m&stride=1&bbox=-180,-90,180,90"))).toMatch(/too large/);
    // Across the antimeridian, measured the short way round.
    expect(checkField(q("vars=t2m&stride=1&bbox=170,-30,-170,0"))).toBeNull();
  });

  it("fetches each field once for every visitor, and compresses it for browsers that ask", async () => {
    const { up, get, map } = setup();
    const path = `v2/gfs/fields/${RUN}/f006?vars=u10,v10&stride=2`;
    const a = await get(path, "198.51.100.1");
    const b = await get(path, "198.51.100.2", true);
    expect(up.calls).toHaveLength(1);
    expect(a.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(a.headers.get("x-forecast-run")).toBe(RUN);
    expect(new Uint8Array(await a.arrayBuffer())).toHaveLength(4096);
    expect(b.headers.get("content-encoding")).toBe("gzip");
    expect(new Uint8Array(gunzipSync(new Uint8Array(await b.arrayBuffer())))).toEqual(new Uint8Array(4096).fill(7));
    expect(map.stats()).toMatchObject({ entries: 1, bytes: 4096, upstream: 1 });
  });

  it("serves tiles from the cache too, without compressing PNGs again", async () => {
    const { up, get } = setup();
    const path = `v2/gfs/tiles/${RUN}/t2m/f006/3/4/2.png`;
    await get(path);
    const res = await get(path, undefined, true);
    expect(up.calls).toHaveLength(1);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("content-encoding")).toBeNull();
  });

  it("passes an error on and doesn't keep it", async () => {
    const { up, get } = setup({ status: 404 });
    const path = `v2/gfs/fields/${RUN}/f006?vars=t2m&stride=2`;
    const res = await get(path);
    expect(res.status).toBe(404);
    expect(((await res.json()) as { detail: string }).detail).toBe("Run not found");
    await get(path);
    expect(up.calls).toHaveLength(2);
  });

  it("limits each visitor, and lets them back in when the window ends", async () => {
    const { get, tick } = setup();
    const places = RULES.find((r) => r.name === "places")!;
    for (let i = 0; i < places.limit[0]; i++) expect((await get(`v2/places?q=Dili${i}`)).status).toBe(200);
    const refused = await get("v2/places?q=Dili");
    expect(refused.status).toBe(429);
    expect(await refused.json()).toMatchObject({ code: "rate_limited" });
    expect((await get("v2/places?q=Dili", "192.0.2.9")).status).toBe(200); // someone else
    tick(places.limit[1]);
    expect((await get("v2/places?q=Dili")).status).toBe(200);
  });

  it("forgets the least recently used fields when its memory is full", async () => {
    const { up, get, map } = setup({ cacheBytes: 3 * 4096 });
    const field = (h: number) => `v2/gfs/fields/${RUN}/f00${h}?vars=t2m&stride=2`;
    for (const h of [1, 2, 3]) await get(field(h));
    await get(field(1)); // used again, so 2 is now the oldest
    await get(field(4));
    expect(map.stats()).toMatchObject({ entries: 3, bytes: 3 * 4096 });
    await get(field(1));
    expect(up.calls).toHaveLength(4);
    await get(field(2));
    expect(up.calls).toHaveLength(5);
  });

  it("checks point forecasts and place searches", async () => {
    const { get } = setup();
    expect((await get("v2/forecast?lat=95&lon=0")).status).toBe(400);
    expect((await get("v2/forecast?lat=1&lon=2&run=../keys")).status).toBe(400);
    expect((await get("v2/places?q=x")).status).toBe(400);
    expect((await get("v2/places?lat=-8.5&lon=125.5&limit=3")).status).toBe(200);
  });
});
