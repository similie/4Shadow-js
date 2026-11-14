import { AlertsApi } from "./alerts.js";
import { ForeshadowError } from "./errors.js";
import { decodeField, type Field } from "./field.js";
import type {
  Forecast,
  Health,
  Model,
  PlacesResponse,
  RunDetail,
  RunsResponse,
  VariablesResponse,
} from "./types.js";

export const DEFAULT_BASE_URL = "https://api.4shadow.io";

export interface ClientOptions {
  /** API origin. Default https://api.4shadow.io; for a local server, e.g. http://localhost:5003. */
  baseUrl?: string;
  /** Your 4Shadow API key. Not needed for a local server. */
  apiKey?: string;
  /**
   * How to send the key. "header" (api-key header) keeps it out of URLs and logs; "query" (?api-key=)
   * is needed for map tile URLs and avoids a CORS preflight in browsers. "auto" (default) uses the
   * header in Node and other servers, and the query string in browsers.
   */
  keyIn?: "auto" | "header" | "query";
  /** A fetch implementation (default: the global fetch). */
  fetch?: typeof fetch;
  /** Extra headers sent with every request. */
  headers?: Record<string, string>;
  /** Abort requests that take longer than this (default 30 s; 0 = no limit). */
  timeoutMs?: number;
}

export interface RequestOptions {
  signal?: AbortSignal;
}

/** Where to forecast: coordinates, or a place name ("Paris, France", "Same, Timor-Leste"). */
export type Where = { lat: number; lon: number } | { q: string } | string;

export interface ForecastOptions extends RequestOptions {
  /** Variable ids to include (default all), e.g. ["t2m", "precip", "wind_speed"]. */
  vars?: string[];
  /** Hours of timeseries to return, 1-384 (default 384). */
  hours?: number;
  /** Start at the current hour ("now", default) or at the run's first step ("run"). */
  start?: "now" | "run";
  /** IANA time zone for daily summaries (default: the location's own). */
  tz?: string;
  /** Include local-day summaries (default true). */
  daily?: boolean;
  /** "latest" (default) or a run id YYYYMMDDHH. */
  run?: string;
  model?: Model;
}

export interface FieldOptions extends RequestOptions {
  /** Stored variable ids, at most 4, e.g. ["u10", "v10"]. */
  vars: string[];
  /** A forecast hour (number, or "f006") or a valid time as YYYYMMDDHH or Date. */
  time: number | string | Date;
  /** "latest" (default) or a run id. Pin a run id for cacheable, consistent animation frames. */
  run?: string;
  model?: Model;
  /** Take every Nth grid cell: 1 = 0.25°, 2 = 0.5°, 4 = 1° (default 1). */
  stride?: number;
  /** [west, south, east, north] in degrees (default the whole globe); east < west crosses the antimeridian. */
  bbox?: [number, number, number, number];
}

export interface TileOptions {
  /** A tileable variable id, e.g. "t2m", "precip", "wind_speed". */
  variable: string;
  /** A forecast hour (number, or "f006") or a valid time as YYYYMMDDHH or Date. */
  time: number | string | Date;
  run?: string;
  model?: Model;
}

function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof document !== "undefined";
}

/** "f006" for 6, "2026111312" for a Date, strings as given. */
export function timeRef(time: number | string | Date): string {
  if (typeof time === "number") return `f${String(Math.round(time)).padStart(3, "0")}`;
  if (time instanceof Date) {
    const p = (n: number) => String(n).padStart(2, "0");
    return `${time.getUTCFullYear()}${p(time.getUTCMonth() + 1)}${p(time.getUTCDate())}${p(time.getUTCHours())}`;
  }
  return time;
}

/**
 * Client for the 4Shadow forecast API.
 *
 * ```ts
 * const fs = new ForeshadowClient({ apiKey: process.env.FORESHADOW_API_KEY });
 * const fc = await fs.forecast("Paris, France", { hours: 24 });
 * console.log(fc.location.place?.display_name, fc.current?.t2m, fc.daily?.t2m_max[0]);
 * ```
 */
