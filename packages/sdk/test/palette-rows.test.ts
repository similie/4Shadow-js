import { describe, expect, it } from "vitest";
import { Palette, dailyRows, series, timeseriesRows, type Forecast } from "../src/index.js";

describe("Palette", () => {
  const p = new Palette({
    stops: [{ value: 0, color: "#000000ff" }, { value: 10, color: "#ff000080" }],
    transparent_below: 1,
    transparent_above: null,
  });
  it("interpolates colours and honours transparency", () => {
    expect(p.color(5)).toEqual([128, 0, 0, 192]);
    expect(p.color(0.5)[3]).toBe(0); // below transparent_below
    expect(p.color(20)).toEqual([255, 0, 0, 128]); // clamps
    expect(p.color(NaN)[3]).toBe(0);
    expect(p.css(10)).toBe("rgba(255, 0, 0, 0.502)");
  });
  it("builds a ramp for WebGL", () => {
    const r = p.ramp(11);
    expect(r.length).toBe(44);
    expect(Array.from(r.slice(40, 44))).toEqual([255, 0, 0, 128]);
  });
});

describe("rows", () => {
  const fc = {
    timeseries: { time: ["2026-11-13T00:00Z", "2026-11-13T01:00Z"], interval_hours: [0, 1], t2m: [20, 21.5], precip: [null, 0.4] },
    daily: { date: ["2026-11-13"], hours_covered: [21], t2m_max: [28.3] },
  } as unknown as Forecast;
  it("zips columns into rows", () => {
    const rows = timeseriesRows(fc);
    expect(rows[1]).toEqual({ time: new Date("2026-11-13T01:00Z"), intervalHours: 1, t2m: 21.5, precip: 0.4 });
    expect(rows[0]!.precip).toBeNull();
    expect(dailyRows(fc)).toEqual([{ date: "2026-11-13", hoursCovered: 21, t2m_max: 28.3 }]);
    expect(series(fc, "t2m")).toEqual([20, 21.5]);
    expect(() => series(fc, "nope")).toThrow();
  });
});
