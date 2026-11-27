import { windDirection, type Field, type ForeshadowClient, type RunDetail, type RunSummary, type VariableInfo } from "@similie/4shadow";
import type { FeatureCollection } from "geojson";
import * as maplibregl from "maplibre-gl";
import type { GeoJSONSource, Map as MapLibreMap, RasterTileSource } from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import { basemapPaint, basemapStyle, PALETTES, WEATHER_BEFORE, type MapTheme } from "./basemap";
import { FieldCache, type FieldRequest } from "./cache";
import { Crossfade } from "./crossfade";
import { COLOR_LAYERS, CURRENT_PACE, servable, WIND_VARS, type ColorLayerDef } from "./catalog";
import { CoastLayer } from "./coast-layer";
import { creditFor } from "./credit";
import { FieldLayer, type FieldFrames } from "./field-layer";
import { IsobarJobs, type PressureMap } from "./isobar-jobs";
import { ParticleLayer } from "./particle-layer";
import { SeaMask } from "./sea-mask";
import { SeaShadeLayer } from "./sea-shade";
import { DETAIL_MAX_CELLS, strideFor } from "./stride";
import { waveFlow } from "./wave-flow";

// MapLibre starts its worker from a file next to its own module, which bundlers move; say where it is.
maplibregl.setWorkerUrl(workerUrl);

/** Particles and isobars go above borders, below place names. */
const OVERLAY_BEFORE = "water-name";
const ISOBAR_STRIDE = 4;
/** From this zoom, fetch the area in view at full resolution too (when the global grid is coarser). */
const DETAIL_MIN_ZOOM = 3;
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
  /** On the currents layer: the current's speed (m/s) and where it flows to (degrees); null over land. */
  current: { speed: number; heading: number } | null;
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
/**
 * A model run the map draws from, with its steps and variables. The main one is the weather model's;
 * an overlay is another model's (air quality, ocean currents) whose colour layers draw over the main
 * run's particles and isobars, or bring their own particles (currents).
 */
interface Source {
  /** The run, or for observations the newest hour's. */
  run: RunDetail;
  times: number[];
  catalog: Map<string, VariableInfo>;
  /**
   * Observations (satellite imagery): each time is its own run of one step, named here. The ruler shows
   * these hours while one of the source's layers is on.
   */
  runs?: string[];
}

export class WeatherMap {
  readonly map: MapLibreMap;
  readonly cache: FieldCache;
  private readonly client: ForeshadowClient;
  private theme: MapTheme;
  private readonly fieldLayer: FieldLayer;
  /** The basemap's water, copied each frame for the wave particles and the coastlines. */
  private readonly seaMask = new SeaMask();
  private readonly particleLayer = new ParticleLayer("weather-particles", {}, this.seaMask);
  private readonly seaShade = new SeaShadeLayer(this.seaMask);
  private readonly coastLayer = new CoastLayer(this.seaMask);
  private catalog = new Map<string, VariableInfo>();
  private run: RunDetail | null = null;
  private times: number[] = [];
  private time = 0;
  private layer: ColorLayerDef | null = COLOR_LAYERS[0]!;
  private shown: { layer: ColorLayerDef; frames: FieldFrames; detail: FieldFrames | null } | null = null;
  private windFrames: FieldFrames | null = null;
  private windVars: [string, string] = WIND_VARS;
  /** Wave direction and period fields behind the wave particles (and the readout). */
  private flowFrames: { flow: NonNullable<ColorLayerDef["flow"]>; frames: FieldFrames } | null = null;
  /** The area fetched at full resolution, or null (zoomed out, or the global grid is already full). */
  private detailBox: [number, number, number, number] | null = null;
  private pressure: Field | null = null;
  private overlays: Source[] = [];
  private credit = "";
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
  /** How many times faster than the water current particles move. */
  currentPace = CURRENT_PACE;
  showIsobars = true;
  showCoastlines = true;
  compare = false;
  opacity = 0.85;
  /** Told about loading and errors. */
  onStatus: ((s: Status) => void) | null = null;
  /** Told when playback moves the time. */
  onTime: ((ms: number) => void) | null = null;
  /** Told when the ruler's steps change: a new run, a new satellite hour, or a switch to or from observations. */
  onTimeline: ((steps: number[]) => void) | null = null;
  private timelineKey = "";

