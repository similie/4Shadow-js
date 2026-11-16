import { windDirection, type Field, type ForeshadowClient, type RunDetail, type VariableInfo } from "@similie/4shadow";
import type { FeatureCollection } from "geojson";
import * as maplibregl from "maplibre-gl";
import type { GeoJSONSource, Map as MapLibreMap, RasterTileSource } from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import { basemapPaint, basemapStyle, PALETTES, WEATHER_BEFORE, type MapTheme } from "./basemap";
import { FieldCache, type FieldRequest } from "./cache";
import { Crossfade } from "./crossfade";
import { COLOR_LAYERS, WIND_VARS, type ColorLayerDef } from "./catalog";
import { FieldLayer, type FieldFrames } from "./field-layer";
import { IsobarJobs, type PressureMap } from "./isobar-jobs";
import { ParticleLayer } from "./particle-layer";
import { waveFlow } from "./wave-flow";

// MapLibre starts its worker from a file next to its own module, which bundlers move; say where it is.
maplibregl.setWorkerUrl(workerUrl);

/** Particles and isobars go above borders, below place names. */
const OVERLAY_BEFORE = "water-name";
const ISOBAR_STRIDE = 4;
/** From this zoom, fetch the area in view at full resolution too (when the global grid is coarser). */
const DETAIL_MIN_ZOOM = 3;
/** Largest detail request, in 0.25° cells: a quarter of the globe. */
const DETAIL_MAX_CELLS = (1440 * 721) / 4;
const EMPTY: FeatureCollection = { type: "FeatureCollection", features: [] };
/** Steps to fetch ahead of the one in view while playing. */
const PLAY_AHEAD = 4;
/** Two copies of each per-step overlay (see crossfade.ts). */
const SLOTS = [0, 1] as const;
const ISOBAR_LAYERS = ["isobar-lines", "isobar-labels", "pressure-centres"] as const;

export interface Readout {
  lon: number;
  lat: number;
  /** The colour layer's value here, in its units (null when there's no data). */
  value: number | null;
  wind: { speed: number; direction: number } | null;
  /** On wave layers: where the waves come from (degrees) and their period (s); null over land. */
  wave: { direction: number; period: number } | null;
  mslp: number | null;
}

export interface Status {
  loading: number;
  error: string | null;
}

export interface WeatherMapOptions {
  container: HTMLElement;
  client: ForeshadowClient;
  /** Grid step to fetch: 1 = 0.25°, 2 = 0.5°, 4 = 1°. */
  stride?: number;
  center?: [number, number];
  zoom?: number;
  /** Night ("dark", the default) or Day ("light") basemap; change it later with setTheme. */
  theme?: MapTheme;
}

/**
 * A MapLibre map with 4Shadow weather on it: a colour layer, wind particles, isobars and
 * pressure centres, all drawn from the API's raw fields, moving smoothly through forecast time.
 */
export class WeatherMap {
  readonly map: MapLibreMap;
  readonly cache: FieldCache;
  private readonly client: ForeshadowClient;
  private theme: MapTheme;
  private readonly fieldLayer: FieldLayer;
  private readonly particleLayer = new ParticleLayer();
  private catalog = new Map<string, VariableInfo>();
  private run: RunDetail | null = null;
  private times: number[] = [];
  private time = 0;
  private layer: ColorLayerDef | null = COLOR_LAYERS[0]!;
  private shown: { layer: ColorLayerDef; frames: FieldFrames; detail: FieldFrames | null } | null = null;
  private windFrames: FieldFrames | null = null;
  /** Wave direction and period fields behind the wave particles (and the readout). */
  private flowFrames: { flow: NonNullable<ColorLayerDef["flow"]>; frames: FieldFrames } | null = null;
  /** The area fetched at full resolution, or null (zoomed out, or the global grid is already full). */
  private detailBox: [number, number, number, number] | null = null;
  private pressure: Field | null = null;
  /** Isobars and H/L markers of the two steps around the time, crossfaded. */
  private readonly isobarFade = new Crossfade<PressureMap>((slot, m) => {
    (this.map.getSource(`isobars-${slot}`) as GeoJSONSource).setData(m.lines);
    (this.map.getSource(`pressure-centres-${slot}`) as GeoJSONSource).setData(m.centres);
  });
  /** Isobars are computed in a worker, ahead of time while playing. */
  private readonly isobarJobs = new IsobarJobs(() => this.refresh());
  /** The server's PNG tiles (compare mode) for the two steps around the time, crossfaded. */
  private readonly tileFade = new Crossfade<string>((slot, url) => this.loadTiles(slot, url));
  private tileWeights: [number, number] = [0, 0];
  private readonly paintCache = new Map<string, number>();
  private loaded = false;
  private complete = false;
  private playing = false;
  private lastTick = 0;
  private hoursPerSecond = 3;
  stride: number;
  particles = true;
  showIsobars = true;
  compare = false;
  opacity = 0.85;
  /** Told about loading and errors. */
  onStatus: ((s: Status) => void) | null = null;
  /** Told when playback moves the time. */
  onTime: ((ms: number) => void) | null = null;

