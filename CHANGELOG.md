# Changelog

Notable changes to the map lab and the repository. The SDK's changes, by version, are in [packages/sdk/CHANGELOG.md](packages/sdk/CHANGELOG.md), which ships with the npm package.

## Unreleased

### Map lab

- **New layers** from the 4Shadow API's new variables: wind at 100 m (its particles move with the 100 m wind), radar reflectivity, low clouds, feels-like temperature, heat index, wet-bulb temperature, fire weather, dryness (VPD), freezing level and soil moisture.
- **Model switch**: every weather model the API serves and your key may call, found from `/v2/health`: GFS, NOAA's AI model AIGFS, and ECMWF's IFS and AIFS. The layer list shows only the chosen model's layers, and point forecasts follow the switch.
- **Air quality**: PM2.5, PM10, dust, smoke haze and haze from NOAA's GEFS-Aerosols, drawn over the chosen weather model's particles and isobars and blank outside the air-quality run's 5 days.
- The map's attribution names the forecast models in view, in ECMWF's own words for its data (CC BY 4.0).
- Fixed: wave particles stopped short of the coast along straight, stepped edges (the wave model's coarse coastline) and could cross onto land at capes. They now reach the basemap's coastline and stay on the water, like the wave colours: they use the same coastal fill, the full-resolution field when zoomed in, and the basemap's water as a mask.
- **Currents**: ocean surface currents with tides, from the 4Shadow API's new `ocean` model (Copernicus Marine), coloured by speed over the weather model, with particles that move the way the water flows (eight times its speed, so they visibly move) and stay on the sea. The readout says where the current flows to. Shown when the API serves `ocean` and your key may call it.
- **Coastlines** over the weather (on by default, with a Coastlines switch next to Isobars), so the coast stays visible under layers that colour land and sea alike. The line is traced from the basemap's own water at every zoom, on a flat map or a globe, white on the Night map and dark on the Day map.
- Rivers, docks and pools no longer count as open water: wave colours and particles no longer run up rivers, and only seas and lakes get a coastline. Rivers still show over the weather.
- Fixed: on the globe, seas weren't shaded over the weather, so land and sea took the same colour under layers like temperature. The shade is now drawn from the sea mask, flat or on a globe; as a fill layer on a globe it piled up into a dark disc over the North Pole, which is why it had been left off.
- Fixed: a ring around each pole on the globe. Isobars that circle a pole north of 85° were squashed onto the edge of MapLibre's tiles; they now stop at 85°.
- Fire weather and soil moisture are drawn on land only, clipped to the basemap's coastline.
- Fixed: the weather waited for the basemap. On a slow connection, or when OpenFreeMap was slow, the map stayed blank until every basemap tile in view had loaded, and if the basemap's tile index failed it never drew at all. The weather and early warnings are now drawn as soon as the map's style is read, and the basemap fills in when it arrives.
- Hovering a layer in the menu says what it shows.
- Point forecasts from another model use the API's per-model path, such as `/v2/aigfs/forecast`, which public mode forwards too, along with `/v2/health` (cached 60 s). On api.4shadow.io each model is on some plans; one your key can't call isn't offered.
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
