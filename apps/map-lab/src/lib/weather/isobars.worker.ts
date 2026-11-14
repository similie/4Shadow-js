/**
 * Computes isobars and H/L centres off the main thread (see isobar-jobs.ts): about 30 ms for a
 * global 1° field, enough to make playback stutter at every step if done between frames.
 */
import type { FieldGrid } from "@similie/4shadow";
import { isobars, pressureCentres, type PressureField } from "./isobars";

export interface IsobarJob {
  id: number;
  grid: FieldGrid;
  /** mslp in hPa, rows north to south, NaN where missing. */
  values: Float32Array;
}

export interface IsobarResult {
  id: number;
  lines: ReturnType<typeof isobars>;
  centres: ReturnType<typeof pressureCentres>;
}

self.onmessage = (e: MessageEvent<IsobarJob>) => {
  const { id, grid, values } = e.data;
  let lo = Infinity;
  let hi = -Infinity;
  for (const x of values) {
    if (x < lo) lo = x;
    if (x > hi) hi = x;
  }
  const field: PressureField = { grid, values: () => values, range: () => [lo, hi] };
  const result: IsobarResult = { id, lines: isobars(field), centres: pressureCentres(field) };
  self.postMessage(result);
};
