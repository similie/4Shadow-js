# @similie/4shadow

A JavaScript and TypeScript client for the [4Shadow](https://4shadow.io) weather forecast API. It works in Node 22+, browsers, Deno and Bun, and has no dependencies.

- **Point forecasts** for any place on Earth: give coordinates or a place name ("Paris", "Same, Timor-Leste").
- **Place search**, by name or nearest to a point.
- **Map tiles** for MapLibre, Leaflet or OpenLayers.
- **Raw gridded fields** for WebGL maps: colour layers, wind particles, isobars, and values under the cursor.

Forecasts come from NOAA's GFS model, which covers the whole globe at 0.25°, with sea state (waves and swell) from NOAA's GFS-Wave model. Where the API serves it, `model: "aigfs"` gives NOAA's AI model (AIGFS, built on Google DeepMind's GraphCast) on the same grid, 6-hourly, to compare against. On api.4shadow.io AIGFS is on the Solo and Norris plans.

## Install

```sh
npm install @similie/4shadow
```

## Point forecasts

```ts
import { ForeshadowClient, dailyRows } from "@similie/4shadow";

const fs = new ForeshadowClient({ apiKey: process.env.FORESHADOW_API_KEY });

// By place name. The response says which place it used and lists others with the same name.
const paris = await fs.forecast("Paris, France", { hours: 48 });
console.log(paris.location.place?.display_name, paris.current?.t2m, "°C");

// By coordinates. The response names the nearest town.
const dili = await fs.forecast({ lat: -8.556, lon: 125.56 }, { vars: ["t2m", "precip", "wind_speed"] });
console.log(dili.location.nearest_place?.name);

// Daily summaries in the location's own time zone
for (const day of dailyRows(dili)) console.log(day.date, day.t2m_min, day.t2m_max, day.precip_sum);
```

Timeseries come back as columns: `forecast.timeseries.t2m[i]` lines up with `forecast.timeseries.time[i]`. `timeseriesRows()` turns them into one object per step.

### Sea state

At sea, forecasts include `wave_height` (significant wave height), `wave_period`, `wave_dir`, `wind_wave_height`, `swell_height`, `swell_period` and `swell_dir`, plus a daily `wave_height_max`. Directions are where the waves come from, clockwise from north. Over land these are `null`. On a coast the wave model treats as land, they come from the nearest open sea within 50 km, and `location.sea_point` says where:

```ts
const lisbon = await fs.forecast("Lisbon, Portugal", { vars: ["wave_height", "wave_dir", "wave_period"] });
lisbon.current?.wave_height; // 3.2 (m)
lisbon.location.sea_point; // { lat: 38.75, lon: -9.5, distance_km: 30.5 }
```

Variables that exist only at sea have `marine: true` in `fs.variables()`.

## Places

```ts
const { results } = await fs.searchPlaces("Springfield", { limit: 5 });
const near = await fs.nearestPlaces(-8.56, 125.57, { minPopulation: 1000 });
```