  constructor(options: WeatherMapOptions) {
    this.client = options.client;
    this.stride = options.stride ?? 1;
    this.theme = options.theme ?? "dark";
    this.fieldLayer = new FieldLayer("weather-field", PALETTES[this.theme].land);
    this.particleLayer.setOptions({ color: PALETTES[this.theme].particles, opacity: PALETTES[this.theme].particleOpacity });
    this.cache = new FieldCache(options.client);
    this.cache.onLoad = (err) => {
      this.status(err);
      this.refresh();
    };
    this.map = new maplibregl.Map({
      container: options.container,
      style: basemapStyle(this.theme),
      center: options.center ?? [20, 25],
      zoom: options.zoom ?? 1.8,
      maxZoom: 11,
      hash: true,
      dragRotate: false,
      pitchWithRotate: false,
      renderWorldCopies: true,
      attributionControl: {
        compact: true,
        customAttribution: "Forecast: NOAA GFS via 4Shadow · Places: GeoNames (CC BY 4.0)",
      },
    });
    this.map.touchZoomRotate.disableRotation();
    this.map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
    this.map.on("load", () => this.addLayers());
    this.map.on("moveend", () => this.updateDetailBox());
  }

  /** After the view settles: which area, if any, to fetch at full resolution. */
  private updateDetailBox(): void {
    const box = this.stride > 1 ? detailBox(this.map) : null;
    if ((box?.join() ?? "") === (this.detailBox?.join() ?? "")) return;
    this.detailBox = box;
    this.refresh();
  }

  /** The area currently fetched at full resolution (west, south, east, north), if any. */
  get detailArea(): [number, number, number, number] | null {
    return this.detailBox;
  }

