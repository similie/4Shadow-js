import type { Alert, AlertArea, AlertEventCollection } from "@similie/4shadow";
import type { Feature, FeatureCollection, Geometry } from "geojson";
import type { FilterSpecification, GeoJSONSource, Map as MapLibreMap, MapMouseEvent, PointLike } from "maplibre-gl";
import { FONT_BOLD } from "#lib/weather/basemap.ts";
import { areaShape, centre } from "./geo.ts";

/**
 * Early warnings on the map: your alerts' areas, their events (filled while they are on at the map's
 * time, outlined while still to come), and the area being drawn for a new alert.
 * No Svelte here, like the weather code next to it.
 */

/** Status colours, kept apart from the weather palettes. Shown with words in the panel, never alone. */
export const ALERT_COLORS = {
  now: "#ff6b5e",
  later: "#ffb238",
  area: "#c3c2b7",
  selected: "#7fd1ff",
} as const;

/** Under every alert line: keeps them readable over the brightest weather colours. */
const CASING = "#0b0e12";

/** Above the weather and isobars, under place names. */
const BEFORE = "water-name";
const EMPTY: FeatureCollection = { type: "FeatureCollection", features: [] };
const POLYGONS: FilterSpecification = ["!=", ["geometry-type"], "Point"];
const POINTS: FilterSpecification = ["==", ["geometry-type"], "Point"];

export type DrawKind = "point" | "polygon";

export class AlertLayers {
  private ready = false;
  private queued: Array<() => void> = [];
  private time = 0;
  // Drawing
  private drawKind: DrawKind | null = null;
  private vertices: [number, number][] = [];
  private closed = false;
  private onDraw: ((area: AlertArea | null) => void) | null = null;
  private draft: { area: AlertArea | null; radiusKm: number } = {
    area: null,
    radiusKm: 0,
  };

  constructor(private readonly map: MapLibreMap) {
    // Whichever comes first: the style read ("style.load", unless that has passed) or everything loaded.
    let added = false;
    const add = () => {
      if (added) return;
      added = true;
      this.addLayers();
    };
    if (map.isStyleLoaded()) add();
    else {
      map.once("style.load", add);
      map.once("load", add);
    }
  }

  /** True while drawing an area: map clicks belong to the drawing. */
  get drawing(): boolean {
    return this.drawKind !== null;
  }

  private addLayers(): void {
    const map = this.map;
    for (const id of ["alert-areas", "alert-events", "alert-labels", "alert-draft"]) {
      map.addSource(id, { type: "geojson", data: EMPTY });
    }
    const add = (layer: Parameters<MapLibreMap["addLayer"]>[0]) => map.addLayer(layer, map.getLayer(BEFORE) ? BEFORE : undefined);

    // Your alerts' areas: a quiet outline, the selected one in the accent colour.
    add({
      id: "alert-areas-fill",
      type: "fill",
      source: "alert-areas",
      filter: POLYGONS,
      paint: { "fill-color": ALERT_COLORS.area, "fill-opacity": 0.03 },
    });
    add({
      id: "alert-areas-casing",
      type: "line",
      source: "alert-areas",
      paint: { "line-color": CASING, "line-width": ["case", ["get", "selected"], 5, 4], "line-opacity": ["case", ["get", "active"], 0.4, 0.2] },
    });
    add({
      id: "alert-areas-line",
      type: "line",
      source: "alert-areas",
      paint: {
        "line-color": ["case", ["get", "selected"], ALERT_COLORS.selected, ALERT_COLORS.area],
        "line-width": ["case", ["get", "selected"], 2, 1.2],
        "line-opacity": ["case", ["get", "active"], 0.8, 0.35],
        "line-dasharray": [3, 2],
      },
    });
    add({
      id: "alert-areas-point",
      type: "circle",
      source: "alert-areas",
      filter: POINTS,
      paint: {
        "circle-radius": 5,
        "circle-color": "rgba(0,0,0,0)",
        "circle-stroke-width": 2,
        "circle-stroke-color": ["case", ["get", "selected"], ALERT_COLORS.selected, ALERT_COLORS.area],
      },
    });

    // Events still to come at the map's time: an amber outline. On at that time: filled.
    add({ id: "alert-events-casing", type: "line", source: "alert-events", paint: { "line-color": CASING, "line-width": 5, "line-opacity": 0.5 } });
    add({
      id: "alert-events-later",
      type: "line",
      source: "alert-events",
      paint: {
        "line-color": ALERT_COLORS.later,
        "line-width": 1.5,
        "line-dasharray": [2, 2],
      },
    });
    // Events on at the map's time: filled.
    add({
      id: "alert-events-now-fill",
      type: "fill",
      source: "alert-events",
      filter: POLYGONS,
      paint: { "fill-color": ALERT_COLORS.now, "fill-opacity": 0.22 },
    });
    add({
      id: "alert-events-now-line",
      type: "line",
      source: "alert-events",
      paint: { "line-color": ALERT_COLORS.now, "line-width": 2 },
    });
    add({
      id: "alert-events-now-point",
      type: "circle",
      source: "alert-events",
      filter: POINTS,
      paint: {
        "circle-radius": 7,
        "circle-color": ALERT_COLORS.now,
        "circle-stroke-width": 2,
        "circle-stroke-color": "#0b0e12",
      },
    });
    add({
      id: "alert-events-now-label",
      type: "symbol",
      source: "alert-labels",
      layout: {
        "text-field": ["get", "label"],
        "text-font": FONT_BOLD,
        "text-size": 12,
        "text-offset": [0, 1.4],
        "text-anchor": "top",
        "text-max-width": 12,
      },
      paint: {
        "text-color": "#f4f6f8",
        "text-halo-color": "#0b0e12",
        "text-halo-width": 1.6,
      },
    });

    // The area being drawn.
    add({
      id: "alert-draft-fill",
      type: "fill",
      source: "alert-draft",
      filter: ["==", ["get", "part"], "shape"],
      paint: { "fill-color": ALERT_COLORS.selected, "fill-opacity": 0.12 },
    });
    add({
      id: "alert-draft-line",
      type: "line",
      source: "alert-draft",
      filter: ["!=", ["get", "part"], "vertex"],
      paint: {
        "line-color": ALERT_COLORS.selected,
        "line-width": 2,
        "line-dasharray": [2, 1.5],
      },
    });
    add({
      id: "alert-draft-vertex",
      type: "circle",
      source: "alert-draft",
      filter: ["==", ["get", "part"], "vertex"],
      paint: {
        "circle-radius": ["case", ["get", "first"], 6, 4],
        "circle-color": "#0b0e12",
        "circle-stroke-width": 2,
        "circle-stroke-color": ALERT_COLORS.selected,
      },
    });

    map.on("mousemove", this.move);
    this.ready = true;
    for (const fn of this.queued.splice(0)) fn();
    this.setTime(this.time);
  }

