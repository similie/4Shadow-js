import { describe, expect, it } from "vitest";
import { makeField } from "../../test/fields.ts";
import { waveFlow } from "./wave-flow.ts";

const GRID = { lat0: 0, dlat: 1, nlat: 1, lon0: 0, dlon: 1, nlon: 4, wraps: false };

describe("wave motion", () => {
  it("moves waves away from where they come from, at the deep-water group speed", () => {
    // From the north, east, south and west; 10 s waves, so about 7.8 m/s.
    const f = makeField(GRID, { wave_dir: [0, 90, 180, 270], wave_period: [10, 10, 10, 10] });
    const flow = waveFlow(f, "wave_dir", "wave_period");
    const u = Array.from(flow.values("u"));
    const v = Array.from(flow.values("v"));
    const speed = (9.81 / (4 * Math.PI)) * 10;
    expect(v[0]).toBeCloseTo(-speed, 1); // from the north: heading south
    expect(u[1]).toBeCloseTo(-speed, 1); // from the east: heading west
    expect(v[2]).toBeCloseTo(speed, 1);
    expect(u[3]).toBeCloseTo(speed, 1);
  });

  it("keeps land missing, and computes each field once", () => {
    const f = makeField(GRID, { wave_dir: [NaN, 0, 0, 0], wave_period: [8, NaN, 8, 8] });
    const flow = waveFlow(f, "wave_dir", "wave_period");
    expect(Number.isNaN(flow.values("u")[0]!)).toBe(true);
    expect(Number.isNaN(flow.values("v")[1]!)).toBe(true);
    expect(waveFlow(f, "wave_dir", "wave_period")).toBe(flow);
  });
});
