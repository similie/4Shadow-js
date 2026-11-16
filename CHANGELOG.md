# Changelog

Notable changes to the SDK (`@similie/4shadow`) and the map lab. The SDK follows [semantic versioning](https://semver.org); until 1.0, a minor version may change the API.

## Unreleased

### SDK

- Alerts can email up to 10 addresses (`email_to`), and each alert lists its email recipients and whether they've confirmed.
- Reads the API's error codes: `quota_exceeded` and `rate_limited` errors carry a `code`, and a used-up quota isn't retried.
- Needs Node 22 or newer (Node 20 reached end of life in April 2026).

### Map lab

- **Public mode** (`MAP_MODE=public`): deploy the map for anyone to view. Your key stays on the server, which forwards only the map's own reads, with per-visitor and global limits and a shared cache; early warnings are off.
- **Docker image** for public mode, and a deploy guide ([docs/deploy.md](docs/deploy.md)).
- **Day map**: a light basemap palette, next to the dark one.
- **Early warnings**: draw an area, set conditions, preview them against the latest forecast, and watch the signed webhooks arrive through a local tunnel.
- The 4Shadow wordmark and favicon.
- Unit tests for the lab, and CI for formatting, types, tests on Node 22, 24 and 26, builds and the Docker image.
- Fixed: pressure legend ticks read "1k"; H/L markers showed twice while time moved between steps; meteogram day labels overlapped on long forecasts; side panels covered the legend.

## 0.1.0 (not yet published)

First version of the SDK: point forecasts by coordinates or place name, place search, map tiles, raw gridded fields (`4SF1`) with decoding and colour palettes, early-warning alerts and webhook verification. First version of the map lab: GPU colour layers for 16 variables, wind and wave particles, isobars and H/L centres, a globe, smooth time, point forecasts with a meteogram, place search.