  constructor(options: WeatherMapOptions) {
    this.client = options.client;
    this.stride = options.stride ?? 1;
    this.theme = options.theme ?? "dark";
    this.fieldLayer = new FieldLayer("weather-field", PALETTES[this.theme].land);
    this.particleLayer.setOptions({ color: PALETTES[this.theme].particles, opacity: PALETTES[this.theme].particleOpacity });
    this.seaShade.setColor(PALETTES[this.theme].waterShade, PALETTES[this.theme].waterShadeOpacity);
    this.coastLayer.setColor(PALETTES[this.theme].coast);
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
        // The forecast's own credit comes from the runs in view (see setCredit).
        customAttribution: "Places: GeoNames (CC BY 4.0)",
      },
    });
    this.map.touchZoomRotate.disableRotation();
    this.map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
    // As soon as the style is read, not on "load": that waits for every basemap tile in view, and
    // never comes if the basemap's tile index fails. The weather shouldn't wait for the basemap.
    this.map.once("style.load", () => this.addLayers());
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
    // The sea mask first: it copies the water before any weather is drawn over it.
    map.addLayer(this.seaMask, WEATHER_BEFORE);
    map.addLayer(this.fieldLayer, WEATHER_BEFORE);
    map.addLayer(this.seaShade, WEATHER_BEFORE);
    map.addLayer(this.particleLayer, OVERLAY_BEFORE);
    map.addLayer(this.coastLayer, OVERLAY_BEFORE);
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
    return this.catalog.get(id) ?? this.overlays.find((o) => o.catalog.has(id))?.catalog.get(id);
  }

  setRun(run: RunDetail): void {
    this.run = run;
    this.times = run.valid_times.map((t) => Date.parse(t));
    this.time = this.clampTime(this.time || Date.now());
    if (!this.mainServes(["mslp"])) this.pressure = null;
    this.timelineChanged();
    this.applyVisibility();
    this.refresh();
  }

  /**
   * Other models whose colour layers the map can draw (air quality and ocean currents, which have no
   * wind or pressure of their own): a layer the main run can't serve comes from the first of these that
   * can, and so do its particles when the layer names its own u/v (currents). Its frames follow the
   * main timeline; outside the overlay's own steps the layer is left blank. Observations (satellite
   * imagery) come with their hours' `runs`: their layers bring a ruler of their own, the last hours
   * observed.
   */
  setOverlays(list: Array<{ run: RunDetail; variables: VariableInfo[]; runs?: RunSummary[] }>): void {
    this.overlays = list.map(({ run, variables, runs }) => {
      const catalog = new Map(variables.map((v) => [v.id, v]));
      if (!runs?.length) return { run, times: run.valid_times.map((t) => Date.parse(t)), catalog };
      const hours = [...runs].sort((a, b) => Date.parse(a.init_time) - Date.parse(b.init_time));
      return { run, times: hours.map((r) => Date.parse(r.init_time)), catalog, runs: hours.map((r) => r.run) };
    });
    this.timelineChanged();
    this.refresh();
  }

  private main(): Source | null {
    return this.run ? { run: this.run, times: this.times, catalog: this.catalog } : null;
  }

  private serves(src: Source, ids: readonly string[]): boolean {
    const catalog = [...src.catalog.values()];
    return ids.every((id) => servable(id, catalog, src.run.variables));
  }

  /** Whether the weather run has these variables (an air-quality run has no wind or pressure). */
  private mainServes(ids: readonly string[]): boolean {
    const main = this.main();
    return !!main && this.serves(main, ids);
  }

  /** Where a colour layer's data comes from: the main run if it has the layer, else an overlay. */
  private sourceFor(def: ColorLayerDef): Source | null {
    const ids = [...def.vars, def.legendVar];
    const main = this.main();
    if (main && this.serves(main, ids)) return main;
    return this.overlays.find((o) => this.serves(o, ids)) ?? null;
  }

  /** The source of the layer on, when it's observations (satellite imagery). */
  private observed(): Source | null {
    const src = this.layer ? this.sourceFor(this.layer) : null;
    return src?.runs ? src : null;
  }

  /** Whether the ruler shows hours observed (a satellite layer) rather than the forecast's. */
  get observing(): boolean {
    return !!this.observed();
  }

  get timeRange(): [number, number] {
    const steps = this.steps;
    return [steps[0] ?? 0, steps[steps.length - 1] ?? 0];
  }

  /** The ruler's steps: the forecast's, or on a satellite layer the hours observed. */
  get steps(): number[] {
    return this.observed()?.times ?? this.times;
  }

  /** Keep the time on the ruler, and tell the page, when its steps change. */
  private timelineChanged(): void {
    const steps = this.steps;
    const key = `${this.observing}:${steps[0]}:${steps.length}:${steps[steps.length - 1]}`;
    if (key === this.timelineKey) return;
    this.timelineKey = key;
    this.time = this.clampTime(this.time);
    this.onTimeline?.(steps);
    this.onTime?.(this.time);
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
    const was = this.observing;
    this.layer = id ? (COLOR_LAYERS.find((l) => l.id === id) ?? null) : null;
    // Between forecast and observations: to now, or the newest image.
    if (this.observing !== was) this.time = this.clampTime(this.observing ? Infinity : Date.now());
    this.timelineChanged();
    this.refresh();
  }

  setStride(stride: number): void {
    this.stride = stride;
    if (this.loaded) this.updateDetailBox();
    this.refresh();
  }

  /** Current particles' speed, as a multiple of the water's (CURRENT_PACE by default). */
  setCurrentPace(pace: number): void {
    this.currentPace = pace;
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

  /** Coastlines over the weather. */
  setCoastlines(on: boolean): void {
    this.showCoastlines = on;
    this.coastLayer.setVisible(on);
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
    this.seaShade.setColor(PALETTES[theme].waterShade, PALETTES[theme].waterShadeOpacity);
    this.coastLayer.setColor(PALETTES[theme].coast);
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

  /**
   * Indices of the steps around the current time and how far between them it is. Before the first
   * step or after the last, the nearest end, except for an overlay, which then has nothing to show.
   */
  private bracket(ts: number[] = this.times, clamp = true): { ia: number; ib: number; t: number } | null {
    if (!ts.length) return null;
    const T = this.time;
    if (!clamp && (T < ts[0]! || T > ts[ts.length - 1]!)) return null;
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

  private request(src: Source, vars: string[], index: number, stride: number, bbox?: FieldRequest["bbox"]): FieldRequest {
    const run = src.runs ? src.runs[index]! : src.run.run;
    const hour = src.runs ? 0 : src.run.forecast_hours[index]!;
    return { model: src.run.model, run, hour, vars, stride: strideFor(src.run, stride, bbox), bbox };
  }

  /** The two steps' fields for these variables if loaded (loading them, and a few ahead, if not). */
  private framesFor(vars: string[], stride: number, bbox?: FieldRequest["bbox"], src = this.main()): FieldFrames | null {
    if (!src) return null;
    const b = this.bracket(src.times, src.run === this.run);
    if (!b) return null;
    const ra = this.request(src, vars, b.ia, stride, bbox);
    const rb = this.request(src, vars, b.ib, stride, bbox);
    const fa = this.cache.get(ra);
    const fb = b.ib === b.ia ? fa : this.cache.get(rb);
    if (!fa) this.cache.prefetch(ra);
    if (!fb) this.cache.prefetch(rb);
    // Playback loops, so near the end it looks ahead into the first steps.
    const n = src.times.length;
    const ahead = Math.min(this.playing ? PLAY_AHEAD : 1, n - 1);
    for (let k = 1; k <= ahead && this.cache.loading < 6; k++) {
      const next = b.ib + k;
      if (next >= n && !this.playing) break;
      this.cache.prefetch(this.request(src, vars, next % n, stride, bbox));
    }
    if (!fa || !fb) return null;
    return { a: fa, b: b.ib === b.ia ? null : fb, t: b.t };
  }

  /** The fields already loaded for the steps playback reaches next. */
  private loadedAhead(vars: string[], stride: number): Field[] {
    const b = this.bracket();
    const main = this.main();
    if (!b || !main || !this.playing) return [];
    const n = this.times.length;
    const out: Field[] = [];
    for (let k = 1; k <= Math.min(PLAY_AHEAD, n - 1); k++) {
      const f = this.cache.get(this.request(main, vars, (b.ib + k) % n, stride));
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
    const src = def ? this.sourceFor(def) : null;
    const info = def && src ? src.catalog.get(def.legendVar) : undefined;
    // An overlay's run covers less time than the weather run: outside it there is nothing to draw.
    const inRange = !!src && (src.run === this.run || !!this.bracket(src.times, false));
    if (def && src && info?.legend && inRange) {
      const frames = this.framesFor(def.vars, this.stride, undefined, src);
      if (frames) {
        // Zoomed in: the area in view at full resolution, drawn over the global field where it covers.
        let detail: FieldFrames | null = null;
        let hold = false;
        if (this.detailBox) {
          detail = this.framesFor(def.vars, 1, this.detailBox, src);
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
          if (this.shown?.layer !== def)
            this.fieldLayer.setSpec({ vars: def.vars, legend: info.legend, marine: info.marine, landOnly: info.land_only });
          this.fieldLayer.setFrames(frames, detail);
          this.shown = { layer: def, frames, detail };
        }
      } else complete = false;
    } else if (!def || !src || !inRange) {
      this.fieldLayer.setFrames(null);
      this.shown = null;
    }
    this.fieldLayer.setOpacity(this.compare ? 0 : this.opacity);

    // On a satellite layer the weather run's wind and isobars show only for the hours it covers.
    const weatherAt = !this.observing || !!this.bracket(this.times, false);

    // Particles: on wave layers they travel with the waves, otherwise with the wind.
    const flow = def?.flow;
    if (flow) {
      const raw = this.framesFor([flow.dir, flow.period], this.stride);
      if (raw) {
        this.flowFrames = { flow, frames: raw };
        if (this.particles) {
          const moving = (f: FieldFrames): FieldFrames => ({
            a: waveFlow(f.a, flow.dir, flow.period),
            b: f.b ? waveFlow(f.b, flow.dir, flow.period) : null,
            t: f.t,
          });
          // Zoomed in, the area in view at full resolution once it's here, as for the colours, so
          // the particles reach the same coastline; meanwhile the global field.
          const fine = this.detailBox ? this.framesFor([flow.dir, flow.period], 1, this.detailBox) : null;
          this.particleLayer.setFrames(moving(raw), ["u", "v"], { detail: fine ? moving(fine) : null, marine: true });
        }
      } else complete = false;
      this.windFrames = null;
    } else {
      this.flowFrames = null;
      const winds = def?.winds ?? WIND_VARS;
      // The weather run's wind, or the motion a layer's overlay run brings (ocean currents) while in range.
      const mover = def?.still
        ? null
        : this.mainServes(winds)
          ? weatherAt
            ? this.main()
            : null
          : def?.winds && src && inRange && this.serves(src, winds)
            ? src
            : null;
      if (this.particles && mover) {
        const frames = this.framesFor(winds, this.stride, undefined, mover);
        // Sea-only motion stops at the basemap's coast, as wave particles do.
        const marine = winds.every((id) => mover.catalog.get(id)?.marine);
        if (frames) {
          this.windFrames = frames;
          this.windVars = winds;
          const fine = marine && this.detailBox ? this.framesFor(winds, 1, this.detailBox, mover) : null;
          this.particleLayer.setFrames(frames, winds, { detail: fine, marine, pace: def?.current ? this.currentPace : 1 });
        } else complete = false;
      } else {
        this.windFrames = null;
        this.particleLayer.setFrames(null);
      }
    }
    if (!this.particles) this.particleLayer.setFrames(null);

    // Isobars and H/L on a 1° grid: the two steps around the time, crossfaded. Their contours
    // are computed in a worker as soon as each step's field arrives.
    if (this.showIsobars && this.mainServes(["mslp"]) && !weatherAt) {
      for (const slot of SLOTS) {
        for (const id of ISOBAR_LAYERS) this.paint(`${id}-${slot}`, id === "isobar-lines" ? "line-opacity" : "text-opacity", 0);
      }
      this.pressure = null;
    } else if (this.showIsobars && this.mainServes(["mslp"])) {
      const frames = this.framesFor(["mslp"], ISOBAR_STRIDE);
      for (const f of this.loadedAhead(["mslp"], ISOBAR_STRIDE)) this.isobarJobs.request(f);
      const b = frames ? (frames.b ?? frames.a) : null;
      const ma = frames ? this.isobarJobs.get(frames.a) : undefined;
      const mb = b ? this.isobarJobs.get(b) : undefined;
      if (frames && b && ma && mb) {
        // By model too: a GFS and an AIGFS run share run ids and hours.
        const step = (f: Field) => `${f.header.model}/${f.header.run}/${f.header.forecast_hour}`;
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
    const b = src ? this.bracket(src.times, src.run === this.run) : null;
    if (this.compare && def && src && b) {
      const run = src.run;
      const url = (k: number) =>
        this.client.tileUrl({
          variable: def.tileVar,
          time: src.runs ? 0 : run.forecast_hours[k]!,
          run: src.runs ? src.runs[k]! : run.run,
          model: run.model,
        });
      const [ua, ub] = [url(b.ia), url(b.ib)];
      this.setTileOpacity(this.tileFade.show(ua, ua, ub, ub, b.t));
      for (const u of new Set([ua, ub])) {
        if (!this.map.isSourceLoaded(`server-tiles-${this.tileFade.slotOf(u)}`)) complete = false;
      }
    }
    this.complete = complete;
    this.setCredit(src && src.run !== this.run && inRange ? [this.run, src.run] : [this.run]);
    this.status();
  }

  /**
   * Credit the models in view in the map's attribution, in their licence's words where it asks for
   * them (ECMWF's data: CC BY 4.0). A source's attribution shows while a visible layer uses it, so an
   * empty source and layer carry it, replaced when the text changes.
   */
  private setCredit(runs: RunDetail[]): void {
    const text = [...new Set(runs.map(creditFor))].join(" · ");
    if (text === this.credit || !this.loaded) return;
    this.credit = text;
    if (this.map.getLayer("forecast-credit")) this.map.removeLayer("forecast-credit");
    if (this.map.getSource("forecast-credit")) this.map.removeSource("forecast-credit");
    this.map.addSource("forecast-credit", { type: "geojson", data: EMPTY, attribution: text });
    this.map.addLayer({ id: "forecast-credit", type: "fill", source: "forecast-credit" });
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
      for (const id of ISOBAR_LAYERS) this.map.setLayoutProperty(`${id}-${slot}`, "visibility", vis(this.showIsobars && this.mainServes(["mslp"])));
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
    // A u/v pair at the point, between the two steps; null where it's missing (land, for currents).
    const uvAt = (f: FieldFrames, uv: string, vv: string) => {
      const a = f.a.wind(lat, wrapped, uv, vv);
      const b = f.b ? f.b.wind(lat, wrapped, uv, vv) : a;
      const u = a.u + (b.u - a.u) * f.t;
      const v = a.v + (b.v - a.v) * f.t;
      return Number.isFinite(u) && Number.isFinite(v) ? { u, v } : null;
    };
    let wind: Readout["wind"] = null;
    let current: Readout["current"] = null;
    const currents = this.shown?.layer.current ? this.shown.layer.winds : undefined;
    if (this.shown && currents) {
      // Where the colours are the current's u/v (Currents), read it as they are, finer where zoomed in
      // (a tidal race is narrower than the particles' global grid); otherwise (Tides) from the particles'.
      const { frames, detail, layer } = this.shown;
      const [uv, vv] = currents;
      const own = layer.vars.includes(uv);
      const f = own ? (detail && covers(detail.a, lat, wrapped) ? detail : frames) : this.windFrames;
      const c = f ? uvAt(f, uv, vv) : null;
      if (c) current = { speed: Math.hypot(c.u, c.v), heading: ((((Math.atan2(c.u, c.v) * 180) / Math.PI) % 360) + 360) % 360 };
    } else {
      const wf = this.windFrames ?? (this.shown?.layer.id === "wind" ? this.shown.frames : null);
      const w = wf ? uvAt(wf, ...(this.windFrames ? this.windVars : WIND_VARS)) : null;
      if (w) wind = { speed: Math.hypot(w.u, w.v), direction: windDirection(w.u, w.v) };
    }
    const p = this.pressure?.sample("mslp", lat, wrapped);
    return { lon: wrapped, lat, value, wind, current, wave, mslp: p !== undefined && Number.isFinite(p) ? p : null };
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

/** Two sets of frames are for the same model, run and steps. */
function sameSteps(x: FieldFrames, y: FieldFrames): boolean {
  const hour = (f: Field | null) => (f ? `${f.header.model}/${f.header.run}/${f.header.forecast_hour}` : "");
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
