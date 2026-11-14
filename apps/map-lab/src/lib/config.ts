import { ForeshadowClient } from "@similie/4shadow";

/**
 * The lab's own server forwards API calls and adds your key (src/routes/api/4shadow), so the page's
 * clients have no key and the key never reaches the browser.
 */
export const PROXY_URL = `${globalThis.location?.origin ?? "http://localhost:5181"}/api/4shadow`;

/** Forecast data: through the proxy, or straight from the API in VITE_FORESHADOW_URL (a local one needs no key). */
export const API_URL = (import.meta.env.VITE_FORESHADOW_URL || PROXY_URL).replace(/\/+$/, "");
export const DIRECT = API_URL !== PROXY_URL;

export const client = new ForeshadowClient({ baseUrl: API_URL, apiKey: import.meta.env.VITE_FORESHADOW_KEY || undefined });

/** Early warnings belong to your account, so they always go through the proxy. */
export const alertsClient = DIRECT ? new ForeshadowClient({ baseUrl: PROXY_URL }) : client;
