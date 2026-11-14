import type { Forecast } from "./types.js";

/** One time step of a forecast: the valid time plus each variable's value. */
export type ForecastRow = { time: Date; intervalHours: number } & Record<string, number | null | Date>;

/** One local day of a forecast: the date (YYYY-MM-DD), hours covered, and each daily summary. */
export type DailyRow = { date: string; hoursCovered: number } & Record<string, number | null | string>;

/** A variable's time series as numbers (null where missing). */
export function series(forecast: Forecast, variable: string): Array<number | null> {
  const s = forecast.timeseries[variable];
  if (!s || variable === "time") throw new Error(`Forecast has no series ${variable}`);
  return s as Array<number | null>;
}

/** The columnar timeseries as one object per time step. */
export function timeseriesRows(forecast: Forecast): ForecastRow[] {
  const ts = forecast.timeseries;
  const vars = Object.keys(ts).filter((k) => k !== "time" && k !== "interval_hours");
  return ts.time.map((t, i) => {
    const row: ForecastRow = { time: new Date(t), intervalHours: ts.interval_hours[i]! } as ForecastRow;
    for (const v of vars) row[v] = (ts[v] as Array<number | null>)[i] ?? null;
    return row;
  });
}

/** The daily summaries as one object per local day (empty when the forecast has none). */
export function dailyRows(forecast: Forecast): DailyRow[] {
  const d = forecast.daily;
  if (!d) return [];
  const keys = Object.keys(d).filter((k) => k !== "date" && k !== "hours_covered");
  return d.date.map((date, i) => {
    const row: DailyRow = { date, hoursCovered: d.hours_covered[i]! } as DailyRow;
    for (const k of keys) row[k] = (d[k] as Array<number | null>)[i] ?? null;
    return row;
  });
}
