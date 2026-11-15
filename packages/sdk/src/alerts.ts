import type { Model } from "./types.js";

// ----------------------------------------------------------------------------------- definitions

export type AlertOperator = ">" | ">=" | "<" | "<=";

/** One condition, e.g. `{ variable: "precip", operator: ">=", threshold: 50, accumulate_hours: 24 }`. */
export interface AlertCondition {
  /** A variable id from `variables()`, in its units (`t2m` °C, `gust` m/s, `precip` mm/h, ...). */
  variable: string;
  operator: AlertOperator;
  threshold: number;
  /** For a rate such as `precip` (mm/h): compare the total over this many hours instead (1-240). */
  accumulate_hours?: number | null;
}

/** A GeoJSON geometry, longitude first. */
export type AlertArea =
  | { type: "Point"; coordinates: [number, number] }
  | { type: "Polygon"; coordinates: number[][][] }
  | { type: "MultiPolygon"; coordinates: number[][][][] };

/** What an alert watches: an area, conditions, and how far ahead. */
export interface AlertDefinition {
  area: AlertArea;
  /** With a Point: check every grid cell within this distance (0-500 km, default 0). */
  radius_km?: number;
  /** 1 to 5 conditions. */
  conditions: AlertCondition[];
  /** "all" (default): every condition at once; "any": one is enough. */
  match?: "all" | "any";
  /** "any" (default): anywhere in the area; "mean": the area's average; "coverage": on coverage_percent of it. */
  area_mode?: "any" | "mean" | "coverage";
  /** 1-100, with area_mode "coverage". */
  coverage_percent?: number | null;
  /** Days ahead to look, up to 16 (default 3). */
  lead_days?: number;
  /** Ignore events shorter than this (default 0). */
  min_duration_hours?: number;
}

export type AlertMetadata = Record<string, string | number | boolean | null>;

export interface AlertInput extends AlertDefinition {
  name: string;
  description?: string | null;
  model?: Model;
  /** An https URL to notify. The response to `create()` has its secret, once. */
  webhook_url?: string | null;
  /**
   * Up to 10 addresses to mail. Each new one is asked to confirm first, and every alert mail can
   * unsubscribe it. Your account's email must be confirmed. `[]` or `null` stops mailing.
   */
  email_to?: string[] | null;
  /** Your own keys and values (up to 50, 4 KB), sent back with every notification. */
  metadata?: AlertMetadata;
  /** false saves the alert paused. */
  active?: boolean;
}

/** Fields to change; the rest keep their values. `webhook_url: null` removes the webhook. */
export type AlertUpdate = Partial<AlertInput>;

// ----------------------------------------------------------------------------------- responses

export interface Alert extends Required<Omit<AlertDefinition, "conditions">> {
  id: string;
  name: string;
  description: string | null;
  model: Model;
  conditions: (AlertCondition & { accumulate_hours: number | null })[];
  /** `secret` is only in the responses to `create()`, `rotateSecret()` and an update that adds a webhook. */
  webhook: { url: string; secret_hint: string; secret?: string } | null;
  /** The addresses this alert mails; only `confirmed` ones get mail. */
  email: { address: string; status: "confirmed" | "pending" | "unsubscribed" }[];
  metadata: AlertMetadata;
  active: boolean;
  evaluation: {
    /** The forecast run the alert was last checked against. */
    run: string | null;
    evaluated_at: string | null;
    /** A change is waiting to be checked. */
    pending: boolean;
    /** Why the forecast service couldn't check it, if it couldn't. */
    error: string | null;
  };
  created_at: string;
  updated_at: string;
}

export interface AlertList {
  alerts: Alert[];
  /** How many alerts your plan allows (-1: no limit). */
  limit: number;
}

export type AlertEventStatus = "upcoming" | "ongoing" | "ended" | "cancelled";
/** Which events to list: "active" (default) is upcoming or ongoing. */
export type AlertEventFilter = AlertEventStatus | "active" | "all";

export interface AlertPeak {
  time: string;
  variable: string;
  value: number | null;
  units: string;
  lat: number;
  lon: number;
  /** The share of the area meeting the conditions then. */
  coverage_percent: number | null;
}

