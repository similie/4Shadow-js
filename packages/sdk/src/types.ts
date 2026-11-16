/** Response shapes of the 4Shadow forecast API v2 (https://api.4shadow.io/v2/docs). */

/**
 * A forecast model the API serves: `gfs` always; where enabled, `aigfs` (NOAA's AI model), `ifs` and `aifs`
 * (ECMWF's physics and AI models) and `aerosols` (NOAA's air quality). `/v2/health` lists those with a run.
 */
export type Model = "gfs" | "aigfs" | (string & {});

/** A place from the GeoNames-based place index. */
export interface Place {
  /** "Paris, Île-de-France, France": name, then region and country where they add something. */
  display_name: string;
  name: string;
  region: string | null;
  country: string | null;
  country_code: string | null;
  lat: number;
  lon: number;
  /** Plain-language type: "capital city", "town", "village", "country", "sea", "island", "airport", ... */
  kind: string;
  /** True for places that cover an area (countries, regions, seas): one point won't describe all of it. */
  area: boolean;
  population: number;
  elevation_m: number | null;
  timezone: string | null;
  /** How the name matched: the place's own name, an alternate (other language, old name), or a prefix. */
  match: "exact" | "alternate" | "prefix";
  geonames_id: number;
  feature_code: string;
  /** Only for nearest-place lookups. */
  distance_km?: number;
}

export interface PlacesResponse {
  query: { q: string } | { lat: number; lon: number };
  results: Place[];
  attribution: string;
}

export interface ForecastLocation {
  lat: number;
  lon: number;
  nearest_grid_point: { lat: number; lon: number };
  /** Terrain height in the model at this point, useful for elevation corrections. */
  model_elevation_m: number | null;
  land_fraction: number | null;
  /** With a place-name query: what was asked, which place was used, and others with the same name. */
  query?: string;
  place?: Place;
  alternatives?: Place[];
  /** With coordinates: the closest town or village (within 50 km). */
  nearest_place?: Place;
  /**
   * Where sea-state values (wave_height, swell_*, ...) came from when the point itself is on land or a
   * coast the model treats as land: the nearest open-sea grid point within 50 km. Absent when the
   * point has sea data of its own (or there is no sea nearby, and the sea-state values are null).
   */
  sea_point?: { lat: number; lon: number; distance_km: number };
}

/** Columnar time series: one array per variable, aligned with `time`. */
export interface Timeseries {
  time: string[];
  /** Hours since the previous step. Interval variables (precip, dswrf) are mean rates over it. */
  interval_hours: number[];
  [variable: string]: Array<number | null> | string[];
}

/** Local-calendar-day summaries, e.g. t2m_min, t2m_max, precip_sum. */
export interface Daily {
  date: string[];
  /** Hours of the day the run covers: under 23 marks a partial first or last day. */
  hours_covered: number[];
  [summary: string]: Array<number | null> | string[];
}

export interface Forecast {
  model: Model;
  run: string;
  init_time: string;
  location: ForecastLocation;
  timezone: { name: string; utc_offset_seconds: number };
  units: Record<string, string>;
  /** Interpolated to the present moment; null when the run doesn't cover now. */
  current: ({ time: string } & Record<string, number | null | string>) | null;
  timeseries: Timeseries;
  daily?: Daily;
  daily_units?: Record<string, string>;
  source: Record<string, unknown>;
}

export interface LegendStop {
  value: number;
  /** #RRGGBBAA */
  color: string;
}

export interface Legend {
  stops: LegendStop[];
  transparent_below: number | null;
  transparent_above: number | null;
}

export interface VariableInfo {
  id: string;
  name: string;
  units: string;
  description: string;
  semantics: "instant" | "interval_mean";
  tileable: boolean;
  derived_from?: string[];
  /** Defined over open sea only (sea state from GFS-Wave); missing over land and sea ice. */
  marine?: boolean;
  /** Meaningful on land only (fire weather): fields and tiles leave water empty; point forecasts keep it. */
  land_only?: boolean;
  legend?: Legend;
}

export interface VariablesResponse {
  model: Model;
  /** The model's name, e.g. "NOAA AIGFS 0.25° (AI)". */
  title?: string;
  /** What the model is and how it differs from the others. */
  description?: string;
  variables: VariableInfo[];
  daily: Array<{ id: string; source: string; aggregation: string; units: string }>;
}

export interface RunSummary {
  run: string;
  init_time: string;
  steps: number;
  first_valid: string;
  last_valid: string;
}

export interface RunsResponse {
  model: Model;
  latest: string | null;
  runs: RunSummary[];
}

export interface RunDetail {
  model: Model;
  run: string;
  init_time: string;
  forecast_hours: number[];
  valid_times: string[];
  variables: string[];
  source: Record<string, unknown>;
}

export interface Health {
  /** degraded: GFS is in, but another model has no run yet. */
  status: "ok" | "degraded" | "unavailable";
  version: string;
  models: Record<string, { latest_run: string | null; age_hours?: number; stale?: boolean }>;
}

/** Grid geometry of a field: row 0 is the northern edge, columns run west to east. */
export interface FieldGrid {
  lat0: number;
  dlat: number;
  nlat: number;
  lon0: number;
  dlon: number;
  nlon: number;
  /** True when the columns go all the way round the globe (the last column neighbours the first). */
  wraps: boolean;
}

export interface FieldVariable {
  id: string;
  name: string;
  units: string;
  semantics: "instant" | "interval_mean";
  scale: number;
  offset: number;
}

/** The JSON header of a 4SF1 field. */
export interface FieldHeader {
  format: "4SF1";
  model: Model;
  run: string;
  init_time: string;
  valid_time: string;
  forecast_hour: number;
  /** Interval variables are mean rates over this many hours before valid_time. */
  interval_hours: number;
  grid: FieldGrid;
  dtype: "int16";
  byte_order: "little";
  missing: number;
  variables: FieldVariable[];
}
