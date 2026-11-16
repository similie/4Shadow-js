import { defaultClientConditions, defaultServerConditions } from "vite";
import { defineConfig } from "vitest/config";

// Unit tests for the lab's plain TypeScript (no browser, no WebGL). "source" resolves the workspace
// SDK to its TypeScript, as in vite.config.ts.
export default defineConfig({
  resolve: { conditions: ["source", ...defaultClientConditions] },
  ssr: { resolve: { conditions: ["source", ...defaultServerConditions] } },
  test: { include: ["src/**/*.test.ts"], environment: "node" },
});
