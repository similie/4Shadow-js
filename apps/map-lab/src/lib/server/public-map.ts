/**
 * The API door for a map that is on the internet (`MAP_MODE=public`). Visitors have no key, so the
 * lab's server forwards only what the map draws, with your key added: GET only, checked parameters,
 * limits per visitor and for everyone together, and a shared memory cache for fields and tiles,
 * which never change for a given run. Early warnings belong to your account, so they stay off.
 *
 * What it costs you: each distinct field or tile is fetched from 4Shadow once per run while it stays
 * in the cache, however many people look at it. Point forecasts and place searches are fetched per
 * visitor, within the limits below.
 */
import { gzipSync } from "node:zlib";

export interface PublicMapOptions {
  apiUrl: string;
  apiKey: string | undefined;
  /** Memory for cached fields and tiles, in bytes. */
  cacheBytes?: number;
  fetch?: typeof fetch;
  now?: () => number;
}

type Rule = {
  name: string;
  path: RegExp;
  params: string[];
  /** Cache-Control for browsers (and any CDN in front). */
  cache: string;
  /** Requests per visitor per window: [count, seconds]. */
  limit: [number, number];
  /** Kept in this server's memory: true for data that never changes within a run. */
  shared?: boolean;
  check?: (q: URLSearchParams) => string | null;
};

const MODEL = "([a-z][a-z0-9_]{0,15})";
const RUN = "(latest|\\d{10})";
const STEP = "(f\\d{3}|\\d{10})";
const ID = /^[a-z0-9_]{1,32}$/;
/** Largest area at full 0.25° resolution: a quarter of the globe (the map asks for the view, from zoom 3). */
const MAX_DETAIL_CELLS = (1440 * 721) / 4;

const num = (v: string | null, lo: number, hi: number) => v !== null && v.trim() !== "" && Number.isFinite(+v) && +v >= lo && +v <= hi;
const ids = (v: string | null, max: number) => !!v && v.split(",").length <= max && v.split(",").every((x) => ID.test(x));

/** Fields: a few variables at a time; the whole globe only at 0.5° or coarser. */
export function checkField(q: URLSearchParams): string | null {
  if (!ids(q.get("vars"), 4)) return "vars: up to 4 variable ids";
  const stride = q.get("stride") ?? "1";
  if (!/^[1-8]$/.test(stride)) return "stride: 1 to 8";
  const bbox = q.get("bbox");
  if (bbox) {
    const b = bbox.split(",").map(Number);
    if (b.length !== 4 || b.some((x) => !Number.isFinite(x))) return "bbox: west,south,east,north";
    const [w, s, e, n] = b as [number, number, number, number];
    const width = ((((e - w) % 360) + 360) % 360) || 360;
    const cells = (width / 0.25) * ((n - s) / 0.25);
    if (s < -90 || n > 90 || n <= s || cells / Number(stride) ** 2 > MAX_DETAIL_CELLS) return "bbox: too large";
  } else if (stride === "1") return "The whole globe at 0.25° isn't served here: zoom in, or use the API with your own key";
  return null;
}

