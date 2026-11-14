import type { AlertWebhook } from "@similie/4shadow";

/** The webhook rig's state (GET /api/rig). */
export interface RigStatus {
  apiUrl: string;
  keyConfigured: boolean;
  /** The receiver's public address, or null when 4Shadow can't reach this lab. */
  webhookUrl: string | null;
  /** Alerts whose webhook secret the lab holds, so it can verify their deliveries. */
  secrets: string[];
}

/** A webhook request as the lab's receiver saw it (GET /api/rig/feed). Only verified ones carry the notification. */
export interface Received {
  /** The webhook-id header: the same on every retry of one notification. */
  webhookId: string;
  receivedAt: string;
  verified: boolean;
  /** Seen before: 4Shadow retried it (an earlier answer wasn't a 2xx in time). */
  duplicate: boolean;
  alertId: string | null;
  webhook?: AlertWebhook;
  /** Why it was turned away. */
  error?: string;
}
