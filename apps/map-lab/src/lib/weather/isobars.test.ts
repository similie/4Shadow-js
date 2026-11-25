import { describe, expect, it } from "vitest";
import { GLOBAL_1DEG, makeField } from "../../test/fields.ts";
import { isobars, pressureCentres } from "./isobars.ts";

/** 1013 hPa everywhere, with a deep low near Darwin and a high in the South Indian Ocean. */
function pressure() {
  const { nlat, nlon, lat0, dlat, lon0, dlon } = GLOBAL_1DEG;
  const values = new Float64Array(nlat * nlon);
  const bump = (lat: number, lon: number, la: number, lo: number, depth: number, r: number) =>
    depth * Math.exp(-((lat - la) ** 2 + (lon - lo) ** 2) / (2 * r * r));
  for (let i = 0; i < nlat; i++) {
    for (let j = 0; j < nlon; j++) {
      const lat = lat0 - i * dlat;
      const lon = lon0 + j * dlon;
      values[i * nlon + j] = 1013 + bump(lat, lon, -12, 131, -28, 4) + bump(lat, lon, -35, 80, 14, 7);
    }
  }
  return makeField(GLOBAL_1DEG, { mslp: values }, 0.1);
}

describe("isobars", () => {
  it("draws closed lines every 4 hPa around a low", () => {
    const lines = isobars(pressure());
    const levels = [...new Set(lines.features.map((f) => f.properties.hpa))].sort((a, b) => a - b);
    expect(levels[0]).toBe(988);
    expect(levels.every((l) => l % 4 === 0)).toBe(true);
    // The 1000 hPa line rings the low: every point of it is within a few degrees of the centre.
    const ring = lines.features.filter((f) => f.properties.hpa === 1000).flatMap((f) => f.geometry.coordinates);
    expect(ring.length).toBeGreaterThan(10);
    for (const [lon, lat] of ring) expect(Math.hypot(lon! - 131, lat! + 12)).toBeLessThan(8);
  });

  it("stops short of the poles, where MapLibre would squash the lines onto its edge", () => {
    // A low over the North Pole: its isobars circle the pole above 85°.
    const { nlat, nlon, lat0, dlat } = GLOBAL_1DEG;
    const values = new Float64Array(nlat * nlon);
    for (let i = 0; i < nlat; i++) values.fill(1013 - 20 * Math.exp(-((90 - (lat0 - i * dlat)) ** 2) / 50), i * nlon, (i + 1) * nlon);
    const lines = isobars(makeField(GLOBAL_1DEG, { mslp: values }, 0.1));
    const lats = lines.features.flatMap((f) => f.geometry.coordinates.map(([, lat]) => lat!));
    expect(lats.length).toBeGreaterThan(100);
    expect(Math.max(...lats)).toBeLessThanOrEqual(85);
  });

  it("finds the high and low centres", () => {
    const centres = pressureCentres(pressure()).features.map((f) => ({ ...f.properties, at: f.geometry.coordinates }));
    expect(centres).toContainEqual({ kind: "L", hpa: 985, at: [131, -12] });
    expect(centres).toContainEqual({ kind: "H", hpa: 1027, at: [80, -35] });
    expect(centres).toHaveLength(2);
  });
});