  private addLayers(): void {
    const map = this.map;
    map.addLayer(this.fieldLayer, WEATHER_BEFORE);
    map.addLayer(this.particleLayer, OVERLAY_BEFORE);
    // Two copies of the isobars and H/L markers (see crossfade.ts). Their opacity changes every
    // frame, so no transitions; labels ignore each other's placement so the copies don't fight.
    const instant = { duration: 0, delay: 0 };
    for (const slot of SLOTS) {
      map.addSource(`isobars-${slot}`, { type: "geojson", data: EMPTY });
      map.addSource(`pressure-centres-${slot}`, { type: "geojson", data: EMPTY });
      map.addLayer(
        {
          id: `isobar-lines-${slot}`,
          type: "line",
          source: `isobars-${slot}`,
          paint: {
            "line-width": ["case", ["==", ["%", ["get", "hpa"], 20], 0], 1.3, 0.8],
            "line-opacity": 0,
            "line-opacity-transition": instant,
          },
        },
        OVERLAY_BEFORE,
      );
      map.addLayer(
        {
          id: `isobar-labels-${slot}`,
          type: "symbol",
          source: `isobars-${slot}`,
          minzoom: 2,
          layout: {
            "symbol-placement": "line",
            "symbol-spacing": 320,
            "text-field": ["to-string", ["get", "hpa"]],
            "text-font": ["Noto Sans Regular"],
            "text-size": 10,
            "text-keep-upright": true,
            "text-ignore-placement": true,
          },
          paint: {
            "text-halo-width": 1,
            "text-opacity": 0,
            "text-opacity-transition": instant,
          },
        },
        OVERLAY_BEFORE,
      );
      map.addLayer(
        {
          id: `pressure-centres-${slot}`,
          type: "symbol",
          source: `pressure-centres-${slot}`,
          layout: {
            "text-field": ["format", ["get", "kind"], { "font-scale": 1.5 }, "\n", {}, ["to-string", ["get", "hpa"]], { "font-scale": 0.75 }],
            "text-font": ["Noto Sans Bold"],
            "text-size": 13,
            "text-line-height": 1,
            "text-ignore-placement": true,
          },
          paint: {
            "text-halo-width": 1.2,
            "text-opacity": 0,
            "text-opacity-transition": instant,
          },
        },
        OVERLAY_BEFORE,
      );
    }
    this.loaded = true;
    this.applyTheme();
    if (this.projection !== "mercator") this.applyProjection();
    this.applyVisibility();
    this.detailBox = this.stride > 1 ? detailBox(map) : null;
    this.refresh();
  }

  setCatalog(variables: VariableInfo[]): void {
    this.catalog = new Map(variables.map((v) => [v.id, v]));
    this.refresh();
  }

  variable(id: string): VariableInfo | undefined {
    return this.catalog.get(id);
  }

  setRun(run: RunDetail): void {
    this.run = run;
    this.times = run.valid_times.map((t) => Date.parse(t));
    this.time = this.clampTime(this.time || Date.now());
    this.refresh();
  }

  get timeRange(): [number, number] {
    return [this.times[0] ?? 0, this.times[this.times.length - 1] ?? 0];
  }

  get steps(): number[] {
    return this.times;
  }

  get currentTime(): number {
    return this.time;
  }

  private clampTime(ms: number): number {
    const [first, last] = this.timeRange;
    return Math.max(first, Math.min(last, ms));
  }

  setTime(ms: number): void {
    this.time = this.clampTime(ms);
    this.refresh();
  }

  setLayer(id: string | null): void {
    this.layer = id ? (COLOR_LAYERS.find((l) => l.id === id) ?? null) : null;
    this.refresh();
  }

  setStride(stride: number): void {
    this.stride = stride;
    if (this.loaded) this.updateDetailBox();
    this.refresh();
  }

  setParticles(on: boolean): void {
    this.particles = on;
    this.refresh();
  }

  setIsobars(on: boolean): void {
    this.showIsobars = on;
    this.applyVisibility();
    this.refresh();
  }

  setCompare(on: boolean): void {
    this.compare = on;
    this.applyVisibility();
    this.refresh();
  }

  /** Night ("dark") or Day ("light"): basemap, land, isobars and particles change in place. */
  setTheme(theme: MapTheme): void {
    if (theme === this.theme) return;
    this.theme = theme;
    this.fieldLayer.setLand(PALETTES[theme].land);
    this.particleLayer.setOptions({ color: PALETTES[theme].particles, opacity: PALETTES[theme].particleOpacity });
    if (this.loaded) this.applyTheme();
  }

  private applyTheme(): void {
    const p = PALETTES[this.theme];
    const paint: Record<string, Record<string, unknown>> = basemapPaint(p);
    for (const slot of SLOTS) {
      paint[`isobar-lines-${slot}`] = { "line-color": p.isobar };
      paint[`isobar-labels-${slot}`] = { "text-color": p.isobarText, "text-halo-color": p.isobarHalo };
      paint[`pressure-centres-${slot}`] = {
        "text-color": ["match", ["get", "kind"], "H", p.high, p.low],
        "text-halo-color": p.centreHalo,
      };
    }
    for (const [id, props] of Object.entries(paint)) {
      if (!this.map.getLayer(id)) continue;
      for (const [name, value] of Object.entries(props)) {
        type Paint = Parameters<MapLibreMap["setPaintProperty"]>;
        this.map.setPaintProperty(id, name as Paint[1], value as Paint[2]);
      }
    }
  }

