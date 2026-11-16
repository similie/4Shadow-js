# 4Shadow-js

JavaScript tools for the [4Shadow](https://4shadow.io) weather forecast API, by [Similie](https://similie.com).

|                                |                                                                                                                                                                                                  |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [`packages/sdk`](packages/sdk) | `@similie/4shadow`: the API client. Point forecasts by coordinates or place name, place search, map tiles, and raw gridded fields for WebGL maps. Typed, dependency-free, for Node and browsers. |
| [`apps/map-lab`](apps/map-lab) | A local SvelteKit app for developing maps on the SDK: GPU colour layers, wind particles, isobars, a globe, time animation, point forecasts.                                                      |

## Develop

Node 20 or newer.

```sh
npm install
npm test           # SDK unit tests
npm run typecheck  # every workspace
npm run build      # SDK → packages/sdk/dist
npm run lab        # map lab on http://localhost:5181 (needs a 4Shadow API; see its README)
```

To run the SDK tests against a real server: `FORESHADOW_TEST_URL=http://localhost:5003 npm test`.

## Data

Forecasts come from NOAA's Global Forecast System (public domain). Place names come from GeoNames (CC BY 4.0).

## License

MIT. See [LICENSE](LICENSE).
