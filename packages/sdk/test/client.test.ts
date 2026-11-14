import { describe, expect, it, vi } from "vitest";
import { ForeshadowClient, ForeshadowError, timeRef } from "../src/index.js";
import { jsonResponse, makeField } from "./helpers.js";

function client(handler: (url: URL, init: RequestInit) => Response, options = {}) {
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => handler(new URL(String(input)), init ?? {}));
  return { c: new ForeshadowClient({ baseUrl: "https://api.test/", apiKey: "k1", fetch, ...options }), fetch };
}

describe("ForeshadowClient", () => {
  it("sends the key as a header outside browsers, and builds forecast queries", async () => {
    const { c, fetch } = client(() => jsonResponse({ run: "2026111300" }));
    await c.forecast({ lat: -8.55, lon: 125.57 }, { vars: ["t2m", "precip"], hours: 24, daily: false });
    const [url, init] = fetch.mock.calls[0]!;
    const u = new URL(String(url));
    expect(u.origin + u.pathname).toBe("https://api.test/v2/forecast");
    expect(Object.fromEntries(u.searchParams)).toEqual({ lat: "-8.55", lon: "125.57", vars: "t2m,precip", hours: "24", daily: "false" });
    expect((init!.headers as Record<string, string>)["api-key"]).toBe("k1");
  });

  it("accepts place names", async () => {
    const { c, fetch } = client(() => jsonResponse({}));
    await c.forecast("Same, Timor-Leste");
    await c.forecast({ q: "Paris" });
    expect(new URL(String(fetch.mock.calls[0]![0])).searchParams.get("q")).toBe("Same, Timor-Leste");
    expect(new URL(String(fetch.mock.calls[1]![0])).searchParams.get("q")).toBe("Paris");
  });

  it("puts the key in the query when asked", async () => {
    const { c, fetch } = client(() => jsonResponse({ results: [] }), { keyIn: "query" });
    await c.searchPlaces("Dili", { limit: 2 });
    const [url, init] = fetch.mock.calls[0]!;
    expect(new URL(String(url)).searchParams.get("api-key")).toBe("k1");
    expect((init!.headers as Record<string, string>)["api-key"]).toBeUndefined();
  });

  it("turns API errors into ForeshadowError with the detail", async () => {
    const { c } = client(() => jsonResponse({ detail: "No place called 'Atlantis' was found." }, 404));
    const err = await c.forecast("Atlantis").catch((e) => e);
    expect(err).toBeInstanceOf(ForeshadowError);
    expect(err.status).toBe(404);
    expect(err.detail).toMatch(/Atlantis/);
    expect(err.retryable).toBe(false);
  });

  it("reads the gateway's error codes; a used-up quota isn't retryable", async () => {
    const body = { error: "quota_exceeded", message: "Daily request limit reached.", resets_at: "2026-11-15T00:00:00Z" };
    const { c } = client(() => jsonResponse(body, 429));
    const err = await c.runs().catch((e) => e);
    expect(err).toBeInstanceOf(ForeshadowError);
    expect(err.code).toBe("quota_exceeded");
    expect(err.detail).toBe("Daily request limit reached.");
    expect(err.resetsAt?.toISOString()).toBe("2026-11-15T00:00:00.000Z");
    expect(err.retryable).toBe(false);

    const limited = await client(() => jsonResponse({ error: "rate_limited" }, 429)).c.runs().catch((e) => e);
    expect(limited.code).toBe("rate_limited");
    expect(limited.retryable).toBe(true);

    const origin = await client(() => jsonResponse({ error: "origin_not_allowed", message: "Not here." }, 403))
      .c.runs()
      .catch((e) => e);
    expect(origin.code).toBe("origin_not_allowed");
    expect(origin.retryable).toBe(false);
  });

  it("reports network failures as status 0", async () => {
    const fetch = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    const c = new ForeshadowClient({ baseUrl: "https://api.test", fetch });
    const err = await c.runs().catch((e) => e);
    expect(err).toBeInstanceOf(ForeshadowError);
    expect(err.status).toBe(0);
    expect(err.retryable).toBe(true);
  });

  it("treats 503 health as unavailable rather than an error", async () => {
    const { c } = client(() => jsonResponse({ status: "unavailable" }, 503));
    expect((await c.health()).status).toBe("unavailable");
  });

  it("fetches and decodes fields", async () => {
    const grid = { lat0: 0, dlat: 1, nlat: 1, lon0: 0, dlon: 1, nlon: 2, wraps: false };
    const { c, fetch } = client(() => new Response(makeField(grid, { t2m: [1.5, 2.5] })));
    const f = await c.field({ vars: ["t2m"], time: 6, run: "2026111300", stride: 2, bbox: [100, -20, 140, 10] });
    expect(Array.from(f.values("t2m"))).toEqual([1.5, 2.5]);
    const u = new URL(String(fetch.mock.calls[0]![0]));
    expect(u.pathname).toBe("/v2/gfs/fields/2026111300/f006");
    expect(Object.fromEntries(u.searchParams)).toEqual({ vars: "t2m", stride: "2", bbox: "100,-20,140,10" });
  });

  it("makes tile URL templates with the key in the query", () => {
    const { c } = client(() => jsonResponse({}));
    expect(c.tileUrl({ variable: "t2m", time: 3 })).toBe("https://api.test/v2/gfs/tiles/latest/t2m/f003/{z}/{x}/{y}.png?api-key=k1");
  });

  it("formats time references", () => {
    expect(timeRef(6)).toBe("f006");
    expect(timeRef(new Date(Date.UTC(2026, 10, 13, 18)))).toBe("2026111318");
    expect(timeRef("f120")).toBe("f120");
  });
});
