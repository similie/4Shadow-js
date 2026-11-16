import type { AlertArea, VariableInfo } from "@similie/4shadow";
import { describe, expect, it } from "vitest";
import { alertVariables, areaText, bounds, canAccumulate, centre, circle, conditionText, definitionText } from "./geo.ts";

const v = (id: string, name: string, units: string, semantics: VariableInfo["semantics"] = "instant"): VariableInfo => ({
  id,
  name,
  units,
  semantics,
  description: "",
  tileable: true,
});
const VARS = [v("precip", "Precipitation", "mm/h", "interval_mean"), v("gust", "Wind gust", "m/s"), v("wind_dir", "Wind direction", "°")];

/** Great-circle distance in km. */
function km([lon1, lat1]: number[], [lon2, lat2]: number[]): number {
  const r = Math.PI / 180;
  const a = Math.sin(((lat2! - lat1!) * r) / 2) ** 2 + Math.cos(lat1! * r) * Math.cos(lat2! * r) * Math.sin(((lon2! - lon1!) * r) / 2) ** 2;
  return 2 * 6371.0088 * Math.asin(Math.sqrt(a));
}

describe("alert areas", () => {
  it("draws a circle whose every point is the radius away from the centre", () => {
    const ring = circle(125.56, -8.55, 50).coordinates[0]!;
    expect(ring).toHaveLength(73);
    expect(ring[0]).toEqual(ring[72]);
    for (const p of ring) expect(km(p, [125.56, -8.55])).toBeCloseTo(50, 6);
  });

  it("keeps circles near the antimeridian on the map's longitudes", () => {
    for (const [lon] of circle(179.9, -17, 100).coordinates[0]!) expect(Math.abs(lon!)).toBeLessThanOrEqual(180);
  });

  it("measures bounds and centres", () => {
    const box: AlertArea = {
      type: "Polygon",
      coordinates: [
        [
          [124, -9.5],
          [127.5, -9.5],
          [127.5, -8],
          [124, -8],
          [124, -9.5],
        ],
      ],
    };
    expect(bounds(box)).toEqual([124, -9.5, 127.5, -8]);
    expect(centre(box)).toEqual([125.75, -8.75]);
    const [w, s, e, n] = bounds({ type: "Point", coordinates: [10, 0] }, 111.2);
    expect([w, s, e, n].map((x) => Math.round(x))).toEqual([9, -1, 11, 1]);
  });

  it("describes areas in words", () => {
    expect(areaText({ type: "Point", coordinates: [125.56, -8.55] })).toBe("the point 8.55°S 125.56°E");
    expect(areaText({ type: "Point", coordinates: [-0.12, 51.5] }, 25)).toBe("25 km around 51.50°N 0.12°W");
    // One degree square at the equator: about 111 km × 111 km.
    const square: AlertArea = {
      type: "Polygon",
      coordinates: [
        [
          [0, 0],
          [1, 0],
          [1, 1],
          [0, 1],
          [0, 0],
        ],
      ],
    };
    expect(areaText(square)).toMatch(/^an area of 12 thousand km² near 0\.50°N 0\.50°E$/);
  });
});

describe("alert conditions", () => {
  it("reads like a sentence, with totals over hours in the summed unit", () => {
    expect(conditionText({ variable: "precip", operator: ">=", threshold: 50, accumulate_hours: 24 }, VARS)).toBe("Precipitation ≥ 50 mm in 24 h");
    expect(conditionText({ variable: "gust", operator: ">", threshold: 20 }, VARS)).toBe("Wind gust > 20 m/s");
    expect(
      definitionText(
        {
          match: "any",
          conditions: [
            { variable: "gust", operator: ">", threshold: 20, accumulate_hours: null },
            { variable: "precip", operator: ">=", threshold: 10, accumulate_hours: null },
          ],
        },
        VARS,
      ),
    ).toBe("Wind gust > 20 m/s, or Precipitation ≥ 10 mm/h");
  });

  it("offers only variables the service can test, and sums only rates", () => {
    expect(alertVariables(VARS).map((x) => x.id)).toEqual(["precip", "gust"]);
    expect(canAccumulate(VARS[0])).toBe(true);
    expect(canAccumulate(VARS[1])).toBe(false);
    expect(canAccumulate(undefined)).toBe(false);
  });
});
