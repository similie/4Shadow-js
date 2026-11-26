import type { VariableInfo } from "@similie/4shadow";

/** The colour layers the lab offers, in menu order. */
export interface ColorLayerDef {
  id: string;
  label: string;
  /** Stored variables to fetch: one, or u/v drawn as their magnitude. */
  vars: [string] | [string, string];
  /** The variable whose legend and units apply (wind_speed for the u/v pair). */
  legendVar: string;
  /** The variable the server's PNG tiles use, for side-by-side checks. */
  tileVar: string;
  decimals: number;
  icon: string;
  /**
   * What the particles follow on this layer: a wave system's direction and period (they move the
   * way its waves travel). Without it, the particles follow the wind.
   */
  flow?: { dir: string; period: string };
  /** The eastward/northward wind (or water) the particles follow on this layer (default: the 10 m wind). */
  winds?: [string, string];
  /**
   * The particles' u/v pair is an ocean current: they move CURRENT_PACE times faster than the water so
   * they visibly move, and the readout says where it flows to (wind says where it comes from).
   */
  current?: true;
}

/**
 * How many times faster than the water current particles move (see ParticleFrames.pace). At 15,
 * currents of 0.1 to 1 m/s move as wind particles do in winds of 1.5 to 15 m/s.
 */
export const CURRENT_PACE = 15;

const WAVES = { dir: "wave_dir", period: "wave_period" };
const SWELL = { dir: "swell_dir", period: "swell_period" };