  setOpacity(opacity: number): void {
    this.opacity = opacity;
    this.fieldLayer.setOpacity(this.compare ? 0 : opacity);
    this.setTileOpacity(this.tileWeights);
  }

  private projection: "mercator" | "globe" = "mercator";

  setProjection(type: "mercator" | "globe"): void {
    this.projection = type;
    if (this.loaded) this.applyProjection();
  }

  private applyProjection(): void {
    this.map.setProjection({ type: this.projection });
    // On a globe MapLibre caps the poles of every fill layer, and the translucent sea shade's caps
    // stack into a dark disc; leave it to the flat map.
    this.map.setLayoutProperty(WEATHER_BEFORE, "visibility", this.projection === "globe" ? "none" : "visible");
  }

  /** Playback through forecast time, waiting for data so it never skips. */
  play(hoursPerSecond = this.hoursPerSecond): void {
    this.hoursPerSecond = hoursPerSecond;
    if (this.playing) return;
    this.playing = true;
    this.lastTick = performance.now();
    requestAnimationFrame(this.tick);
  }

  pause(): void {
    this.playing = false;
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  private readonly tick = (now: number) => {
    if (!this.playing) return;
    const dt = Math.min(0.25, (now - this.lastTick) / 1000);
    this.lastTick = now;
    if (this.complete) {
      const [first, last] = this.timeRange;
      let t = this.time + dt * this.hoursPerSecond * 3_600_000;
      if (t > last) t = first;
      this.time = t;
      this.onTime?.(t);
    }
    this.refresh();
    requestAnimationFrame(this.tick);
  };

  /** Indices of the steps around the current time and how far between them it is. */
  private bracket(): { ia: number; ib: number; t: number } | null {
    const ts = this.times;
    if (!ts.length) return null;
    const T = this.time;
    if (T <= ts[0]!) return { ia: 0, ib: 0, t: 0 };
    if (T >= ts[ts.length - 1]!) return { ia: ts.length - 1, ib: ts.length - 1, t: 0 };
    let lo = 0;
    let hi = ts.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (ts[mid]! <= T) lo = mid;
      else hi = mid;
    }
    return { ia: lo, ib: hi, t: (T - ts[lo]!) / (ts[hi]! - ts[lo]!) };
  }

  /** The step nearest the current time. */
  get nearestStep(): number | null {
    const b = this.bracket();
    return b ? (b.t < 0.5 ? b.ia : b.ib) : null;
  }

  private request(vars: string[], index: number, stride: number, bbox?: FieldRequest["bbox"]): FieldRequest {
    return { run: this.run!.run, hour: this.run!.forecast_hours[index]!, vars, stride, bbox };
  }

  /** The two steps' fields for these variables if loaded (loading them, and a few ahead, if not). */
  private framesFor(vars: string[], stride: number, bbox?: FieldRequest["bbox"]): FieldFrames | null {
    const b = this.bracket();
    if (!b || !this.run) return null;
    const ra = this.request(vars, b.ia, stride, bbox);
    const rb = this.request(vars, b.ib, stride, bbox);
    const fa = this.cache.get(ra);
    const fb = b.ib === b.ia ? fa : this.cache.get(rb);
    if (!fa) this.cache.prefetch(ra);
    if (!fb) this.cache.prefetch(rb);
    // Playback loops, so near the end it looks ahead into the first steps.
    const n = this.times.length;
    const ahead = Math.min(this.playing ? PLAY_AHEAD : 1, n - 1);
    for (let k = 1; k <= ahead && this.cache.loading < 6; k++) {
      const next = b.ib + k;
      if (next >= n && !this.playing) break;
      this.cache.prefetch(this.request(vars, next % n, stride, bbox));
    }
    if (!fa || !fb) return null;
    return { a: fa, b: b.ib === b.ia ? null : fb, t: b.t };
  }

