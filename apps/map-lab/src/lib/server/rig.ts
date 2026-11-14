/**
 * The lab's webhook test rig, on the server: the alerts' webhook secrets (so deliveries can be
 * verified), the webhooks received, and the public address they can be sent to.
 *
 * Secrets and the tunnel's address are kept in `.rig/` (git-ignored). The feed lives in memory.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Received } from "#lib/alerts/types.ts";
import { WEBHOOK_URL } from "$app/env/private";
import { WEBHOOK_PATH } from "./local-only.ts";

export type { Received };

const DIR = join(process.cwd(), ".rig");
const SECRETS = join(DIR, "secrets.json");
/** Written by `npm run tunnel` while it runs. */
const TUNNEL = join(DIR, "tunnel-url");

// ------------------------------------------------------------------------------------- secrets

function readSecrets(): Record<string, string> {
  try {
    return JSON.parse(readFileSync(SECRETS, "utf8"));
  } catch {
    return {};
  }
}

function writeSecrets(secrets: Record<string, string>): void {
  mkdirSync(DIR, { recursive: true, mode: 0o700 });
  writeFileSync(SECRETS, JSON.stringify(secrets, null, 2) + "\n", { mode: 0o600 });
}

/** The API shows an alert's secret once (create, rotate, adding a webhook). Keep it to verify deliveries. */
export function rememberSecret(alertId: string, secret: string): void {
  writeSecrets({ ...readSecrets(), [alertId]: secret });
}

export function forgetSecret(alertId: string): void {
  const { [alertId]: _, ...rest } = readSecrets();
  writeSecrets(rest);
}

export function secretFor(alertId: string): string | undefined {
  return readSecrets()[alertId];
}

/** Alerts whose deliveries this lab can verify. */
export function knownAlerts(): string[] {
  return Object.keys(readSecrets());
}

// ------------------------------------------------------------------------------------- address

/** Where 4Shadow can reach this lab's receiver: WEBHOOK_URL, else the running tunnel, else nowhere. */
export function webhookUrl(): string | null {
  if (WEBHOOK_URL) return WEBHOOK_URL;
  try {
    const base = readFileSync(TUNNEL, "utf8").trim().replace(/\/+$/, "");
    return base ? base + WEBHOOK_PATH : null;
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------------------------- feed

type Feed = { items: Received[]; seen: Set<string>; listeners: Set<(r: Received) => void> };
// On globalThis so a dev reload of this module keeps the feed and its listeners.
const store = globalThis as typeof globalThis & { __mapLabFeed?: Feed };
const feed = (store.__mapLabFeed ??= { items: [], seen: new Set(), listeners: new Set() });

export function record(r: Omit<Received, "receivedAt" | "duplicate">): Received {
  const entry: Received = {
    ...r,
    receivedAt: new Date().toISOString(),
    duplicate: r.verified && feed.seen.has(r.webhookId),
  };
  if (r.verified) feed.seen.add(r.webhookId);
  feed.items.unshift(entry);
  feed.items.length = Math.min(feed.items.length, 200);
  for (const listener of feed.listeners) listener(entry);
  return entry;
}

/** Newest first. */
export function recent(): Received[] {
  return feed.items;
}

export function subscribe(listener: (r: Received) => void): () => void {
  feed.listeners.add(listener);
  return () => feed.listeners.delete(listener);
}
