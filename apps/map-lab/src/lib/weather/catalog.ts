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
}

const WAVES = { dir: "wave_dir", period: "wave_period" };
const SWELL = { dir: "swell_dir", period: "swell_period" };

export const COLOR_LAYERS: ColorLayerDef[] = [
  { id: "wind", label: "Wind", vars: ["u10", "v10"], legendVar: "wind_speed", tileVar: "wind_speed", decimals: 1, icon: "≋" },
  { id: "gust", label: "Gusts", vars: ["gust"], legendVar: "gust", tileVar: "gust", decimals: 1, icon: "⤳" },
  { id: "t2m", label: "Temperature", vars: ["t2m"], legendVar: "t2m", tileVar: "t2m", decimals: 1, icon: "°" },
  { id: "precip", label: "Rain", vars: ["precip"], legendVar: "precip", tileVar: "precip", decimals: 1, icon: "☂" },
  { id: "tcc", label: "Clouds", vars: ["tcc"], legendVar: "tcc", tileVar: "tcc", decimals: 0, icon: "☁" },
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
  { id: "rh2m", label: "Humidity", vars: ["rh2m"], legendVar: "rh2m", tileVar: "rh2m", decimals: 0, icon: "%" },
  { id: "d2m", label: "Dew point", vars: ["d2m"], legendVar: "d2m", tileVar: "d2m", decimals: 1, icon: "◌" },
  { id: "cape", label: "CAPE", vars: ["cape"], legendVar: "cape", tileVar: "cape", decimals: 0, icon: "ϟ" },
  { id: "pwat", label: "Water vapour", vars: ["pwat"], legendVar: "pwat", tileVar: "pwat", decimals: 0, icon: "≈" },
  { id: "vis", label: "Visibility", vars: ["vis"], legendVar: "vis", tileVar: "vis", decimals: 0, icon: "◐" },
  { id: "dswrf", label: "Sunshine", vars: ["dswrf"], legendVar: "dswrf", tileVar: "dswrf", decimals: 0, icon: "☀" },
  { id: "snod", label: "Snow depth", vars: ["snod"], legendVar: "snod", tileVar: "snod", decimals: 2, icon: "❄" },
];

export const WIND_VARS: [string, string] = ["u10", "v10"];
