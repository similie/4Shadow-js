import type { RunDetail } from "@similie/4shadow";

/** The weather models' grid spacing, which the map's `stride` counts in. */
const BASE_SPACING = 0.25;
/** Largest detail request, in cells: a quarter of the globe at 0.25°. */
export const DETAIL_MAX_CELLS = (1440 * 721) / 4;

/**
 * A stride counted in 0.25° cells (`WeatherMapOptions.stride`) as a stride on a run's own grid: about the
 * same detail on a finer grid (satellite imagery, 0.1°). A detail area (`bbox`: west, south, east, north)
 * is fetched as finely as its size allows, at most DETAIL_MAX_CELLS cells.
 */
export function strideFor(run: Pick<RunDetail, "grid">, stride: number, bbox?: [number, number, number, number]): number {
  const spacing = run.grid?.dlat ?? BASE_SPACING;
  if (!bbox) return Math.max(1, Math.round((stride * BASE_SPACING) / spacing));
  const [west, south, east, north] = bbox;
  const width = (((east - west) % 360) + 360) % 360 || 360;
  const cells = (width / spacing) * ((north - south) / spacing);
  return Math.max(1, Math.ceil(Math.sqrt(cells / DETAIL_MAX_CELLS)));
}