  /** The fields already loaded for the steps playback reaches next. */
  private loadedAhead(vars: string[], stride: number): Field[] {
    const b = this.bracket();
    if (!b || !this.run || !this.playing) return [];
    const n = this.times.length;
    const out: Field[] = [];
    for (let k = 1; k <= Math.min(PLAY_AHEAD, n - 1); k++) {
      const f = this.cache.get(this.request(vars, (b.ib + k) % n, stride));
      if (f) out.push(f);
    }
    return out;
  }

  /** Bring every layer up to date with the current time and settings. */
  refresh(): void {
    if (!this.loaded || !this.run) return;
    let complete = true;

    // Colour layer: switch only once the new variable's data is here, so nothing flashes.
    const def = this.layer;
    const info = def ? this.catalog.get(def.legendVar) : undefined;
    if (def && info?.legend) {
      const frames = this.framesFor(def.vars, this.stride);
      if (frames) {
        // Zoomed in: the area in view at full resolution, drawn over the global field where it covers.
        let detail: FieldFrames | null = null;
        let hold = false;
        if (this.detailBox) {
          detail = this.framesFor(def.vars, 1, this.detailBox);
          if (!detail) {
            complete = false;
            const prev = this.shown;
            if (prev?.layer === def && prev.detail) {
              // A new area (panned): keep the previous one where it covers, if it's for the same steps.
              if (sameSteps(prev.detail, frames)) detail = { ...prev.detail, t: frames.t };
              // A new step while playing: keep the last full picture until its detail is here
              // (playback waits meanwhile) rather than drawing one coarser frame, which flashes.
              else if (this.playing) hold = true;
            }
          }
        }
        if (!hold) {
          if (this.shown?.layer !== def) this.fieldLayer.setSpec({ vars: def.vars, legend: info.legend, marine: info.marine });
          this.fieldLayer.setFrames(frames, detail);
          this.shown = { layer: def, frames, detail };
        }
      } else complete = false;
    } else if (!def) {
      this.fieldLayer.setFrames(null);
      this.shown = null;
    }
    this.fieldLayer.setOpacity(this.compare ? 0 : this.opacity);

    // Particles: on wave layers they travel with the waves, otherwise with the wind.
    const flow = def?.flow;
    if (flow) {
      const raw = this.framesFor([flow.dir, flow.period], this.stride);
      if (raw) {
        this.flowFrames = { flow, frames: raw };
        if (this.particles) {
          const moving = (f: Field) => waveFlow(f, flow.dir, flow.period);
          this.particleLayer.setFrames({ a: moving(raw.a), b: raw.b ? moving(raw.b) : null, t: raw.t }, ["u", "v"]);
        }
      } else complete = false;
      this.windFrames = null;
    } else {
      this.flowFrames = null;
      if (this.particles) {
        const frames = this.framesFor(WIND_VARS, this.stride);
        if (frames) {
          this.windFrames = frames;
          this.particleLayer.setFrames(frames);
        } else complete = false;
      } else this.windFrames = null;
    }
    if (!this.particles) this.particleLayer.setFrames(null);

    // Isobars and H/L on a 1° grid: the two steps around the time, crossfaded. Their contours
    // are computed in a worker as soon as each step's field arrives.
    if (this.showIsobars) {
      const frames = this.framesFor(["mslp"], ISOBAR_STRIDE);
      for (const f of this.loadedAhead(["mslp"], ISOBAR_STRIDE)) this.isobarJobs.request(f);
      const b = frames ? (frames.b ?? frames.a) : null;
      const ma = frames ? this.isobarJobs.get(frames.a) : undefined;
      const mb = b ? this.isobarJobs.get(b) : undefined;
      if (frames && b && ma && mb) {
        const step = (f: Field) => `${f.header.run}/${f.header.forecast_hour}`;
        const weights = this.isobarFade.show(step(frames.a), ma, step(b), mb, frames.t);
        // Lines blend; labels and H/L markers switch at the halfway point, since two copies of a
        // label a few pixels apart read as a double.
        const nearer = weights[0] >= weights[1] ? 0 : 1;
        for (const slot of SLOTS) {
          for (const id of ISOBAR_LAYERS) {
            if (id === "isobar-lines") this.paint(`${id}-${slot}`, "line-opacity", weights[slot]);
            else this.paint(`${id}-${slot}`, "text-opacity", slot === nearer ? 1 : 0);
          }
        }
        this.pressure = frames.t < 0.5 ? frames.a : b;
      } else complete = false;
    }

    // The server's tiles, to compare: also the two steps around the time, crossfaded. Playback
    // waits until both are loaded.
    const b = this.bracket();
    if (this.compare && def && b) {
      const run = this.run;
      const url = (k: number) => this.client.tileUrl({ variable: def.tileVar, time: run.forecast_hours[k]!, run: run.run });
      const [ua, ub] = [url(b.ia), url(b.ib)];
      this.setTileOpacity(this.tileFade.show(ua, ua, ub, ub, b.t));
      for (const u of new Set([ua, ub])) {
        if (!this.map.isSourceLoaded(`server-tiles-${this.tileFade.slotOf(u)}`)) complete = false;
      }
    }
    this.complete = complete;
    this.status();
  }

