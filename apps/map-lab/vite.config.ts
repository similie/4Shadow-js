import adapter from "@sveltejs/adapter-node";
import { sveltekit } from "@sveltejs/kit/vite";
import { defaultClientConditions, defaultServerConditions, defineConfig, type Connect, type Plugin } from "vite";
import { allowed } from "./src/lib/server/local-only.ts";

/** Ahead of Vite's own file serving: through a tunnel, only webhook deliveries get in. */
function localOnly(): Plugin {
  const guard: Connect.NextHandleFunction = (req, res, next) => {
    if (allowed(req.method ?? "GET", (req.url ?? "/").split("?")[0]!, req.headers.host, req.headers)) return next();
    res.statusCode = 404;
    res.end("Not found");
  };
  return {
    name: "map-lab:local-only",
    configureServer: (server) => void server.middlewares.use(guard),
    configurePreviewServer: (server) => void server.middlewares.use(guard),
  };
}

export default defineConfig({
  plugins: [
    localOnly(),
    sveltekit({
      // The page renders in the browser only (MapLibre and WebGL; see +layout.ts). The server holds
      // your API key: it forwards the page's API calls (src/routes/api/4shadow) and receives
      // early-warning webhooks (src/routes/hooks). `npm run build && npm start` runs it with Node.
      adapter: adapter(),
    }),
  ],
  // "source" resolves the workspace SDK to its TypeScript, so SDK edits show up without a rebuild.
  resolve: { conditions: ["source", ...defaultClientConditions] },
  ssr: { resolve: { conditions: ["source", ...defaultServerConditions] } },
  // MapLibre's worker is an ES module (imported with ?worker&url in weather-map.ts).
  worker: { format: "es" },
  server: {
    port: 5173,
    // Webhooks reach the dev server through a tunnel (npm run tunnel). Only POST /hooks/4shadow is
    // served to those hosts; src/hooks.server.ts turns everything else away.
    allowedHosts: [".trycloudflare.com", ".ngrok-free.app", ".ngrok.app"],
  },
});