export const RULES: Rule[] = [
  { name: "runs", path: new RegExp(`^v2/${MODEL}/runs$`), params: [], cache: "public, max-age=60", limit: [120, 600] },
  { name: "runs", path: new RegExp(`^v2/${MODEL}/runs/${RUN}$`), params: [], cache: "public, max-age=60", limit: [120, 600] },
  { name: "variables", path: new RegExp(`^v2/${MODEL}/variables$`), params: [], cache: "public, max-age=3600", limit: [120, 600] },
  {
    name: "fields",
    path: new RegExp(`^v2/${MODEL}/fields/\\d{10}/${STEP}$`),
    params: ["vars", "stride", "bbox"],
    cache: "public, max-age=31536000, immutable",
    // Playing a whole run, with detail while zoomed in, is a few hundred fields.
    limit: [3000, 600],
    shared: true,
    check: checkField,
  },
  {
    name: "tiles",
    path: new RegExp(`^v2/${MODEL}/tiles/\\d{10}/[a-z0-9_]{1,32}/${STEP}/([0-9]|1[0-2])/\\d{1,4}/\\d{1,4}\\.png$`),
    params: [],
    cache: "public, max-age=31536000, immutable",
    limit: [3000, 600],
    shared: true,
  },
  {
    name: "forecast",
    path: /^v2\/forecast$/,
    params: ["lat", "lon", "vars", "hours", "start", "tz", "daily", "run", "model"],
    cache: "public, max-age=300",
    limit: [120, 600],
    check: (q) =>
      !num(q.get("lat"), -90, 90) || !num(q.get("lon"), -180, 360)
        ? "lat and lon"
        : q.has("vars") && !ids(q.get("vars"), 40)
          ? "vars: up to 40 variable ids"
          : q.has("hours") && !num(q.get("hours"), 1, 384)
            ? "hours: 1 to 384"
            : q.has("run") && !/^(latest|\d{10})$/.test(q.get("run") ?? "")
              ? "run"
              : null,
  },
  {
    name: "places",
    path: /^v2\/places$/,
    params: ["q", "lat", "lon", "limit", "min_population"],
    cache: "public, max-age=3600",
    limit: [60, 60],
    check: (q) => {
      if (q.has("q")) return (q.get("q") ?? "").trim().length < 2 || (q.get("q") ?? "").length > 100 ? "q: 2 to 100 characters" : null;
      return num(q.get("lat"), -90, 90) && num(q.get("lon"), -180, 360) ? null : "q, or lat and lon";
    },
  },
];

/** Everyone together: a backstop for your key's quota, and for visitors that share an address. */
export const GLOBAL_LIMIT: [number, number] = [20_000, 600];

export class PublicMapError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
  ) {
    super(message);
  }
}

type Cached = { body: ArrayBuffer; gz?: Uint8Array<ArrayBuffer>; type: string; run: string | null };

/** Counters in fixed windows, kept in memory: one server process, no database. */
class Counter {
  private readonly windows = new Map<string, { until: number; n: number }>();
  constructor(private readonly now: () => number) {}

  hit(key: string, seconds: number): number {
    const t = this.now();
    let w = this.windows.get(key);
    if (!w || w.until <= t) {
      if (this.windows.size > 50_000) for (const [k, v] of this.windows) if (v.until <= t) this.windows.delete(k);
      w = { until: t + seconds * 1000, n: 0 };
      this.windows.set(key, w);
    }
    return ++w.n;
  }
}

export class PublicMap {
  private readonly apiUrl: string;
  private readonly apiKey: string | undefined;
  private readonly cacheBytes: number;
  private readonly fetchImpl: typeof fetch;
  private readonly counter: Counter;
  private readonly cache = new Map<string, Promise<Cached>>();
  private readonly sizes = new Map<string, number>();
  private cachedBytes = 0;
  /** Requests sent to 4Shadow, for tests and logs. */
  upstream = 0;

  constructor(options: PublicMapOptions) {
    this.apiUrl = options.apiUrl.replace(/\/+$/, "");
    this.apiKey = options.apiKey;
    this.cacheBytes = options.cacheBytes ?? 256 * 1024 * 1024;
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.counter = new Counter(options.now ?? Date.now);
  }

  /** Answers one `/api/4shadow/<path>` request from a visitor at `address`. */
  async handle(method: string, path: string, url: URL, address: string, acceptGzip: boolean): Promise<Response> {
    try {
      return await this.answer(method, path, url, address, acceptGzip);
    } catch (e) {
      const err = e instanceof PublicMapError ? e : new PublicMapError(502, "4Shadow didn't answer");
      return Response.json({ detail: err.message, ...(err.code ? { code: err.code } : {}) }, { status: err.status });
    }
  }

