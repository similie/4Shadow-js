import type { StyleSpecification } from "maplibre-gl";

/**
 * A quiet basemap on OpenFreeMap's OpenMapTiles vector tiles (free, no key), Night or Day.
 *
 * Weather layers go between the land/sea fills and everything else: insert them before
 * `WEATHER_BEFORE`, so coasts, borders and labels stay readable on top of the colours.
 */
export const WEATHER_BEFORE = "water-shade";

export type MapTheme = "dark" | "light";

/** Every colour of the map that isn't weather data, for Night (dark) and Day (light). */
export interface MapPalette {
  /**
   * Land. The style's background is transparent so that, until the weather is drawn, only water
   * is opaque: sea-only layers (waves) use that to stay off the land, and the field layer then
   * paints this colour under whatever is still transparent (see field-layer.ts).
   */
  land: string;
  water: string;
  /** Seas drawn again over the weather, translucent, so coasts show as a change in shade. */
  waterShade: string;
  waterShadeOpacity: number;
  road: string;
  state: string;
  country: string;
  waterName: string;
  town: string;
  city: string;
  countryName: string;
  halo: string;
  isobar: string;
  isobarText: string;
  isobarHalo: string;
  high: string;
  low: string;
  centreHalo: string;
  /** Wind and wave particles (RGB, 0 to 1) and how strongly they're drawn. */
  particles: [number, number, number];
  particleOpacity: number;
}

export const PALETTES: Record<MapTheme, MapPalette> = {
  dark: {
    land: "#262b33",
    water: "#11161d",
    waterShade: "#05080c",
    waterShadeOpacity: 0.28,
    road: "rgba(255, 255, 255, 0.16)",
    state: "rgba(255, 255, 255, 0.2)",
    country: "rgba(255, 255, 255, 0.5)",
    waterName: "rgba(200, 220, 240, 0.55)",
    town: "rgba(232, 237, 242, 0.8)",
    city: "#e8edf2",
    countryName: "rgba(240, 244, 248, 0.9)",
    halo: "rgba(8, 11, 16, 0.85)",
    isobar: "rgba(255, 255, 255, 0.55)",
    isobarText: "rgba(255, 255, 255, 0.8)",
    isobarHalo: "rgba(0, 0, 0, 0.55)",
    high: "#ffd6d6",
    low: "#d6e6ff",
    centreHalo: "rgba(0, 0, 0, 0.6)",
    particles: [1, 1, 1],
    particleOpacity: 0.9,
  },
  light: {
    land: "#e7e6df",
    water: "#c9d2d9",
    waterShade: "#1f3b57",
    waterShadeOpacity: 0.24,
    road: "rgba(10, 10, 11, 0.18)",
    state: "rgba(10, 10, 11, 0.28)",
    country: "rgba(10, 10, 11, 0.55)",
    waterName: "rgba(30, 55, 85, 0.65)",
    town: "rgba(10, 10, 11, 0.8)",
    city: "#0a0a0b",
    countryName: "rgba(10, 10, 11, 0.85)",
    halo: "rgba(250, 250, 247, 0.85)",
    isobar: "rgba(10, 10, 11, 0.5)",
    isobarText: "rgba(10, 10, 11, 0.8)",
    isobarHalo: "rgba(255, 255, 255, 0.7)",
    high: "#9b1c1c",
    low: "#1d4a9c",
    centreHalo: "rgba(255, 255, 255, 0.75)",
    particles: [0.12, 0.12, 0.15],
    particleOpacity: 0.5,
  },
};

/** The basemap's paint properties that change with the theme, by layer id. */
export function basemapPaint(p: MapPalette): Record<string, Record<string, unknown>> {
  return {
    water: { "fill-color": p.water },
    "water-shade": { "fill-color": p.waterShade, "fill-opacity": p.waterShadeOpacity },
    roads: { "line-color": p.road },
    "boundary-state": { "line-color": p.state },
    "boundary-country": { "line-color": p.country },
    "water-name": { "text-color": p.waterName, "text-halo-color": p.halo },
    "place-town": { "text-color": p.town, "text-halo-color": p.halo },
    "place-city": { "text-color": p.city, "text-halo-color": p.halo },
    "place-country": { "text-color": p.countryName, "text-halo-color": p.halo },
  };
}

const SOURCE = "openmaptiles";
const NAME = ["coalesce", ["get", "name:en"], ["get", "name"]];
const FONT = ["Noto Sans Regular"];
export const FONT_BOLD = ["Noto Sans Bold"];

