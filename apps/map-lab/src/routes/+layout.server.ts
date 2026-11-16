import { MAP_MODE } from "$app/env/private";

/** The page needs to know whether it is a public map (no early warnings) or your local lab. */
export const load = () => ({ mode: MAP_MODE });
