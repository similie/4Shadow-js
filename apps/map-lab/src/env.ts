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
  WEBHOOK_URL: {
    description:
      "The public https address of this lab's webhook receiver, ending in /hooks/4shadow. `npm run tunnel` makes one for you; set this to use your own.",
    schema: optional,
  },
});