export function basemapStyle(theme: MapTheme = "dark"): StyleSpecification {
  const paint = basemapPaint(PALETTES[theme]);
  const style = {
    version: 8,
    name: `4Shadow ${theme}`,
    glyphs: "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf",
    sources: {
      [SOURCE]: {
        type: "vector",
        url: "https://tiles.openfreemap.org/planet",
        attribution:
          '<a href="https://openfreemap.org" target="_blank">OpenFreeMap</a> ' +
          '<a href="https://www.openmaptiles.org/" target="_blank">© OpenMapTiles</a> ' +
          'Data from <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a>',
      },
    },
    layers: [
      { id: "background", type: "background", paint: { "background-color": "rgba(0, 0, 0, 0)" } },
      { id: "water", type: "fill", source: SOURCE, "source-layer": "water", paint: {} },
      // Weather layers are inserted here.
      // Seas drawn again, translucent, over the weather: coasts show as a change in shade with no
      // tile seams (OpenStreetMap's water polygons are cut into squares, so outlines would show a grid).
      {
        id: "water-shade",
        type: "fill",
        source: SOURCE,
        "source-layer": "water",
        filter: ["!=", ["get", "brunnel"], "tunnel"],
        paint: {},
      },
      {
        id: "roads",
        type: "line",
        source: SOURCE,
        "source-layer": "transportation",
        minzoom: 6,
        filter: ["match", ["get", "class"], ["motorway", "trunk", "primary"], true, false],
        paint: {
          "line-width": ["interpolate", ["linear"], ["zoom"], 6, 0.4, 12, 1.4],
        },
      },
      {
        id: "boundary-state",
        type: "line",
        source: SOURCE,
        "source-layer": "boundary",
        minzoom: 3,
        filter: ["all", ["==", ["get", "admin_level"], 4], ["!=", ["get", "maritime"], 1]],
        paint: { "line-width": 0.6, "line-dasharray": [3, 2] },
      },
      {
        id: "boundary-country",
        type: "line",
        source: SOURCE,
        "source-layer": "boundary",
        filter: ["all", ["==", ["get", "admin_level"], 2], ["!=", ["get", "maritime"], 1]],
        paint: {
          "line-width": ["interpolate", ["linear"], ["zoom"], 1, 0.5, 6, 1.1],
        },
      },
      {
        id: "water-name",
        type: "symbol",
        source: SOURCE,
        "source-layer": "water_name",
        filter: ["match", ["get", "class"], ["ocean", "sea"], true, false],
        layout: {
          "text-field": NAME,
          "text-font": FONT,
          "text-size": ["interpolate", ["linear"], ["zoom"], 1, 10, 6, 13],
          "text-letter-spacing": 0.15,
          "text-max-width": 6,
        },
        paint: { "text-halo-width": 1 },
      },
      {
        id: "place-town",
        type: "symbol",
        source: SOURCE,
        "source-layer": "place",
        minzoom: 6,
        filter: ["match", ["get", "class"], ["town", "village"], true, false],
        layout: { "text-field": NAME, "text-font": FONT, "text-size": 11, "text-max-width": 8 },
        paint: { "text-halo-width": 1.2 },
      },
      {
        id: "place-city",
        type: "symbol",
        source: SOURCE,
        "source-layer": "place",
        minzoom: 3,
        filter: ["==", ["get", "class"], "city"],
        layout: {
          "text-field": NAME,
          "text-font": FONT,
          "text-size": ["interpolate", ["linear"], ["zoom"], 3, 11, 8, 15],
          "text-max-width": 8,
          "symbol-sort-key": ["get", "rank"],
        },
        paint: { "text-halo-width": 1.4 },
      },
      {
        id: "place-country",
        type: "symbol",
        source: SOURCE,
        "source-layer": "place",
        maxzoom: 8,
        filter: ["==", ["get", "class"], "country"],
        layout: {
          "text-field": NAME,
          "text-font": FONT_BOLD,
          "text-size": ["interpolate", ["linear"], ["zoom"], 1, 10, 5, 14],
          "text-transform": "uppercase",
          "text-letter-spacing": 0.08,
          "text-max-width": 7,
          "symbol-sort-key": ["get", "rank"],
        },
        paint: { "text-halo-width": 1.4 },
      },
    ],
  };
  for (const layer of style.layers as { id: string; paint?: Record<string, unknown> }[]) {
    if (paint[layer.id]) layer.paint = { ...layer.paint, ...paint[layer.id] };
  }
  return style as StyleSpecification;
}
