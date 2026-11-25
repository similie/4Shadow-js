import type { Field } from "@similie/4shadow";
import { contours } from "d3-contour";
import type { Feature, FeatureCollection, LineString, Point } from "geojson";

type Line = Array<[number, number]>;

/** What these functions need of a field (a `Field`, or its grid and values posted to a worker). */
export type PressureField = Pick<Field, "grid" | "values" | "range">;

/**
 * How far towards the poles lines go. MapLibre's tiles end at 85.05°, and a line beyond is squashed
 * onto that edge: on a globe, the isobars circling a pole became one ring around it.
 */
const MAX_LAT = 85;

/** One pass of Chaikin corner cutting: rounds the 1° grid's corners off the lines. */
function chaikin(line: Line): Line {
  if (line.length < 3) return line;
  const out: Line = [line[0]!];
  for (let k = 0; k < line.length - 1; k++) {
    const [x0, y0] = line[k]!;
    const [x1, y1] = line[k + 1]!;
    out.push([0.75 * x0 + 0.25 * x1, 0.75 * y0 + 0.25 * y1], [0.25 * x0 + 0.75 * x1, 0.25 * y0 + 0.75 * y1]);
  }
  out.push(line[line.length - 1]!);
  return out;
}

/** The field's values with the first column repeated at the end when it wraps, so lines meet at 180°. */
function padded(field: PressureField, id: string): { values: Float64Array; nx: number; ny: number } {
  const g = field.grid;
  const src = field.values(id);
  const nx = g.wraps ? g.nlon + 1 : g.nlon;
  const ny = g.nlat;
  const values = new Float64Array(nx * ny);
  for (let i = 0; i < ny; i++) {
    for (let j = 0; j < nx; j++) values[i * nx + j] = src[i * g.nlon + (j % g.nlon)]!;
  }
  return { values, nx, ny };
}

/**
 * Isobars (lines of equal pressure) from a field with mslp in hPa, every `interval` hPa,
 * as GeoJSON lines with an `hpa` property. Works best on a coarse field (stride 4 = 1°).
 */
export function isobars(field: PressureField, id = "mslp", interval = 4): FeatureCollection<LineString, { hpa: number }> {
  const g = field.grid;
  const { values, nx, ny } = padded(field, id);
  const [lo, hi] = field.range(id);
  const features: Array<Feature<LineString, { hpa: number }>> = [];
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return { type: "FeatureCollection", features };
  const generator = contours().size([nx, ny]);
  const toLonLat = ([x, y]: [number, number]): [number, number] => [g.lon0 + (x - 0.5) * g.dlon, g.lat0 - (y - 0.5) * g.dlat];
  for (let level = Math.ceil(lo / interval) * interval; level <= hi; level += interval) {
    const shape = generator.contour(values as unknown as number[], level);
    for (const polygon of shape.coordinates) {
      for (const ring of polygon) {
        // Rings close along the grid's edge; keep only the parts inside it, and short of the poles.
        let run: Line = [];
        const flush = () => {
          if (run.length >= 4) {
            features.push({
              type: "Feature",
              properties: { hpa: level },
              geometry: { type: "LineString", coordinates: chaikin(run.map(toLonLat)) },
            });
          }
          run = [];
        };
        for (const p of ring as Line) {
          const [x, y] = p;
          if (x <= 0 || x >= nx || y <= 0 || y >= ny || Math.abs(g.lat0 - (y - 0.5) * g.dlat) > MAX_LAT) flush();
          else run.push(p);
        }
        flush();
      }
    }
  }
  return { type: "FeatureCollection", features };
}

/**
 * High and low pressure centres: grid points that are the extreme of their surroundings
 * (within `radius` cells) and stand out from them by at least `prominence` hPa.
 */
export function pressureCentres(
  field: PressureField,
  id = "mslp",
  radius = 8,
  prominence = 1.5,
): FeatureCollection<Point, { kind: "H" | "L"; hpa: number }> {
  const g = field.grid;
  const v = field.values(id);
  const { nlat, nlon } = g;
  const features: Array<Feature<Point, { kind: "H" | "L"; hpa: number }>> = [];
  const at = (i: number, j: number) => {
    const jj = g.wraps ? ((j % nlon) + nlon) % nlon : j;
    if (i < 0 || i >= nlat || jj < 0 || jj >= nlon) return NaN;
    return v[i * nlon + jj]!;
  };
  for (let i = 1; i < nlat - 1; i++) {
    const lat = g.lat0 - i * g.dlat;
    if (Math.abs(lat) > 80) continue;
    for (let j = 0; j < nlon; j++) {
      const p = v[i * nlon + j]!;
      if (Number.isNaN(p)) continue;
      // Quick 3x3 test first.
      let isMin = true;
      let isMax = true;
      for (let di = -1; di <= 1 && (isMin || isMax); di++) {
        for (let dj = -1; dj <= 1; dj++) {
          if (!di && !dj) continue;
          const q = at(i + di, j + dj);
          if (q < p) isMin = false;
          if (q > p) isMax = false;
        }
      }
      if (!isMin && !isMax) continue;
      let sum = 0;
      let n = 0;
      for (let di = -radius; di <= radius && (isMin || isMax); di++) {
        for (let dj = -radius; dj <= radius; dj++) {
          if (!di && !dj) continue;
          const q = at(i + di, j + dj);
          if (Number.isNaN(q)) continue;
          // Ties go to the first cell (by index), so a flat centre yields one marker.
          const before = di < 0 || (di === 0 && dj < 0);
          if (q < p || (q === p && before)) isMin = false;
          if (q > p || (q === p && before)) isMax = false;
          sum += q;
          n++;
        }
      }
      if (!n) continue;
      const mean = sum / n;
      const lon = g.lon0 + j * g.dlon;
      const coords: [number, number] = [((((lon + 180) % 360) + 360) % 360) - 180, lat];
      if (isMin && mean - p >= prominence) {
        features.push({ type: "Feature", properties: { kind: "L", hpa: Math.round(p) }, geometry: { type: "Point", coordinates: coords } });
      } else if (isMax && p - mean >= prominence * 0.66) {
        features.push({ type: "Feature", properties: { kind: "H", hpa: Math.round(p) }, geometry: { type: "Point", coordinates: coords } });
      }
    }
  }
  return { type: "FeatureCollection", features };
}