  /** Set a paint property, skipping MapLibre's work when it hasn't visibly changed. */
  private paint(layer: string, property: "line-opacity" | "text-opacity" | "raster-opacity", value: number): void {
    const key = `${layer}/${property}`;
    const rounded = Math.round(value * 100) / 100;
    if (this.paintCache.get(key) === rounded) return;
    this.paintCache.set(key, rounded);
    this.map.setPaintProperty(layer, property, rounded);
  }

  /** Point a tile copy at a step's URL, creating both copies the first time. */
  private loadTiles(slot: 0 | 1, url: string): void {
    for (const s of SLOTS) {
      const id = `server-tiles-${s}`;
      if (this.map.getSource(id)) continue;
      this.map.addSource(id, { type: "raster", tiles: [url], tileSize: 256, maxzoom: 8 });
      this.map.addLayer(
        {
          id,
          type: "raster",
          source: id,
          paint: { "raster-opacity": 0, "raster-opacity-transition": { duration: 0, delay: 0 }, "raster-fade-duration": 0 },
        },
        WEATHER_BEFORE,
      );
    }
    (this.map.getSource(`server-tiles-${slot}`) as RasterTileSource).setTiles([url]);
  }

  private setTileOpacity(weights: [number, number]): void {
    this.tileWeights = weights;
    for (const slot of SLOTS) {
      if (this.map.getLayer(`server-tiles-${slot}`)) this.paint(`server-tiles-${slot}`, "raster-opacity", this.opacity * weights[slot]);
    }
  }

  private applyVisibility(): void {
    if (!this.loaded) return;
    const vis = (on: boolean) => (on ? "visible" : "none");
    for (const slot of SLOTS) {
      for (const id of ISOBAR_LAYERS) this.map.setLayoutProperty(`${id}-${slot}`, "visibility", vis(this.showIsobars));
      const tiles = `server-tiles-${slot}`;
      if (this.map.getLayer(tiles)) this.map.setLayoutProperty(tiles, "visibility", vis(this.compare));
    }
  }

  private lastStatus = "";

  private status(err?: unknown): void {
    const error = err ? (err instanceof Error ? err.message : String(err)) : null;
    const key = `${this.cache.loading}|${error}`;
    if (key === this.lastStatus && !error) return;
    this.lastStatus = key;
    this.onStatus?.({ loading: this.cache.loading, error });
  }

