/** The rig's state for the page: is a key set, where webhooks can be sent, which alerts it can verify. */
import { json, type RequestHandler } from "@sveltejs/kit";
import { FORESHADOW_API_KEY, FORESHADOW_API_URL } from "$app/env/private";
import type { RigStatus } from "#lib/alerts/types.ts";
import { knownAlerts, webhookUrl } from "#lib/server/rig.ts";

export const GET: RequestHandler = () =>
  json({
    apiUrl: FORESHADOW_API_URL,
    keyConfigured: !!FORESHADOW_API_KEY,
    webhookUrl: webhookUrl(),
    secrets: knownAlerts(),
  } satisfies RigStatus);