export interface AlertEvent {
  id: string;
  alert_id: string;
  alert_name?: string;
  status: AlertEventStatus;
  start: string;
  end: string;
  duration_hours: number;
  /** The worst value: what, when and where. */
  peak: AlertPeak;
  max_coverage_percent: number | null;
  /** Each condition's peak. */
  conditions: { variable: string; units: string; peak: number | null; peak_time: string | null }[];
  first_run: string;
  last_run: string;
  /** Goes up with every change; a higher revision replaces a lower one. */
  revision: number;
  cancel_reason: "no_longer_forecast" | "alert_changed" | "alert_paused" | null;
  created_at: string;
  updated_at: string;
}

/** Events as GeoJSON for a map: each feature is the alert's area, with the event in its properties. */
export interface AlertEventCollection {
  type: "FeatureCollection";
  features: {
    type: "Feature";
    id: string;
    geometry: AlertArea;
    properties: AlertEvent & { radius_km: number };
  }[];
}

export type AlertWebhookType = "alert.event.created" | "alert.event.updated" | "alert.event.cancelled" | "alert.test";

export interface AlertDelivery {
  id: string;
  /** The `webhook-id` header, the same on every retry. */
  webhook_id: string;
  type: AlertWebhookType;
  event_id: string | null;
  url: string;
  status: "pending" | "sending" | "delivered" | "failed" | "cancelled";
  attempts: number;
  next_attempt_at: string | null;
  last_attempt_at: string | null;
  response_status: number | null;
  error: string | null;
  created_at: string;
}

export interface AlertTestResult {
  delivered: boolean;
  duration_ms: number;
  delivery: AlertDelivery;
}

/** What `preview()` returns: the forecast service's check of a definition on one run. */
export interface AlertPreview {
  model: Model;
  run: string;
  init_time: string;
  evaluated_at: string;
  window: { from: string; to: string } | null;
  area: {
    type: "point" | "radius" | "polygon" | (string & {});
    cells: number;
    area_km2: number | null;
    /** [west, south, east, north]. */
    bbox: [number, number, number, number];
    /** [lon, lat]. */
    center: [number, number];
    /** Sea variables on a coast: the nearest sea cell used instead. */
    sea_point?: { lat: number; lon: number; distance_km: number };
  };
  conditions: {
    variable: string;
    name: string;
    operator: AlertOperator;
    threshold: number;
    units: string;
    accumulate_hours: number | null;
    statistic: string;
  }[];
  match: "all" | "any";
  area_mode: "any" | "mean" | "coverage";
  events: {
    start: string;
    end: string;
    duration_hours: number;
    ongoing: boolean;
    peak: AlertPeak;
    max_coverage_percent: number | null;
    conditions: { variable: string; units: string; peak: number | null; peak_time: string | null }[];
  }[];
  /** Why an answer may be partial (a run that ends early, totals that start at the run's start, ...). */
  warnings: string[];
  /** The area's value for each condition at every step, for drawing the alert before saving it. */
  timeline?: { time: string; met: boolean; values: (number | null)[]; coverage_percent: number | null }[];
}

/** A notification your webhook receives (see `verifyWebhook()`). */
export interface AlertWebhook {
  type: AlertWebhookType;
  timestamp: string;
  data: {
    alert: { id: string; name: string; metadata: AlertMetadata };
    event?: AlertEvent;
    /** With alert.event.updated: the event before the change. */
    previous?: { start: string; end: string; peak: AlertPeak };
    /** With alert.test. */
    message?: string;
  };
}

// ----------------------------------------------------------------------------------- client

export interface AlertRequestOptions {
  signal?: AbortSignal;
}

export interface AlertEventsOptions extends AlertRequestOptions {
  /** Only this alert's events (default: all your alerts). */
  alert?: string;
  /** Default "active": upcoming or ongoing. */
  status?: AlertEventFilter;
  /** Up to 500 (default 100). */
  limit?: number;
}

/** How the client sends a request to the alerts API (paths relative to /v2/alerts). */
export type AlertSender = <T>(
  method: "GET" | "POST" | "PATCH" | "DELETE",
  path: string,
  init?: { body?: unknown; params?: Record<string, string | number | undefined>; signal?: AbortSignal },
) => Promise<T>;

const id = (alertId: string) => `/${encodeURIComponent(alertId)}`;

