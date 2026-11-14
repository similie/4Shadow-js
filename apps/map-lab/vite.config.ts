import adapter from "@sveltejs/adapter-static";
import { sveltekit } from "@sveltejs/kit/vite";
import { defaultClientConditions, defaultServerConditions, defineConfig } from "vite";

export default defineConfig({
  plugins: [
    sveltekit({
      // A single-page app: no server rendering (MapLibre and WebGL need a browser).
      adapter: adapter({ fallback: "index.html" }),
    }),
  ],
  // "source" resolves the workspace SDK to its TypeScript, so SDK edits show up without a rebuild.
  resolve: { conditions: ["source", ...defaultClientConditions] },
  ssr: { resolve: { conditions: ["source", ...defaultServerConditions] } },
  // MapLibre's worker is an ES module (imported with ?worker&url in weather-map.ts).
  worker: { format: "es" },
  server: { port: 5173 },
});