  private async answer(method: string, path: string, url: URL, address: string, acceptGzip: boolean): Promise<Response> {
    if (path.startsWith("v2/alerts")) throw new PublicMapError(404, "Early warnings are off on a public map");
    if (method !== "GET" && method !== "HEAD") throw new PublicMapError(405, "Only GET here");
    const rule = RULES.find((r) => r.path.test(path));
    if (!rule) throw new PublicMapError(404, "Not something the map uses");

    const q = new URLSearchParams();
    for (const name of rule.params) {
      const v = url.searchParams.get(name);
      if (v !== null) q.set(name, v);
    }
    const problem = rule.check?.(q);
    if (problem) throw new PublicMapError(400, problem);

    if (this.counter.hit(`${rule.name}:${address}`, rule.limit[1]) > rule.limit[0])
      throw new PublicMapError(429, "Too many map requests from your address. Wait a few minutes.", "rate_limited");
    if (this.counter.hit("all", GLOBAL_LIMIT[1]) > GLOBAL_LIMIT[0])
      throw new PublicMapError(429, "The map is busy. Try again in a few minutes.", "rate_limited");

    const target = `${this.apiUrl}/${path}${q.size ? `?${q}` : ""}`;
    if (!rule.shared) {
      const res = await this.get(target, 15_000);
      const headers = new Headers({ "content-type": res.headers.get("content-type") ?? "application/json" });
      if (res.ok) headers.set("cache-control", rule.cache);
      return new Response(await res.arrayBuffer(), { status: res.status, headers });
    }

    const key = `${path}?${q}`;
    let entry = this.cache.get(key);
    if (entry) {
      this.cache.delete(key); // most recently used goes last
      this.cache.set(key, entry);
    } else {
      entry = this.get(target, 20_000).then(async (res) => {
        if (!res.ok) {
          const text = (await res.text().catch(() => "")).slice(0, 300);
          let detail = text;
          try {
            detail = (JSON.parse(text) as { detail?: string }).detail ?? text;
          } catch {
            // not JSON
          }
          throw new PublicMapError(res.status, detail || "Not found");
        }
        return {
          body: await res.arrayBuffer(),
          type: res.headers.get("content-type") ?? "application/octet-stream",
          run: res.headers.get("x-forecast-run"),
        };
      });
      this.remember(key, entry);
    }
    const hit = await entry;
    const headers = new Headers({ "content-type": hit.type, "cache-control": rule.cache, vary: "accept-encoding" });
    if (hit.run) headers.set("x-forecast-run", hit.run);
    // PNG tiles are compressed already; fields (float arrays) shrink a lot.
    if (!acceptGzip || hit.type.startsWith("image/")) return new Response(hit.body, { headers });
    hit.gz ??= new Uint8Array(gzipSync(new Uint8Array(hit.body), { level: 6 }));
    headers.set("content-encoding", "gzip");
    return new Response(hit.gz, { headers });
  }

  private async get(target: string, timeoutMs: number): Promise<Response> {
    this.upstream++;
    const headers: Record<string, string> = {};
    if (this.apiKey) headers["api-key"] = this.apiKey;
    try {
      return await this.fetchImpl(target, { headers, signal: AbortSignal.timeout(timeoutMs) });
    } catch {
      throw new PublicMapError(502, "4Shadow didn't answer");
    }
  }

  private remember(key: string, value: Promise<Cached>) {
    this.cache.set(key, value);
    value.then(
      (v) => {
        if (this.cache.get(key) !== value) return;
        this.sizes.set(key, v.body.byteLength);
        this.cachedBytes += v.body.byteLength;
        // Oldest first: a Map keeps insertion order, and a hit moves its entry to the end.
        for (const k of this.cache.keys()) {
          if (this.cachedBytes <= this.cacheBytes) break;
          this.cachedBytes -= this.sizes.get(k) ?? 0;
          this.sizes.delete(k);
          this.cache.delete(k);
        }
      },
      () => this.cache.delete(key),
    );
  }

  /** What's cached, for tests and logs. */
  stats() {
    return { entries: this.cache.size, bytes: this.cachedBytes, upstream: this.upstream };
  }
}