/**
 * Early warnings, as `client.alerts`. An alert watches an area for conditions (rain totals, gusts,
 * waves ...) in every new forecast run; when they're forecast it has events, which show on your
 * 4Shadow map, are listed here and are sent to your webhook (see `verifyWebhook()`).
 * Needs an API key, always sent in the `api-key` header. In a browser, leave the key out and point
 * `baseUrl` at a route of your own server that adds it.
 *
 * ```ts
 * const alert = await fs.alerts.create({
 *   name: "Heavy rain over Díli",
 *   area: { type: "Point", coordinates: [125.57, -8.56] }, radius_km: 25,
 *   conditions: [{ variable: "precip", operator: ">=", threshold: 50, accumulate_hours: 24 }],
 *   lead_days: 5,
 *   webhook_url: "https://example.org/hooks/4shadow",
 * });
 * saveSecret(alert.webhook!.secret!); // returned only now
 * const { events } = await fs.alerts.events({ alert: alert.id });
 * ```
 */
export class AlertsApi {
  readonly #send: AlertSender;

  constructor(send: AlertSender) {
    this.#send = send;
  }

  /** Your alerts, newest first, and how many your plan allows. */
  list(options: AlertRequestOptions = {}): Promise<AlertList> {
    return this.#send("GET", "", options);
  }

  get(alertId: string, options: AlertRequestOptions = {}): Promise<Alert> {
    return this.#send("GET", id(alertId), options);
  }

  /** Save an alert. It is checked against the latest run at once, so its events are there straight away. */
  create(input: AlertInput, options: AlertRequestOptions = {}): Promise<Alert> {
    return this.#send("POST", "", { body: input, signal: options.signal });
  }

  /**
   * Change an alert. A new area or conditions cancel its events (your webhook gets
   * alert.event.cancelled with cancel_reason "alert_changed") and the new ones follow.
   */
  update(alertId: string, changes: AlertUpdate, options: AlertRequestOptions = {}): Promise<Alert> {
    return this.#send("PATCH", id(alertId), { body: changes, signal: options.signal });
  }

  /** Delete an alert with its events and webhook log. Nothing is sent to the webhook. */
  delete(alertId: string, options: AlertRequestOptions = {}): Promise<{ deleted: string }> {
    return this.#send("DELETE", id(alertId), options);
  }

  /** What a definition would report now, without saving it, with the area's values at every step. */
  preview(
    definition: AlertDefinition & Partial<AlertInput> & { run?: string },
    options: AlertRequestOptions = {},
  ): Promise<AlertPreview> {
    return this.#send("POST", "/preview", { body: definition, signal: options.signal });
  }

  /** Events of all your alerts, or of one (`alert`). */
  events(options: AlertEventsOptions = {}): Promise<{ events: AlertEvent[] }> {
    const { alert, status, limit, signal } = options;
    return this.#send("GET", alert ? `${id(alert)}/events` : "/events", { params: { status, limit }, signal });
  }

  /** Events as a GeoJSON FeatureCollection, ready for a map source. */
  eventsGeoJson(options: AlertEventsOptions = {}): Promise<AlertEventCollection> {
    const { alert, status, limit, signal } = options;
    return this.#send("GET", alert ? `${id(alert)}/events` : "/events", {
      params: { status, limit, format: "geojson" },
      signal,
    });
  }

  /** The alert's webhook deliveries in the last 30 days, newest first. */
  deliveries(alertId: string, options: AlertRequestOptions & { limit?: number } = {}): Promise<{ deliveries: AlertDelivery[] }> {
    return this.#send("GET", `${id(alertId)}/deliveries`, { params: { limit: options.limit }, signal: options.signal });
  }

  /** Send an alert.test notification to the alert's webhook now, and see how it answered. */
  test(alertId: string, options: AlertRequestOptions = {}): Promise<AlertTestResult> {
    return this.#send("POST", `${id(alertId)}/test`, options);
  }

  /** A new webhook secret, in `webhook.secret` (only in this response). The old one stops working at once. */
  rotateSecret(alertId: string, options: AlertRequestOptions = {}): Promise<Alert> {
    return this.#send("POST", `${id(alertId)}/secret`, options);
  }
}
