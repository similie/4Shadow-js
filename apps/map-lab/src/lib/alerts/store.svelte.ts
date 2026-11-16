import { ForeshadowError, type Alert, type AlertEvent, type AlertEventCollection } from "@similie/4shadow";
import { alertsClient } from "#lib/config.ts";
import type { Received, RigStatus } from "./types.ts";

/** An error as a sentence: the API's own explanation when it gave one. */
export function problem(e: unknown): string {
  if (e instanceof ForeshadowError) return e.detail || e.message;
  return (e as Error)?.message ?? String(e);
}

/**
 * Your alerts, their events, the rig's state and the webhooks it receives, shared by the panel, the
 * map and the timeline. Refreshed every minute, and when a webhook says something changed.
 */
export class AlertsStore {
  alerts = $state.raw<Alert[]>([]);
  /** How many alerts your plan allows (-1: no limit). */
  limit = $state(0);
  /** Upcoming and ongoing events of all your alerts. */
  events = $state.raw<AlertEventCollection | null>(null);
  rig = $state.raw<RigStatus | null>(null);
  /** Webhooks the lab's receiver got, newest first. */
  received = $state.raw<Received[]>([]);
  error = $state<string | null>(null);
  loaded = $state(false);

  private feed: EventSource | null = null;
  private timer: ReturnType<typeof setInterval> | undefined;
  private soon: ReturnType<typeof setTimeout> | undefined;

  async refresh(): Promise<void> {
    try {
      const rig = await fetch("/api/rig").then((r) => r.json() as Promise<RigStatus>);
      this.rig = rig;
      if (!rig.keyConfigured) {
        this.error = null;
        return;
      }
      const [list, events] = await Promise.all([alertsClient.alerts.list(), alertsClient.alerts.eventsGeoJson()]);
      this.alerts = list.alerts;
      this.limit = list.limit;
      this.events = events;
      this.error = null;
    } catch (e) {
      this.error = problem(e);
    } finally {
      this.loaded = true;
    }
  }

  /** Coalesce bursts (several webhooks for one run arrive together). */
  refreshSoon(delayMs = 1500): void {
    clearTimeout(this.soon);
    this.soon = setTimeout(() => this.refresh(), delayMs);
  }

  start(): void {
    this.refresh();
    this.feed = new EventSource("/api/rig/feed");
    const seen = new Set<string>();
    this.feed.onmessage = (m) => {
      const r = JSON.parse(m.data) as Received;
      const key = `${r.receivedAt}|${r.webhookId}`;
      if (seen.has(key)) return; // the feed replays recent ones on reconnect
      seen.add(key);
      this.received = [r, ...this.received].slice(0, 200);
      if (r.verified && r.webhook?.type !== "alert.test" && this.loaded) this.refreshSoon();
    };
    this.timer = setInterval(() => document.visibilityState === "visible" && this.refresh(), 60_000);
  }

  stop(): void {
    this.feed?.close();
    clearInterval(this.timer);
    clearTimeout(this.soon);
  }

  get(id: string | null): Alert | undefined {
    return id ? this.alerts.find((a) => a.id === id) : undefined;
  }

  eventsOf(id: string): AlertEvent[] {
    return (this.events?.features ?? []).filter((f) => f.properties.alert_id === id).map((f) => f.properties);
  }

  /** Replace one alert after a change, without waiting for a refresh. */
  put(alert: Alert): void {
    const i = this.alerts.findIndex((a) => a.id === alert.id);
    this.alerts = i < 0 ? [alert, ...this.alerts] : this.alerts.with(i, alert);
  }
}
