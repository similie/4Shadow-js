# 4Shadow map lab

A local SvelteKit app for building and testing 4Shadow weather maps. It draws Windy-style maps from the API's raw fields:

- **Colour layers on the GPU** for wind, gusts, temperature, rain, clouds, pressure, waves, swell, wave period, humidity, dew point, CAPE, water vapour, visibility, sunshine and snow depth. The colours are the API's own legends, so they match the server's PNG tiles. They are smooth between grid points.
- **Animated particles**, moved on the GPU and leaving fading trails. They follow the wind, or on the wave layers, the waves: toward where the waves are heading, at their group speed (about 0.78 m/s per second of period), so long swell outruns short wind waves.
- **Sharp when zoomed in.** The whole world loads at 0.5°. From zoom 3, the area in view also loads at the full 0.25° and is drawn over it.
- **Waves follow the real coastline.** The wave model's land mask is coarse (0.25° cells), so wave values are spread two cells toward the coast and then clipped to the basemap's water.
- **Isobars** with labels, and **high/low pressure centres**.
- **Smooth time.** The colour layers and particles blend their values between forecast steps. Isobars, H/L centres and the server's tiles can't be blended that way, so each has two copies, one for the step before and one for the step after, crossfaded as time moves. A copy gets the next step's data only while it is invisible, so nothing jumps. Data is fetched four steps ahead (past the end, too, since playback loops); the isobars for those steps are computed in a worker as their data arrives. Playback waits for all of it, keeping the last full picture meanwhile, and never skips.
- **Flat map or globe.**
- **Click for a point forecast**: current conditions (with waves at sea), a meteogram with a wave row at sea (click an hour to show it on the map), daily and hourly tables.
- **Place search** with GeoNames names, or type `lat, lon`.
- **Server tiles** setting: shows the server's PNG tiles in place of the WebGL layer, to compare the two.

## Run it

You need a 4Shadow API that serves fields (`/v2/{model}/fields/…`). The simplest is a local one from the `hyphen-forecaster` repo:

```sh
cd hyphen-forecaster && .venv/bin/uvicorn forecast.api:app --port 5003
```

Then, from the root of this repo:

```sh
npm install
npm run lab        # http://localhost:5173
```

To use another API, copy `.env.example` to `.env.local` and set `VITE_FORESHADOW_URL`, plus `VITE_FORESHADOW_KEY` if it needs a key. `.env.local` is git-ignored. In the browser the key goes in the query string, so use a test key.

Keys: <kbd>Space</kbd> plays and pauses, <kbd>←</kbd>/<kbd>→</kbd> move an hour (with <kbd>Shift</kbd>, a day), <kbd>Esc</kbd> closes the point panel. The map position is kept in the URL.

## How it's built

`src/lib/weather/` holds the map code. It uses no Svelte, so it can move into an SDK map package later:

| File | What it does |
|---|---|
| `weather-map.ts` | Owns the MapLibre map. Turns time and settings into data requests and layer updates; handles playback and the hover readout. |
| `field-layer.ts` | MapLibre custom layer. Draws a field's values as colours. Float textures are sampled bilinearly in the shader, with the legend's stops as uniforms. Blends two steps, and uses a finer regional field where it has one. Works in mercator (all world copies) and on the globe. It also paints the land: the basemap's background is transparent, so sea-only layers can draw only where water is (`DST_ALPHA` blending), and the land colour then goes under whatever is still transparent. |
| `particle-layer.ts` | Particles for any vector field (wind, or wave motion). Positions are updated with WebGL2 transform feedback. Each move is drawn as an anti-aliased segment into a trail texture that fades every frame. Particles end where the field has no data (land, for waves). Trails reset while the map moves. |
| `wave-flow.ts` | Turns wave direction and period into a vector field for the particles. |
| `crossfade.ts` | Two copies of a per-step overlay (isobars, server tiles), crossfaded between steps. |
| `isobar-jobs.ts`, `isobars.worker.ts` | Computes each step's isobars in a worker (about 30 ms per step, which made playback stutter on the main thread), cached per field. |
| `isobars.ts` | Isobars every 4 hPa (d3-contour on a 1° pressure field, smoothed), plus H/L centres. |
| `cache.ts` | Fetched fields (global, or a `bbox` at full resolution), shared between layers, with prefetching and a size limit. |
| `gl.ts` | Shader helpers: MapLibre's projection prelude, grid sampling in GLSL, float textures. |
| `basemap.ts` | Dark basemap on OpenFreeMap vector tiles. Weather sits under coasts, borders and labels. |

The app uses the SDK's TypeScript source (the `source` export condition), so SDK changes show up here without a rebuild.

## Data use

A global field at 0.25° is about 2 MB per variable per step: wind (u + v) is about 4 MB, and the 1° pressure field for isobars is about 130 KB. The lab loads the world at 0.5° (a quarter of that) and, from zoom 3, the area in view at 0.25°: at zoom 4 on a large screen, about 0.4 MB of wind per step. Change the world grid under *More settings → Global grid*; at 0.25° there is no separate detail.

## Known gaps

- Rain and some other GFS fields look blocky at the coast. That comes from the data; the server tiles show the same.
- GFS-Wave's global grid leaves out the Black and Caspian Seas, so they have no waves.
- Lakes within about 50 km of the sea pick up the spread sea values.
- Particles move at a constant screen speed per m/s, like Windy, not at true ground speed.
- Spreading wave values toward the coast runs on the main thread, so a frame can take up to ~50 ms when a new step arrives during playback. A worker would fix that.

## Credits

Forecasts: NOAA GFS. Place names: GeoNames (CC BY 4.0). Basemap: OpenFreeMap, © OpenMapTiles, © OpenStreetMap contributors.
