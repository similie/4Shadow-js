import { Field, type FieldGrid } from "@similie/4shadow";

/** A field built in memory, the way the SDK decodes one (int16 values with a scale). */
export function makeField(grid: FieldGrid, vars: Record<string, ArrayLike<number>>, scale = 0.01): Field {
  const raw = new Map<string, Int16Array>();
  for (const [id, values] of Object.entries(vars)) {
    raw.set(id, Int16Array.from(values, (v) => (Number.isNaN(v) ? -32768 : Math.round(v / scale))));
  }
  return new Field(
    {
      format: "4SF1",
      model: "gfs",
      run: "2026111600",
      init_time: "2026-11-16T00:00Z",
      valid_time: "2026-11-16T06:00Z",
      forecast_hour: 6,
      interval_hours: 1,
      grid,
      dtype: "int16",
      byte_order: "little",
      missing: -32768,
      variables: Object.keys(vars).map((id) => ({ id, name: id, units: "u", semantics: "instant" as const, scale, offset: 0 })),
    },
    raw,
  );
}

/** A 1° global grid, north to south from 90°N, west to east from 0°. */
export const GLOBAL_1DEG: FieldGrid = { lat0: 90, dlat: 1, nlat: 181, lon0: 0, dlon: 1, nlon: 360, wraps: true };
