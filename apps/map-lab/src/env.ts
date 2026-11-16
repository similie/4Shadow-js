import { defineEnvVars } from "@sveltejs/kit/env";

const optional = (value: string | undefined) => value?.trim() || undefined;

/** The lab server's settings, from `.env.local` (git-ignored) or the environment. */
export const variables = defineEnvVars({
  FORESHADOW_API_KEY: {
    description: "Your 4Shadow API key. Only the lab's server sees it: the page's API calls go to /api/4shadow, which adds it.",
    schema: optional,
  },
  FORESHADOW_API_URL: {
    description: "The 4Shadow API that /api/4shadow forwards to.",
    schema: (value) => (optional(value) ?? "https://api.4shadow.io").replace(/\/+$/, ""),
  },
  MAP_MODE: {
    description:
      "local (default): the lab answers only this machine, plus webhook deliveries through a tunnel. public: anyone may view the map; the API door serves only what the map draws, with limits and a shared cache, and early warnings are off.",
    schema: (value): "local" | "public" => {
      const v = optional(value)?.toLowerCase() ?? "local";
      if (v !== "local" && v !== "public") throw new Error("MAP_MODE must be local or public");
      return v;
    },
  },
  CACHE_MB: {
    description: "Public mode: memory for cached fields and tiles, in MB (default 256).",
    schema: (value) => {
      const n = Number(optional(value) ?? 256);
      if (!Number.isFinite(n) || n < 16) throw new Error("CACHE_MB must be a number of MB, at least 16");
      return n;
    },
  },
  WEBHOOK_URL: {
    description:
      "The public https address of this lab's webhook receiver, ending in /hooks/4shadow. `npm run tunnel` makes one for you; set this to use your own.",
    schema: optional,
  },
});
