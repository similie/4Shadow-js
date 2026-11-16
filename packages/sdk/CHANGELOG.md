# Changelog: @similie/4shadow

This package follows [semantic versioning](https://semver.org). Until 1.0, a minor version may change the API; a patch never does.

## Unreleased

## 0.1.0

First release.

- **Point forecasts** for any place on Earth: `forecast()` by coordinates or by place name ("Paris, France"), with current conditions, hourly timeseries, daily summaries in the place's own time zone (`dailyRows()`, `timeseriesRows()`), and sea state at sea (wave height, period and direction, wind waves and swell).
- **Places**: `searchPlaces()` by name and `nearestPlaces()` to a point, from GeoNames.
- **Maps**: `tileUrl()` for MapLibre, Leaflet or OpenLayers; `field()` for raw gridded fields (the compact `4SF1` format, decoded), with `sample()` for the value at a point, `windDirection()`, `compass()`, and `Palette` for the API's own legend colours.
- **Runs and variables**: `runs()`, `run()`, `variables()`.
- **Early warnings**: `AlertsApi` creates, previews, lists, updates and deletes alerts on areas (a point and radius, or a polygon) with conditions such as rain over 24 hours; lists events (also as GeoJSON) and webhook deliveries; sends test webhooks; rotates secrets; emails up to 10 confirmed addresses (`email_to`).
- **Webhooks**: `verifyWebhook()` checks a delivery's HMAC-SHA256 signature and refuses old ones.
- **Errors**: `ForeshadowError` with the HTTP status, the API's `detail`, its `code` (`quota_exceeded`, `rate_limited`) and `resetsAt`, and `retryable` to tell whether trying later may help.
- Typed, ESM, no dependencies. Node 22+, browsers, Deno and Bun.
