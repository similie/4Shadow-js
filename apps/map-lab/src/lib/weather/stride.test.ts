import { describe, expect, it } from "vitest";
import { DETAIL_MAX_CELLS, strideFor } from "./stride.ts";

const grid = (dlat: number) => ({ grid: { lat0: 90, dlat, nlat: 180 / dlat + 1, lon0: 0, dlon: dlat, nlon: 360 / dlat } });

describe("strides on each grid", () => {
  it("keeps the weather models' strides, and scales them on a finer grid", () => {
    expect(strideFor({}, 2)).toBe(2);
    expect(strideFor(grid(0.25), 4)).toBe(4);
    // 0.5° on the 0.1° satellite grid: every fifth cell, 720 x 361 like the weather at stride 2.
    expect(strideFor(grid(0.1), 2)).toBe(5);
    expect(strideFor(grid(0.1), 1)).toBe(3);
  });

  it("fetches a detail area as finely as its size allows", () => {
    expect(strideFor(grid(0.25), 1, [100, -20, 160, 20])).toBe(1);
    // 60° x 40° at 0.1° is 240,000 cells: within a quarter of the globe at 0.25°, so every cell.
    expect(strideFor(grid(0.1), 1, [100, -20, 160, 20])).toBe(1);
    // 120° x 70° is 840,000: every second cell. Across the antimeridian it's the same size.
    expect(strideFor(grid(0.1), 1, [60, -30, 180, 40])).toBe(2);
    expect(strideFor(grid(0.1), 1, [120, -30, -120, 40])).toBe(2);
    const [w, s, e, n] = [0, -40, 150, 40];
    const k = strideFor(grid(0.1), 1, [w, s, e, n]);
    expect((((e - w) / 0.1) * ((n - s) / 0.1)) / k ** 2).toBeLessThanOrEqual(DETAIL_MAX_CELLS);
  });
});