Place names come from [GeoNames](https://www.geonames.org) under CC BY 4.0. If you show them, credit GeoNames; every response includes an `attribution` string you can display.

## Maps

### Tiles

```ts
map.addSource("temperature", {
  type: "raster",
  tiles: [fs.tileUrl({ variable: "t2m", time: 6 })], // forecast hour 6 of the latest run
  tileSize: 256,
});
```

### Fields, for WebGL layers

A field holds one forecast step's values on the model grid, for up to four variables. It comes as a compact binary format (`4SF1`: a JSON header followed by int16 arrays), decoded for you:

```ts
const run = await fs.run(); // steps and valid times of the latest run
const field = await fs.field({ vars: ["u10", "v10"], time: run.forecast_hours[3], run: run.run, stride: 2 });

field.grid; // { lat0, dlat, nlat, lon0, dlon, nlon, wraps }
field.values("u10"); // Float32Array, rows north to south, NaN where missing
field.sample("u10", 48.85, 2.35); // bilinear value at a point
field.wind(48.85, 2.35); // { u, v, speed, direction }
field.direction("wave_dir", 38, 5); // a direction, blended as an angle (350° and 10° give 0°)
```

Pin `run` to a run id, not `"latest"`, when you animate: those responses are immutable and cache well. `stride` thins the grid (1 = 0.25°, 2 = 0.5°, 4 = 1°), and `bbox` crops it.

### Colours

`Palette` turns the API's legend for a variable into colours. They match the server's tiles exactly.

```ts
import { Palette } from "@similie/4shadow";

const { variables } = await fs.variables();
const palette = new Palette(variables.find((v) => v.id === "t2m")!.legend!);
palette.css(21.5); // "rgba(…)"
palette.ramp(256); // RGBA lookup texture for a shader
palette.gradient(); // CSS gradient for a legend
```

The [map lab](https://github.com/similie/4Shadow-js/tree/main/apps/map-lab) uses all of this to build animated weather maps: GPU colour layers, wind particles, isobars, a globe and time animation.

## Early warnings

An alert watches an area for conditions, such as a rain total, gusts or wave height, in every new forecast run (four a day). When the conditions are forecast within `lead_days`, the alert has events. Events show on your 4Shadow map, are listed by `alerts.events()`, and are sent to your webhook when they're forecast, when they change and when they're called off. Your plan sets how many alerts you can have.

```ts
const alert = await fs.alerts.create({
  name: "Heavy rain over Díli",
  area: { type: "Point", coordinates: [125.57, -8.56] }, // or a Polygon / MultiPolygon
  radius_km: 25,
  conditions: [{ variable: "precip", operator: ">=", threshold: 50, accumulate_hours: 24 }], // 50 mm in 24 h
  lead_days: 5,
  webhook_url: "https://example.org/hooks/4shadow",
  metadata: { station: "dili-01" },
});
const secret = alert.webhook!.secret!; // returned only now: store it

const { events } = await fs.alerts.events({ alert: alert.id }); // upcoming and ongoing
const geojson = await fs.alerts.eventsGeoJson(); // all your alerts' events, for a map source
```

`area_mode` sets how the area is read: `"any"` (anywhere in it, the default), `"mean"` (its average) or `"coverage"` (on at least `coverage_percent` of it). `alerts.preview()` checks a definition without saving it, and returns the area's values at every step for drawing. `update()`, `delete()`, `deliveries()`, `test()` and `rotateSecret()` do what they say. The alerts API takes the key only in the `api-key` header, so these calls always send it there. In a browser, keep the key on your server: create the client without a key and point `baseUrl` at a route of yours that adds it (the [map lab](https://github.com/similie/4Shadow-js/tree/main/apps/map-lab) does this).

Notifications follow [Standard Webhooks](https://www.standardwebhooks.com). Check them with `verifyWebhook()`, passing the body exactly as received:

```ts
import express from "express";
import { verifyWebhook, WebhookVerificationError } from "@similie/4shadow";

app.post("/hooks/4shadow", express.text({ type: "*/*" }), async (req, res) => {
  try {
    const hook = await verifyWebhook(process.env.ALERT_SECRET!, req.headers, req.body);
    if (hook.type === "alert.event.created") warn(hook.data.alert.name, hook.data.event!);
    res.sendStatus(204);
  } catch (err) {
    res.sendStatus(err instanceof WebhookVerificationError ? 400 : 500);
  }
});
```

| `type`                  | When                                                                                                                         |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `alert.event.created`   | A new event is forecast                                                                                                      |
| `alert.event.updated`   | It shifts by 3 hours or more, its peak changes by 10% or more, or it stops early; `data.previous` has the old times and peak |
| `alert.event.cancelled` | No longer forecast (`cancel_reason: "no_longer_forecast"`), or the alert's area or conditions changed (`"alert_changed"`)    |
| `alert.test`            | You called `alerts.test()`                                                                                                   |

Answer with a 2xx within 10 seconds. Otherwise the notification is retried after 1 minute, 5 minutes, 30 minutes, 2 hours and 6 hours. A retry has the same `webhook-id`, and each event has a `revision`: a higher revision replaces a lower one.

## API keys in browsers

By default (`keyIn: "auto"`), the client sends the key in the `api-key` header from servers and in the `?api-key=` query string from browsers (the alerts API always takes the header). The query string avoids a CORS preflight, and map libraries need it for tiles. A key used in a browser is visible to anyone who opens the page. For public sites, call the API from your own server, or use a key restricted to your domain once those are available.

## Errors

Failed requests throw `ForeshadowError`, which carries `status`, `url`, the API's `detail` message, and a `retryable` flag. `retryable` is true for network failures, 429 and 5xx responses.

## Data

- Forecasts: NOAA Global Forecast System (GFS). NOAA's data is public domain.
- Place names: GeoNames, CC BY 4.0.

## License

MIT