  private whenReady(fn: () => void): void {
    if (this.ready) fn();
    else this.queued.push(fn);
  }

  private source(id: string): GeoJSONSource | undefined {
    return this.map.getSource(id) as GeoJSONSource | undefined;
  }

  // ---------------------------------------------------------------------------------- data

  setAlerts(alerts: Alert[], selected: string | null): void {
    this.whenReady(() =>
      this.source("alert-areas")?.setData({
        type: "FeatureCollection",
        features: alerts.map((a) => ({
          type: "Feature",
          id: a.id,
          geometry: areaShape(a.area, a.radius_km) as Geometry,
          properties: {
            id: a.id,
            name: a.name,
            active: a.active,
            selected: a.id === selected,
          },
        })),
      }),
    );
  }

  setEvents(collection: AlertEventCollection | null): void {
    const features = (collection?.features ?? []).map((f) => {
      const p = f.properties;
      return {
        type: "Feature",
        id: f.id,
        geometry: areaShape(f.geometry, p.radius_km) as Geometry,
        properties: {
          id: f.id,
          alert_id: p.alert_id,
          start: Date.parse(p.start),
          end: Date.parse(p.end),
        },
      } satisfies Feature;
    });
    const labels = (collection?.features ?? []).map((f) => ({
      type: "Feature" as const,
      geometry: { type: "Point" as const, coordinates: centre(f.geometry) },
      properties: {
        label: f.properties.alert_name ?? "",
        start: Date.parse(f.properties.start),
        end: Date.parse(f.properties.end),
      },
    }));
    this.whenReady(() => {
      this.source("alert-events")?.setData({
        type: "FeatureCollection",
        features,
      });
      this.source("alert-labels")?.setData({
        type: "FeatureCollection",
        features: labels,
      });
    });
  }

  /** Fill the events that are on at this time; outline those still to come. */
  setTime(ms: number): void {
    this.time = ms;
    if (!this.ready) return;
    const now = ["all", ["<=", ["get", "start"], ms], [">=", ["get", "end"], ms]];
    for (const id of ["alert-events-now-fill", "alert-events-now-line", "alert-events-now-point", "alert-events-now-label"]) {
      const base = id.endsWith("fill") ? POLYGONS : id.endsWith("point") ? POINTS : null;
      this.map.setFilter(id, (base ? ["all", base, now] : now) as never);
    }
    this.map.setFilter("alert-events-later", [">", ["get", "start"], ms]);
    this.map.setFilter("alert-events-casing", [">=", ["get", "end"], ms]);
  }

