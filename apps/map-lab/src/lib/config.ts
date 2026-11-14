import { ForeshadowClient } from "@similie/4shadow";

/** The API this lab talks to (VITE_FORESHADOW_URL, default a local server on port 5003). */
export const API_URL = (import.meta.env.VITE_FORESHADOW_URL || "http://localhost:5003").replace(/\/+$/, "");
const API_KEY = import.meta.env.VITE_FORESHADOW_KEY || undefined;

export const client = new ForeshadowClient({ baseUrl: API_URL, apiKey: API_KEY });