export class ForeshadowClient {
  readonly baseUrl: string;
  private readonly apiKey: string | undefined;
  private readonly keyInQuery: boolean;
  private readonly fetchImpl: typeof fetch;
  private readonly headers: Record<string, string>;
  private readonly timeoutMs: number;
  /** Early warnings: alerts, their events and webhook deliveries. */
  readonly alerts: AlertsApi;

  constructor(options: ClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.apiKey = options.apiKey;
    const keyIn = options.keyIn ?? "auto";
    this.keyInQuery = keyIn === "query" || (keyIn === "auto" && isBrowser());
    const f = options.fetch ?? globalThis.fetch;
    if (!f) throw new Error("No fetch available: pass options.fetch (Node 18+ and browsers have one built in)");
    this.fetchImpl = f.bind(globalThis);
    this.headers = options.headers ?? {};
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.alerts = new AlertsApi((method, path, init = {}) => {
      // The alerts API takes the key only in the api-key header, never in the URL or body. Without a
      // key (behind your own proxy that adds it, say), requests go out without one.
      const url = this.url(`/v2/alerts${path}`, init.params ?? {}, false);
      return this.request(url, { signal: init.signal }, { method, body: init.body, keyInHeader: true }).then((r) => r.json());
    });
  }

  /** Absolute URL for an API path and query, with the key in the query when configured that way. */
  url(path: string, params: Record<string, string | number | boolean | undefined> = {}, keyInQuery = this.keyInQuery): string {
    const u = new URL(this.baseUrl + path);
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== "") u.searchParams.set(k, String(v));
    }
    if (this.apiKey && keyInQuery) u.searchParams.set("api-key", this.apiKey);
    return u.toString();
  }

  private async request(
    url: string,
    opts: RequestOptions = {},
    init: { method?: string; body?: unknown; keyInHeader?: boolean } = {},
  ): Promise<Response> {
    const headers: Record<string, string> = { ...this.headers };
    if (this.apiKey && (init.keyInHeader ?? !this.keyInQuery)) headers["api-key"] = this.apiKey;
    let body: string | undefined;
    if (init.body !== undefined) {
      headers["content-type"] = "application/json";
      body = JSON.stringify(init.body);
    }
    const signals = [opts.signal, this.timeoutMs > 0 ? AbortSignal.timeout(this.timeoutMs) : undefined].filter(
      (s): s is AbortSignal => !!s,
    );
    const signal = signals.length > 1 ? AbortSignal.any(signals) : signals[0];
    let res: Response;
    try {
      res = await this.fetchImpl(url, { method: init.method ?? "GET", headers, body, signal });
    } catch (err) {
      if ((err as Error)?.name === "AbortError" && opts.signal?.aborted) throw err;
      throw new ForeshadowError(`Request failed: ${(err as Error)?.message ?? err}`, 0, url);
    }
    if (!res.ok) {
      let detail: string | undefined;
      const extra: { code?: string; resetsAt?: Date } = {};
      try {
        const err = (await res.json()) as { detail?: unknown; message?: unknown; error?: unknown; resets_at?: unknown };
        const d = err.detail ?? err.message;
        const text = typeof d === "string" ? d : Array.isArray(d) ? d.join("; ") : d !== undefined ? JSON.stringify(d) : undefined;
        const summary = typeof err.error === "string" ? err.error : undefined;
        if (summary && /^[a-z][a-z0-9_]*$/.test(summary)) {
          // The gateway answers {error: "quota_exceeded", message, resets_at}.
          extra.code = summary;
          detail = text ?? summary;
          const reset = typeof err.resets_at === "string" ? new Date(err.resets_at) : undefined;
          if (reset && !Number.isNaN(reset.getTime())) extra.resetsAt = reset;
        } else {
          // The alerts API answers {error, detail}: "Invalid alert: name is required; ..."
          detail = summary && text ? `${summary}: ${text}` : (text ?? summary);
        }
      } catch {
        /* not JSON */
      }
      throw new ForeshadowError(`${res.status} ${detail ?? res.statusText}`, res.status, url, detail, extra);
    }
    return res;
  }

  private async json<T>(path: string, params: Record<string, string | number | boolean | undefined> = {}, opts?: RequestOptions): Promise<T> {
    return (await this.request(this.url(path, params), opts)).json() as Promise<T>;
  }

  /** Service status and the newest run per model. Resolves even when the API reports 503 (no data). */
  async health(opts?: RequestOptions): Promise<Health> {
    try {
      return await this.json<Health>("/v2/health", {}, opts);
    } catch (err) {
      if (err instanceof ForeshadowError && err.status === 503) return { status: "unavailable", version: "", models: {} };
      throw err;
    }
  }

  /** A point forecast for coordinates or a place name. */
  forecast(where: Where, options: ForecastOptions = {}): Promise<Forecast> {
    const { signal, vars, hours, start, tz, daily, run, model } = options;
    const loc = typeof where === "string" ? { q: where } : "q" in where ? { q: where.q } : { lat: where.lat, lon: where.lon };
    return this.json<Forecast>(
      "/v2/forecast",
      { ...loc, vars: vars?.join(","), hours, start, tz, daily, run, model },
      { signal },
    );
  }

  /** Places matching a name, best match first. */
  searchPlaces(q: string, options: RequestOptions & { limit?: number } = {}): Promise<PlacesResponse> {
    return this.json<PlacesResponse>("/v2/places", { q, limit: options.limit }, options);
  }

  /** Towns and villages nearest a point, closest first (within 50 km). */
  nearestPlaces(
    lat: number,
    lon: number,
    options: RequestOptions & { limit?: number; minPopulation?: number } = {},
  ): Promise<PlacesResponse> {
    return this.json<PlacesResponse>(
      "/v2/places",
      { lat, lon, limit: options.limit, min_population: options.minPopulation },
      options,
    );
  }

  /** The runs available for a model, newest first. */
  runs(model: Model = "gfs", opts?: RequestOptions): Promise<RunsResponse> {
    return this.json<RunsResponse>(`/v2/${model}/runs`, {}, opts);
  }

  /** One run's steps (forecast hours and valid times) and variables. */
  run(run = "latest", model: Model = "gfs", opts?: RequestOptions): Promise<RunDetail> {
    return this.json<RunDetail>(`/v2/${model}/runs/${run}`, {}, opts);
  }

  /** The variable catalog with units, meaning and legend colour stops. */
  variables(model: Model = "gfs", opts?: RequestOptions): Promise<VariablesResponse> {
    return this.json<VariablesResponse>(`/v2/${model}/variables`, {}, opts);
  }

  /** URL of a field (raw gridded values); fetch it yourself or use `field()`. */
  fieldUrl(options: Omit<FieldOptions, "signal">): string {
    const { vars, time, run = "latest", model = "gfs", stride, bbox } = options;
    return this.url(`/v2/${model}/fields/${run}/${timeRef(time)}`, {
      vars: vars.join(","),
      stride,
      bbox: bbox?.join(","),
    });
  }

  /** Raw gridded values for one step, decoded: for WebGL layers, wind particles, contours and sampling. */
  async field(options: FieldOptions): Promise<Field> {
    const res = await this.request(this.fieldUrl(options), { signal: options.signal });
    return decodeField(await res.arrayBuffer());
  }

  /**
   * An XYZ tile URL template ({z}/{x}/{y}) for map libraries (MapLibre, Leaflet, OpenLayers). The key,
   * if any, always goes in the query string, since map libraries load tiles without custom headers.
   */
  tileUrl(options: TileOptions): string {
    const { variable, time, run = "latest", model = "gfs" } = options;
    const path = `/v2/${model}/tiles/${run}/${variable}/${timeRef(time)}/{z}/{x}/{y}.png`;
    return this.url(path, {}, true).replace(/%7B/g, "{").replace(/%7D/g, "}");
  }
}
