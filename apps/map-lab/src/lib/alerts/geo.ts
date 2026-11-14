import type { Alert, AlertArea, AlertCondition, AlertDefinition, VariableInfo } from "@similie/4shadow";
import type { Polygon } from "geojson";

const EARTH_KM = 6371.0088;
const RAD = Math.PI / 180;

/** A circle on the globe (great-circle radius), as a polygon to draw. */
export function circle(lon: number, lat: number, radiusKm: number, steps = 72): Polygon {
  const d = radiusKm / EARTH_KM;
  const φ1 = lat * RAD;
  const λ1 = lon * RAD;
  const ring: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const θ = (i / steps) * 2 * Math.PI;
    const φ2 = Math.asin(Math.sin(φ1) * Math.cos(d) + Math.cos(φ1) * Math.sin(d) * Math.cos(θ));
    const λ2 = λ1 + Math.atan2(Math.sin(θ) * Math.sin(d) * Math.cos(φ1), Math.cos(d) - Math.sin(φ1) * Math.sin(φ2));
    ring.push([((λ2 / RAD + 540) % 360) - 180, φ2 / RAD]);
  }
  return { type: "Polygon", coordinates: [ring] };
}

/** What to draw for an alert's area: a point with a radius becomes a circle; a bare point stays a point. */
export function areaShape(area: AlertArea, radiusKm = 0): AlertArea | Polygon {
  if (area.type === "Point" && radiusKm > 0) return circle(area.coordinates[0], area.coordinates[1], radiusKm);
  return area;
}

/** [west, south, east, north] of an area, for fitting the map to it. */
export function bounds(area: AlertArea, radiusKm = 0): [number, number, number, number] {
  const shape = areaShape(area, radiusKm);
  const points: number[][] =
    shape.type === "Point" ? [shape.coordinates] : shape.type === "Polygon" ? shape.coordinates.flat() : shape.coordinates.flat(2);
  let [w, s, e, n] = [180, 90, -180, -90];
  for (const [x, y] of points) {
    w = Math.min(w, x!);
    e = Math.max(e, x!);
    s = Math.min(s, y!);
    n = Math.max(n, y!);
  }
  return [w, s, e, n];
}

/** Where to put a label: the point, or the middle of the outer ring's bounding box. */
export function centre(area: AlertArea): [number, number] {
  if (area.type === "Point") return area.coordinates;
  const [w, s, e, n] = bounds(area);
  return [(w + e) / 2, (s + n) / 2];
}

/** Area of a polygon ring in km² (spherical excess, good enough for a label). */
function ringKm2(ring: number[][]): number {
  let sum = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [x1, y1] = ring[i]!;
    const [x2, y2] = ring[i + 1]!;
    sum += (x2! - x1!) * RAD * (2 + Math.sin(y1! * RAD) + Math.sin(y2! * RAD));
  }
  return Math.abs((sum * EARTH_KM * EARTH_KM) / 2);
}

export function areaText(area: AlertArea, radiusKm = 0): string {
  const [lon, lat] = centre(area);
  const where = `${Math.abs(lat).toFixed(2)}°${lat >= 0 ? "N" : "S"} ${Math.abs(lon).toFixed(2)}°${lon >= 0 ? "E" : "W"}`;
  if (area.type === "Point") return radiusKm > 0 ? `${radiusKm} km around ${where}` : `the point ${where}`;
  const polygons = area.type === "Polygon" ? [area.coordinates] : area.coordinates;
  const km2 = polygons.reduce((t, p) => t + ringKm2(p[0]!) - p.slice(1).reduce((h, r) => h + ringKm2(r), 0), 0);
  const size = km2 >= 10_000 ? `${Math.round(km2 / 1000).toLocaleString()} thousand km²` : `${Math.round(km2).toLocaleString()} km²`;
  return `${polygons.length > 1 ? `${polygons.length} areas` : "an area"} of ${size} near ${where}`;
}

const OPERATOR_TEXT: Record<AlertCondition["operator"], string> = {
  ">": ">",
  ">=": "≥",
  "<": "<",
  "<=": "≤",
};

/** Units a condition is measured in: a rate summed over hours drops the "/h" (mm/h → mm). */
export function conditionUnits(c: AlertCondition, v?: VariableInfo): string {
  const units = v?.units ?? "";
  return c.accumulate_hours && units.endsWith("/h") ? units.slice(0, -2) : units;
}

/** "Precipitation ≥ 50 mm in 24 h" */
export function conditionText(c: AlertCondition, variables: VariableInfo[]): string {
  const v = variables.find((x) => x.id === c.variable);
  const total = c.accumulate_hours ? ` in ${c.accumulate_hours} h` : "";
  return `${v?.name ?? c.variable} ${OPERATOR_TEXT[c.operator]} ${c.threshold} ${conditionUnits(c, v)}${total}`.replace(/\s+/g, " ");
}

export function definitionText(a: Pick<Alert, "conditions" | "match">, variables: VariableInfo[]): string {
  return a.conditions.map((c) => conditionText(c, variables)).join(a.match === "any" ? ", or " : ", and ");
}

/** Variables an alert can test: not directions (the forecast service refuses those). */
export function alertVariables(variables: VariableInfo[]): VariableInfo[] {
  return variables.filter((v) => v.units !== "°" && !/_dir$/.test(v.id));
}

/** Rates per hour (precipitation) can be summed over a period: "50 mm in 24 h". */
export function canAccumulate(v: VariableInfo | undefined): boolean {
  return !!v && v.semantics === "interval_mean" && v.units.endsWith("/h");
}

/** The parts of a definition the forecast service checks, for comparing drafts. */
export function definitionKey(d: AlertDefinition): string {
  const { area, radius_km, conditions, match, area_mode, coverage_percent, lead_days, min_duration_hours } = d;
  return JSON.stringify({
    area,
    radius_km,
    conditions,
    match,
    area_mode,
    coverage_percent,
    lead_days,
    min_duration_hours,
  });
}
