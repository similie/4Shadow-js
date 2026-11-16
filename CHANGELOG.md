# Changelog

Notable changes to the map lab and the repository. The SDK's changes, by version, are in [packages/sdk/CHANGELOG.md](packages/sdk/CHANGELOG.md), which ships with the npm package.

## Unreleased

### Map lab

- **New layers** from the 4Shadow API's new variables: wind at 100 m (its particles move with the 100 m wind), radar reflectivity, low clouds, feels-like temperature, heat index, wet-bulb temperature, fire weather, dryness (VPD), freezing level and soil moisture.
- **Model switch**: GFS or AIGFS, NOAA's AI model, when the API serves it. The layer list shows only the chosen model's layers, and point forecasts follow the switch.
- Fire weather and soil moisture are drawn on land only, clipped to the basemap's coastline.
- Hovering a layer in the menu says what it shows.
- The layer list follows the selected run too: a run made before a variable was added doesn't offer its layer. If the selected layer drops out on a run or model change, the map falls back to wind.

## 2026-11-16

### Map lab

- **Public mode** (`MAP_MODE=public`): deploy the map for anyone to view. Your key stays on the server, which forwards only the map's own reads, with per-visitor and global limits and a shared cache; early warnings are off.
- **Docker image** for public mode, and a deploy guide ([docs/deploy.md](docs/deploy.md)).
- **Day map**: a light basemap palette, next to the dark one.
- **Early warnings**: draw an area, set conditions, preview them against the latest forecast, and watch the signed webhooks arrive through a local tunnel.
- The 4Shadow wordmark and favicon.
- Unit tests for the lab, and CI for formatting, types, tests on Node 22, 24 and 26, builds and the Docker image.
- Fixed: pressure legend ticks read "1k"; H/L markers showed twice while time moved between steps; meteogram day labels overlapped on long forecasts; side panels covered the legend.

## 2026-11-14

### Map lab

- First version: GPU colour layers for 16 variables, wind and wave particles, isobars and H/L centres, a globe, smooth time, point forecasts with a meteogram, place search.
