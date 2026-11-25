import { compass } from "@similie/4shadow";

/** "Fri 13 Nov, 14:00" in a time zone (default the browser's). */
export function formatTime(ms: number, timeZone?: string): string {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone,
  }).format(ms);
}

export function formatHour(ms: number, timeZone?: string): string {
  return new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone }).format(ms);
}

export function formatDay(ms: number, timeZone?: string): string {
  return new Intl.DateTimeFormat(undefined, { weekday: "short", day: "numeric", timeZone }).format(ms);
}

/** "HH:00 UTC" */
export function formatUtc(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")} UTC`;
}

export function formatValue(v: number | null | undefined, decimals = 1): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "–";
  return v.toFixed(decimals);
}

export function formatWind(speed: number, direction: number): string {
  return `${speed.toFixed(1)} m/s ${compass(direction)}`;
}

/** A current's speed and where it flows to, e.g. "0.62 m/s to NE" (wind says where it comes from). */
export function formatCurrent(speed: number, heading: number): string {
  return `${speed.toFixed(2)} m/s to ${compass(heading)}`;
}

/** Where waves come from and how often they arrive, e.g. "from WSW · 9 s". */
export function formatWave(direction: number, period: number): string {
  return `from ${compass(direction)} · ${period.toFixed(0)} s`;
}

export function formatCoords(lat: number, lon: number): string {
  const ns = lat >= 0 ? "N" : "S";
  const ew = lon >= 0 ? "E" : "W";
  return `${Math.abs(lat).toFixed(2)}°${ns} ${Math.abs(lon).toFixed(2)}°${ew}`;
}

/** Local day key (YYYY-MM-DD) of a time in a zone. */
export function dayKey(ms: number, timeZone?: string): string {
  return new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone }).format(ms);
}
