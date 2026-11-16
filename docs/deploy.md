# Deploy the map

The map lab doubles as a weather map you can put on the internet: a SvelteKit app with a small Node server. In **public mode** anyone can view it, and your API key stays on your server.

```
visitor's browser ── /api/4shadow/v2/… ──▶ your map server ── + your api-key ──▶ api.4shadow.io
                                            │  only the map's reads, checked
                                            │  per-visitor and global limits
                                            └─ shared cache: each field and tile fetched once per run
```

## Before you start

- **A 4Shadow API key.** Get one free at [4shadow.io/signup](https://4shadow.io/signup). Everything the map loads counts against that key's plan, so choose a plan that fits your traffic; see [What it costs](#what-it-costs).
- **Docker**, or **Node 22.17+** to run it without containers.

## With Docker

From the root of this repository:

```sh
docker build -f apps/map-lab/Dockerfile -t 4shadow-map .
docker run -d --name 4shadow-map --restart unless-stopped \
  -p 3000:3000 \
  -e FORESHADOW_API_KEY=your-key \
  -e ORIGIN=https://map.example.com \
  4shadow-map
```

The image runs as a non-root user, has a health check, and holds nothing secret: the key is read when the server starts. It is about 300 MB.

With Compose:

```yaml
services:
  map:
    build:
      context: .
      dockerfile: apps/map-lab/Dockerfile
    restart: unless-stopped
    ports:
      - "127.0.0.1:3000:3000"
    environment:
      FORESHADOW_API_KEY: ${FORESHADOW_API_KEY}
      ORIGIN: https://map.example.com
      ADDRESS_HEADER: x-forwarded-for
      XFF_DEPTH: "1"
```

The image works on any container host (Fly.io, Railway, Render, Cloud Run, a VPS). Give it the settings below, and a health check on `/`.

## With Node

```sh
npm ci
npm run build:lab
cd apps/map-lab
MAP_MODE=public FORESHADOW_API_KEY=your-key PORT=3000 node build
```

Keep it running with systemd, pm2 or similar. The server needs `node_modules` and `packages/sdk/dist` next to it, so deploy the built repository, not only `apps/map-lab/build`.

## Settings

| Setting                       | Default                         | What it does                                                                                                                        |
| ----------------------------- | ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `FORESHADOW_API_KEY`          | (none)                          | Your key. Required: without it the map has no data.                                                                                 |
| `MAP_MODE`                    | `local` (`public` in the image) | `public` for a map on the internet. `local` is the full lab with early warnings, and answers only the machine it runs on.           |
| `CACHE_MB`                    | `256`                           | Memory for cached fields and tiles. More memory, fewer requests to 4Shadow.                                                         |
| `FORESHADOW_API_URL`          | `https://api.4shadow.io`        | The API to use.                                                                                                                     |
| `PORT`, `HOST`                | `3000`, `0.0.0.0`               | Where the server listens.                                                                                                           |
| `ORIGIN`                      | (from the request)              | The map's public address, such as `https://map.example.com`. Set it behind a proxy.                                                 |
| `ADDRESS_HEADER`, `XFF_DEPTH` | (none)                          | Behind a proxy, `x-forwarded-for` and the number of proxies, so the per-visitor limits see visitors' addresses and not the proxy's. |

`PORT`, `HOST`, `ORIGIN`, `ADDRESS_HEADER` and `XFF_DEPTH` are [SvelteKit's Node adapter settings](https://svelte.dev/docs/kit/adapter-node#Environment-variables).

## Behind a reverse proxy

Put HTTPS in front with any proxy. Caddy:

```
map.example.com {
  reverse_proxy 127.0.0.1:3000
}
```

nginx:

```nginx
server {
  server_name map.example.com;
  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

Then set `ADDRESS_HEADER=x-forwarded-for` and `XFF_DEPTH=1` (one proxy). Without them every visitor seems to come from the proxy, and they share one visitor's limits.

A CDN in front works too: fields and tiles are sent with `Cache-Control: public, max-age=31536000, immutable`, because a forecast run never changes once published.

## What public mode serves

| Request                             | Limit per visitor    | Notes                                                                                                                        |
| ----------------------------------- | -------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Runs and variables                  | 120 per 10 minutes   | Cached by browsers for a minute (runs) or an hour (variables).                                                               |
| Fields (gridded data)               | 3,000 per 10 minutes | Up to 4 variables; the whole globe at 0.5° or coarser, full 0.25° only for part of it. Cached on your server and compressed. |
| Map tiles                           | 3,000 per 10 minutes | Zoom 0 to 12. Cached on your server.                                                                                         |
| Point forecasts                     | 120 per 10 minutes   | Up to 16 days.                                                                                                               |
| Place search                        | 60 per minute        |                                                                                                                              |
| Early warnings, keys, anything else | refused              | Early warnings belong to your account, so a public map has none.                                                             |

All visitors together are limited to 20,000 requests per 10 minutes, a backstop for your quota. The limits are in `apps/map-lab/src/lib/server/public-map.ts`; change them there if your map needs different ones.

## What it costs

Fields and tiles never change within a forecast run, so your server fetches each one from 4Shadow **once per run** while it stays in the cache, however many people look at it. A new run arrives four times a day. Point forecasts and place searches are fetched for each visitor who asks.

So the requests on your key grow with the number of distinct views and clicks, not with every page view. Watch them on the Usage page of your [4Shadow console](https://4shadow.io/console), and raise `CACHE_MB` if the same fields are fetched again.

## Calling the API from the browser instead

The SDK and the map code also work with the browser calling `api.4shadow.io` directly, which is how you'd put a map into a site that has no server of its own. The key is then in the page, where anyone can read it, so:

1. In the [console](https://4shadow.io/console/keys), make a key for the site and add the site's address under **Allowed origins**. Requests from anywhere else are refused.
2. Use that key in the browser: `new ForeshadowClient({ apiKey })` from [`@similie/4shadow`](../packages/sdk), or, to try it in the lab, set `VITE_FORESHADOW_URL=https://api.4shadow.io` and `VITE_FORESHADOW_KEY` in `apps/map-lab/.env.local`.

Every visitor then fetches their own copy of each field, so this uses more of your plan than public mode, which caches on your server. Public mode is the recommended way to run this map.