export const COLOR_LAYERS: ColorLayerDef[] = [
  { id: "wind", label: "Wind", vars: ["u10", "v10"], legendVar: "wind_speed", tileVar: "wind_speed", decimals: 1, icon: "≋" },
  {
    id: "wind100",
    label: "Wind at 100 m",
    vars: ["u100", "v100"],
    legendVar: "wind_speed_100m",
    tileVar: "wind_speed_100m",
    decimals: 1,
    icon: "⇶",
    winds: ["u100", "v100"],
  },
  { id: "gust", label: "Gusts", vars: ["gust"], legendVar: "gust", tileVar: "gust", decimals: 1, icon: "⤳" },
  { id: "t2m", label: "Temperature", vars: ["t2m"], legendVar: "t2m", tileVar: "t2m", decimals: 1, icon: "°" },
  { id: "precip", label: "Rain", vars: ["precip"], legendVar: "precip", tileVar: "precip", decimals: 1, icon: "☂" },
  { id: "radar", label: "Radar", vars: ["refc"], legendVar: "refc", tileVar: "refc", decimals: 0, icon: "◉" },
  { id: "tcc", label: "Clouds", vars: ["tcc"], legendVar: "tcc", tileVar: "tcc", decimals: 0, icon: "☁" },
  { id: "lcc", label: "Low clouds", vars: ["lcc"], legendVar: "lcc", tileVar: "lcc", decimals: 0, icon: "▁" },
  { id: "mslp", label: "Pressure", vars: ["mslp"], legendVar: "mslp", tileVar: "mslp", decimals: 0, icon: "◎" },
  { id: "waves", label: "Waves", vars: ["wave_height"], legendVar: "wave_height", tileVar: "wave_height", decimals: 1, icon: "〰", flow: WAVES },
  { id: "swell", label: "Swell", vars: ["swell_height"], legendVar: "swell_height", tileVar: "swell_height", decimals: 1, icon: "∿", flow: SWELL },
  {
    id: "wave_period",
    label: "Wave period",
    vars: ["wave_period"],
    legendVar: "wave_period",
    tileVar: "wave_period",
    decimals: 0,
    icon: "⏱",
    flow: WAVES,
  },
  // Ocean currents, tides included: from an ocean model (Copernicus Marine), drawn over the weather model.
  {
    id: "currents",
    label: "Currents",
    vars: ["current_u", "current_v"],
    legendVar: "current_speed",
    tileVar: "current_speed",
    decimals: 2,
    icon: "⥂",
    winds: ["current_u", "current_v"],
    current: true,
  },
  // The tide's height from the same ocean model, with its currents (tidal currents included) as particles.
  {
    id: "tides",
    label: "Tides",
    vars: ["tide_height"],
    legendVar: "tide_height",
    tileVar: "tide_height",
    decimals: 2,
    icon: "⇅",
    winds: ["current_u", "current_v"],
    current: true,
  },
  { id: "feels_like", label: "Feels like", vars: ["feels_like"], legendVar: "feels_like", tileVar: "feels_like", decimals: 1, icon: "≃" },
  { id: "heat_index", label: "Heat index", vars: ["heat_index"], legendVar: "heat_index", tileVar: "heat_index", decimals: 1, icon: "☼" },
  { id: "wet_bulb", label: "Wet-bulb", vars: ["wet_bulb"], legendVar: "wet_bulb", tileVar: "wet_bulb", decimals: 1, icon: "◍" },
  {
    id: "fire_weather",
    label: "Fire weather",
    vars: ["fire_weather"],
    legendVar: "fire_weather",
    tileVar: "fire_weather",
    decimals: 0,
    icon: "▲",
  },
  { id: "vpd", label: "Dryness (VPD)", vars: ["vpd"], legendVar: "vpd", tileVar: "vpd", decimals: 2, icon: "◇" },
  { id: "rh2m", label: "Humidity", vars: ["rh2m"], legendVar: "rh2m", tileVar: "rh2m", decimals: 0, icon: "%" },
  { id: "d2m", label: "Dew point", vars: ["d2m"], legendVar: "d2m", tileVar: "d2m", decimals: 1, icon: "◌" },
  { id: "cape", label: "CAPE", vars: ["cape"], legendVar: "cape", tileVar: "cape", decimals: 0, icon: "ϟ" },
  { id: "pwat", label: "Water vapour", vars: ["pwat"], legendVar: "pwat", tileVar: "pwat", decimals: 0, icon: "≈" },
  { id: "vis", label: "Visibility", vars: ["vis"], legendVar: "vis", tileVar: "vis", decimals: 0, icon: "◐" },
  { id: "dswrf", label: "Sunshine", vars: ["dswrf"], legendVar: "dswrf", tileVar: "dswrf", decimals: 0, icon: "☀" },
  { id: "snod", label: "Snow depth", vars: ["snod"], legendVar: "snod", tileVar: "snod", decimals: 2, icon: "❄" },
  {
    id: "freezing_level",
    label: "Freezing level",
    vars: ["freezing_level"],
    legendVar: "freezing_level",
    tileVar: "freezing_level",
    decimals: 0,
    icon: "△",
  },
  {
    id: "soil_moisture",
    label: "Soil moisture",
    vars: ["soil_moisture"],
    legendVar: "soil_moisture",
    tileVar: "soil_moisture",
    decimals: 2,
    icon: "▤",
  },
  // Air quality: from an air-quality model (NOAA GEFS-Aerosols), drawn over the weather model's wind.
  { id: "pm25", label: "PM2.5", vars: ["pm25"], legendVar: "pm25", tileVar: "pm25", decimals: 0, icon: "⁘" },
  { id: "pm10", label: "PM10", vars: ["pm10"], legendVar: "pm10", tileVar: "pm10", decimals: 0, icon: "⁙" },
  { id: "dust", label: "Dust", vars: ["dust"], legendVar: "dust", tileVar: "dust", decimals: 0, icon: "∴" },
  { id: "smoke_aod", label: "Smoke haze", vars: ["smoke_aod"], legendVar: "smoke_aod", tileVar: "smoke_aod", decimals: 2, icon: "≀" },
  { id: "aod", label: "Haze", vars: ["aod"], legendVar: "aod", tileVar: "aod", decimals: 2, icon: "◑" },
];

export const WIND_VARS: [string, string] = ["u10", "v10"];

/**
 * Whether a run can serve a variable: stored in it, or computed from variables it stores. The
 * catalog lists every variable the model has; a run made before one was added lacks it.
 */
export function servable(id: string, catalog: readonly VariableInfo[], stored: readonly string[]): boolean {
  if (stored.includes(id)) return true;
  const v = catalog.find((x) => x.id === id);
  return !!v?.derived_from?.length && v.derived_from.every((d) => stored.includes(d));
}

/** A run's variables: its model's catalog and what the run stores. */
export interface RunVars {
  catalog: readonly VariableInfo[];
  stored: readonly string[];
}

/**
 * The layers a run can draw (every variable they fetch or colour by is servable), and those another
 * model's run can draw over it, such as air quality.
 */
export function layersFor(catalog: readonly VariableInfo[], stored: readonly string[], overlays: readonly RunVars[] = []): ColorLayerDef[] {
  const can = (l: ColorLayerDef, r: RunVars) => [...l.vars, l.legendVar, l.tileVar].every((id) => servable(id, r.catalog, r.stored));
  return COLOR_LAYERS.filter((l) => can(l, { catalog, stored }) || overlays.some((o) => can(l, o)));
}
