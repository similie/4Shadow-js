import { describe, expect, it } from "vitest";
import { compass, decodeField, windDirection } from "../src/index.js";
import { makeField } from "./helpers.js";

// 3 rows (10, 0, -10) x 4 columns (-180, -90, 0, 90): a 90° global grid that wraps.
const GLOBAL = { lat0: 10, dlat: 10, nlat: 3, lon0: -180, dlon: 90, nlon: 4, wraps: true };
const T = [0, 1, 2, 3, 10, 11, 12, 13, 20, 21, 22, NaN];

describe("decodeField", () => {
  it("reads the header and arrays", () => {
    const f = decodeField(makeField(GLOBAL, { t2m: T, u10: new Array(12).fill(3), v10: new Array(12).fill(4) }));
    expect(f.ids).toEqual(["t2m", "u10", "v10"]);
    expect(f.header.forecast_hour).toBe(6);
    expect(f.validTime.toISOString()).toBe("2026-11-13T06:00:00.000Z");
    expect(Array.from(f.values("t2m").slice(0, 8))).toEqual([0, 1, 2, 3, 10, 11, 12, 13]);
    expect(Number.isNaN(f.values("t2m")[11])).toBe(true);
    expect(f.raw("t2m")[1]).toBe(100);
    expect(f.range("t2m")).toEqual([0, 22]);
  });

  it("rejects other data", () => {
    expect(() => decodeField(new TextEncoder().encode("PNG....").buffer)).toThrow(/4SF1/);
    expect(() => decodeField(makeField(GLOBAL, { t2m: T }).slice(0, 40))).toThrow(/truncated/);
  });

  it("samples bilinearly, wraps at the antimeridian, and skips missing cells", () => {
    const f = decodeField(makeField(GLOBAL, { t2m: T }));
    expect(f.sample("t2m", 10, -180)).toBeCloseTo(0);
    expect(f.sample("t2m", 5, -135)).toBeCloseTo((0 + 1 + 10 + 11) / 4);
    expect(f.sample("t2m", 10, 135)).toBeCloseTo((3 + 0) / 2); // between the last column and the first
    expect(f.sample("t2m", 10, 180)).toBeCloseTo(0);
    expect(f.sample("t2m", -10, 90)).toBeNaN(); // exactly on the missing cell
    expect(f.sample("t2m", -10, 135)).toBeCloseTo(20); // halfway to it: the missing corner is skipped
    expect(f.sample("t2m", 20, 0)).toBeNaN(); // north of the field
    expect(f.latOf(2)).toBe(-10);
    expect(f.lonOf(3)).toBe(90);
  });

  it("does not wrap a regional field", () => {
    const f = decodeField(makeField({ lat0: 10, dlat: 10, nlat: 2, lon0: 100, dlon: 10, nlon: 2, wraps: false }, { t2m: [1, 2, 3, 4] }));
    expect(f.sample("t2m", 5, 105)).toBeCloseTo(2.5);
    expect(f.sample("t2m", 5, 120)).toBeNaN();
    expect(f.sample("t2m", 5, -255)).toBeCloseTo(2.5); // 105° written another way
  });

  it("blends directions as angles", () => {
    // Columns at -180/-90/0/90 hold 350°, 10°, 90°, missing (scale 0.1 so 350 fits in int16).
    const dirs = [350, 10, 90, NaN, 350, 10, 90, NaN, 350, 10, 90, NaN];
    const f = decodeField(makeField(GLOBAL, { wave_dir: dirs }, 0.1));
    const d = f.direction("wave_dir", 0, -135); // halfway between 350° and 10°
    expect(Math.min(d, 360 - d)).toBeLessThan(0.1);
    expect(f.sample("wave_dir", 0, -135)).toBeCloseTo(180); // what a plain blend would say
    expect(f.direction("wave_dir", 0, 90)).toBeNaN(); // on the missing column
    expect(f.direction("wave_dir", 0, 135)).toBeCloseTo(350); // halfway to the next column: missing skipped
  });

  it("gives wind speed and direction", () => {
    const f = decodeField(makeField(GLOBAL, { u10: new Array(12).fill(3), v10: new Array(12).fill(4) }));
    const w = f.wind(0, 0);
    expect(w.speed).toBeCloseTo(5);
    expect(w.direction).toBeCloseTo(216.87, 1); // blowing from the south-west
    expect(compass(w.direction)).toBe("SW");
    expect(windDirection(0, -5)).toBeCloseTo(0); // from the north
    expect(compass(359)).toBe("N");
  });
});
