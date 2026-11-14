import type { StyleSpecification } from "maplibre-gl";

/**
 * A dark basemap on OpenFreeMap's OpenMapTiles vector tiles (free, no key).
 *
 * Weather layers go between the land/sea fills and everything else: insert them before
 * `WEATHER_BEFORE`, so coasts, borders and labels stay readable on top of the colours.
 */
export const WEATHER_BEFORE = "water-shade";

/**
 * Land colour. The style's background is transparent so that, until the weather is drawn, only
 * water is opaque: sea-only layers (waves) use that to stay off the land, and the field layer then
 * paints this colour under whatever is still transparent (see field-layer.ts).
 */
export const LAND = "#262b33";

const SOURCE = "openmaptiles";
const NAME = ["coalesce", ["get", "name:en"], ["get", "name"]];
const FONT = ["Noto Sans Regular"];
export const FONT_BOLD = ["Noto Sans Bold"];
const TEXT = "#e8edf2";
const HALO = "rgba(8, 11, 16, 0.85)";

export function darkStyle(): StyleSpecification {
  return {
    version: 8,
    name: "4Shadow dark",
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
      { id: "water", type: "fill", source: SOURCE, "source-layer": "water", paint: { "fill-color": "#11161d" } },
      // Weather layers are inserted here.
      // Seas drawn again, translucent, over the weather: coasts show as a change in shade with no
      // tile seams (OpenStreetMap's water polygons are cut into squares, so outlines would show a grid).
      {
        id: "water-shade",
        type: "fill",
        source: SOURCE,
        "source-layer": "water",
        filter: ["!=", ["get", "brunnel"], "tunnel"],
        paint: { "fill-color": "#05080c", "fill-opacity": 0.28 },
      },
      {
        id: "roads",
        type: "line",
        source: SOURCE,
        "source-layer": "transportation",
        minzoom: 6,
        filter: ["match", ["get", "class"], ["motorway", "trunk", "primary"], true, false],
        paint: {
          "line-color": "rgba(255, 255, 255, 0.16)",
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
        paint: { "line-color": "rgba(255, 255, 255, 0.2)", "line-width": 0.6, "line-dasharray": [3, 2] },
      },
      {
        id: "boundary-country",
        type: "line",
        source: SOURCE,
        "source-layer": "boundary",
        filter: ["all", ["==", ["get", "admin_level"], 2], ["!=", ["get", "maritime"], 1]],
        paint: {
          "line-color": "rgba(255, 255, 255, 0.5)",
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
        paint: { "text-color": "rgba(200, 220, 240, 0.55)", "text-halo-color": HALO, "text-halo-width": 1 },
      },
      {
        id: "place-town",
        type: "symbol",
        source: SOURCE,
        "source-layer": "place",
        minzoom: 6,
        filter: ["match", ["get", "class"], ["town", "village"], true, false],
        layout: { "text-field": NAME, "text-font": FONT, "text-size": 11, "text-max-width": 8 },
        paint: { "text-color": "rgba(232, 237, 242, 0.8)", "text-halo-color": HALO, "text-halo-width": 1.2 },
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
        paint: { "text-color": TEXT, "text-halo-color": HALO, "text-halo-width": 1.4 },
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
        paint: { "text-color": "rgba(240, 244, 248, 0.9)", "text-halo-color": HALO, "text-halo-width": 1.4 },
      },
    ],
  } as StyleSpecification;
}
