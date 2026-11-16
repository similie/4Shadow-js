# Changelog

Notable changes to the map lab and the repository. The SDK's changes, by version, are in [packages/sdk/CHANGELOG.md](packages/sdk/CHANGELOG.md), which ships with the npm package.

## Unreleased

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