  /** The alert under a map click, if any: an event on now, or an alert's area. */
  hit(point: PointLike): string | null {
    if (!this.ready) return null;
    const [x, y] = Array.isArray(point) ? point : [point.x, point.y];
    const box: [PointLike, PointLike] = [
      [x - 4, y - 4],
      [x + 4, y + 4],
    ];
    // Areas by their outline only, so a click inside one still opens that point's forecast.
    const layers = ["alert-events-now-fill", "alert-events-now-point", "alert-areas-point", "alert-areas-line"];
    for (const f of this.map.queryRenderedFeatures(box, { layers })) {
      const id = f.properties?.alert_id ?? f.properties?.id;
      if (typeof id === "string") return id;
    }
    return null;
  }

  // ---------------------------------------------------------------------------------- drawing

  /** Show the draft area (from the editor: a point and its radius, or a polygon). */
  setDraft(area: AlertArea | null, radiusKm = 0): void {
    this.draft = { area, radiusKm };
    if (area?.type === "Polygon") {
      this.vertices = area.coordinates[0]!.slice(0, -1) as [number, number][];
      this.closed = true;
    }
    this.renderDraft();
  }

  /** Start drawing: a click places the point, or each click adds a polygon corner. */
  startDraw(kind: DrawKind, onChange: (area: AlertArea | null) => void): void {
    this.drawKind = kind;
    this.onDraw = onChange;
    if (kind === "polygon") {
      this.vertices = [];
      this.closed = false;
    }
    this.map.doubleClickZoom.disable();
    this.map.getCanvas().style.cursor = "crosshair";
    this.renderDraft();
  }

  stopDraw(): void {
    this.drawKind = null;
    this.onDraw = null;
    this.map.doubleClickZoom.enable();
    this.map.getCanvas().style.cursor = "";
    this.renderDraft();
  }

  /** Remove the last polygon corner. */
  undoVertex(): void {
    if (this.drawKind !== "polygon" || this.closed) return;
    this.vertices.pop();
    this.renderDraft();
  }

  /** Close the polygon (also: click its first corner, or double-click). */
  finishPolygon(): void {
    if (this.drawKind !== "polygon" || this.vertices.length < 3) return;
    this.closed = true;
    const ring = [...this.vertices, this.vertices[0]!];
    this.onDraw?.({ type: "Polygon", coordinates: [ring] });
    this.stopDraw();
  }

  /**
   * A map click, passed on by the page before it does anything else with it. True when the drawing
   * took it. (Not a listener of its own: the page's would run first and open a forecast.)
   */
  handleClick(e: MapMouseEvent): boolean {
    if (!this.drawKind) return false;
    const lngLat: [number, number] = [round(e.lngLat.wrap().lng), round(e.lngLat.lat)];
    if (this.drawKind === "point") {
      this.onDraw?.({ type: "Point", coordinates: lngLat });
      this.stopDraw();
      return true;
    }
    if (this.closed) return true;
    const near = (v: [number, number] | undefined, px: number) => {
      if (!v || this.vertices.length < 3) return false;
      const p = this.map.project(v);
      return Math.hypot(p.x - e.point.x, p.y - e.point.y) < px;
    };
    // Back on the first corner closes it; so does a double-click (two clicks on the same spot).
    if (near(this.vertices[0], 10) || near(this.vertices[this.vertices.length - 1], 4)) {
      this.finishPolygon();
      return true;
    }
    this.vertices.push(lngLat);
    this.renderDraft(lngLat);
    return true;
  }

  private move = (e: MapMouseEvent) => {
    if (this.drawKind === "polygon" && !this.closed && this.vertices.length) this.renderDraft([e.lngLat.lng, e.lngLat.lat]);
  };

  private renderDraft(cursor?: [number, number]): void {
    const features: Feature[] = [];
    const drawingPolygon = this.drawKind === "polygon" && !this.closed;
    if (drawingPolygon) {
      const line = cursor ? [...this.vertices, cursor] : this.vertices;
      if (line.length >= 2)
        features.push({
          type: "Feature",
          geometry: { type: "LineString", coordinates: line },
          properties: { part: "line" },
        });
      this.vertices.forEach((v, i) =>
        features.push({
          type: "Feature",
          geometry: { type: "Point", coordinates: v },
          properties: { part: "vertex", first: i === 0 },
        }),
      );
    } else if (this.draft.area) {
      const shape = areaShape(this.draft.area, this.draft.radiusKm);
      if (shape.type === "Point") {
        features.push({
          type: "Feature",
          geometry: shape,
          properties: { part: "vertex", first: true },
        });
      } else {
        features.push({
          type: "Feature",
          geometry: shape as Geometry,
          properties: { part: "shape" },
        });
      }
    }
    this.whenReady(() =>
      this.source("alert-draft")?.setData({
        type: "FeatureCollection",
        features,
      }),
    );
  }

  destroy(): void {
    this.map.off("mousemove", this.move);
  }
}

const round = (x: number) => Math.round(x * 1e4) / 1e4;