  /** Values under a point, for a hover readout (time-interpolated like the map). */
  readout(lon: number, lat: number): Readout {
    const wrapped = ((((lon + 180) % 360) + 360) % 360) - 180;
    let value: number | null = null;
    if (this.shown) {
      const { layer, detail } = this.shown;
      const frames = detail && covers(detail.a, lat, wrapped) ? detail : this.shown.frames;
      const one = (f: Field) =>
        layer.vars.length === 2 ? f.wind(lat, wrapped, layer.vars[0], layer.vars[1]).speed : f.sample(layer.vars[0], lat, wrapped);
      const a = one(frames.a);
      const v = frames.b ? a + (one(frames.b) - a) * frames.t : a;
      value = Number.isFinite(v) ? v : null;
    }
    let wave: Readout["wave"] = null;
    if (this.flowFrames) {
      const { flow, frames } = this.flowFrames;
      const f = frames.b && frames.t >= 0.5 ? frames.b : frames.a; // directions don't blend linearly; take the nearer step
      const direction = f.direction(flow.dir, lat, wrapped);
      const period = f.sample(flow.period, lat, wrapped);
      if (Number.isFinite(direction) && Number.isFinite(period)) wave = { direction, period };
    }
    let wind: Readout["wind"] = null;
    const wf = this.windFrames ?? (this.shown?.layer.id === "wind" ? this.shown.frames : null);
    if (wf) {
      const a = wf.a.wind(lat, wrapped);
      const b = wf.b ? wf.b.wind(lat, wrapped) : a;
      const u = a.u + (b.u - a.u) * wf.t;
      const v = a.v + (b.v - a.v) * wf.t;
      if (Number.isFinite(u) && Number.isFinite(v)) {
        wind = { speed: Math.hypot(u, v), direction: windDirection(u, v) };
      }
    }
    const p = this.pressure?.sample("mslp", lat, wrapped);
    return { lon: wrapped, lat, value, wind, wave, mslp: p !== undefined && Number.isFinite(p) ? p : null };
  }

  destroy(): void {
    this.playing = false;
    this.isobarJobs.dispose();
    // MapLibre's remove() deletes the view from the URL hash. Put it back when the page is still the
    // map's own, so a remount (or a dev hot reload) and the history entry keep their place.
    const { pathname, search, hash } = location;
    this.map.remove();
    if (hash && !location.hash && location.pathname === pathname && location.search === search) {
      history.replaceState(history.state, "", hash);
    }
  }
}

/** Two sets of frames are for the same run and steps. */
function sameSteps(x: FieldFrames, y: FieldFrames): boolean {
  const hour = (f: Field | null) => (f ? `${f.header.run}/${f.header.forecast_hour}` : "");
  return hour(x.a) === hour(y.a) && hour(x.b) === hour(y.b);
}

/** Whether a (regional) field's grid covers a point. */
function covers(f: Field, lat: number, lon: number): boolean {
  const g = f.grid;
  const fi = (g.lat0 - lat) / g.dlat;
  const fj = ((((lon - g.lon0) % 360) + 360) % 360) / g.dlon;
  return fi >= 0 && fi <= g.nlat - 1 && (g.wraps || fj <= g.nlon - 1);
}

/**
 * The area to fetch at full resolution for the current view: the view plus a quarter on each side
 * (so small pans need nothing new), snapped out to 5° so requests repeat and cache. Null when
 * zoomed out or when it would be most of the globe anyway.
 */
function detailBox(map: MapLibreMap): [number, number, number, number] | null {
  if (map.getZoom() < DETAIL_MIN_ZOOM) return null;
  const b = map.getBounds();
  const mx = (b.getEast() - b.getWest()) * 0.25;
  const my = (b.getNorth() - b.getSouth()) * 0.25;
  const west = Math.floor((b.getWest() - mx) / 5) * 5;
  const east = Math.ceil((b.getEast() + mx) / 5) * 5;
  const south = Math.max(-90, Math.floor((b.getSouth() - my) / 5) * 5);
  const north = Math.min(90, Math.ceil((b.getNorth() + my) / 5) * 5);
  if (east - west >= 300 || ((east - west) / 0.25) * ((north - south) / 0.25) > DETAIL_MAX_CELLS) return null;
  const wrap = (lon: number) => ((((lon + 180) % 360) + 360) % 360) - 180;
  return [wrap(west), south, wrap(east), north];
}
