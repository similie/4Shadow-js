import type { FieldGrid, FieldHeader, FieldVariable } from "./types.js";

const MAGIC = "4SF1";
const LITTLE_ENDIAN = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;

/**
 * Gridded values for one forecast step, decoded from the API's 4SF1 binary.
 *
 * Values are kept as the API's int16 storage plus scale and offset; `values()` turns one
 * variable into a Float32Array (NaN = missing), cached, ready for a WebGL texture.
 */
export class Field {
  readonly header: FieldHeader;
  readonly grid: FieldGrid;
  readonly variables: FieldVariable[];
  readonly validTime: Date;
  private readonly rawArrays = new Map<string, Int16Array>();
  private readonly floatArrays = new Map<string, Float32Array>();

  constructor(header: FieldHeader, raw: Map<string, Int16Array>) {
    this.header = header;
    this.grid = header.grid;
    this.variables = header.variables;
    this.validTime = new Date(header.valid_time);
    this.rawArrays = raw;
  }

  /** The variable ids in this field, in order. */
  get ids(): string[] {
    return this.variables.map((v) => v.id);
  }

  variable(id: string): FieldVariable {
    const v = this.variables.find((x) => x.id === id);
    if (!v) throw new Error(`Field has no variable ${id}; it has ${this.ids.join(", ")}`);
    return v;
  }

  /** The stored int16 values (raw * scale + offset = value; header.missing = no data). */
  raw(id: string): Int16Array {
    this.variable(id);
    return this.rawArrays.get(id)!;
  }

  /** Values in real units as float32, rows north to south; NaN where missing. */
  values(id: string): Float32Array {
    let out = this.floatArrays.get(id);
    if (out) return out;
    const { scale, offset } = this.variable(id);
    const raw = this.raw(id);
    const missing = this.header.missing;
    out = new Float32Array(raw.length);
    for (let i = 0; i < raw.length; i++) {
      const r = raw[i]!;
      out[i] = r === missing ? NaN : r * scale + offset;
    }
    this.floatArrays.set(id, out);
    return out;
  }

  /** Minimum and maximum of a variable, ignoring missing cells. */
  range(id: string): [number, number] {
    const v = this.values(id);
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < v.length; i++) {
      const x = v[i]!;
      if (x < lo) lo = x;
      if (x > hi) hi = x;
    }
    return [lo, hi];
  }

  /** Bilinear value at a point, or NaN outside the field (or where all four neighbours are missing). */
  sample(id: string, lat: number, lon: number): number {
    const v = this.values(id);
    const at = this.neighbours(lat, lon);
    if (!at) return NaN;
    let num = 0;
    let den = 0;
    for (let k = 0; k < 4; k++) {
      const x = v[at.index[k]!]!;
      if (!Number.isNaN(x)) {
        num += x * at.weight[k]!;
        den += at.weight[k]!;
      }
    }
    return den > 0 ? num / den : NaN;
  }

  /**
   * A direction in degrees (e.g. wave_dir, swell_dir) at a point, blended as an angle, so 350° and
   * 10° give 0°, not 180°. NaN outside the field or where all four neighbours are missing.
   */
  direction(id: string, lat: number, lon: number): number {
    const v = this.values(id);
    const at = this.neighbours(lat, lon);
    if (!at) return NaN;
    let x = 0;
    let y = 0;
    let den = 0;
    for (let k = 0; k < 4; k++) {
      const d = v[at.index[k]!]!;
      if (!Number.isNaN(d)) {
        const r = (d * Math.PI) / 180;
        x += Math.sin(r) * at.weight[k]!;
        y += Math.cos(r) * at.weight[k]!;
        den += at.weight[k]!;
      }
    }
    if (den === 0) return NaN;
    return (((Math.atan2(x, y) * 180) / Math.PI) % 360 + 360) % 360;
  }

  /** The four grid points around a point (flat indices) and their bilinear weights; null outside. */
  private neighbours(lat: number, lon: number): { index: number[]; weight: number[] } | null {
    const g = this.grid;
    const fi = (g.lat0 - lat) / g.dlat;
    if (fi < 0 || fi > g.nlat - 1) return null;
    let fj = (lon - g.lon0) / g.dlon;
    if (g.wraps) {
      fj = ((((lon - g.lon0) % 360) + 360) % 360) / g.dlon;
    } else {
      if (fj < -1e-9) fj = ((((lon - g.lon0) % 360) + 360) % 360) / g.dlon; // e.g. lon given as 190 vs -170
      if (fj < 0 || fj > g.nlon - 1) return null;
    }
    const i0 = Math.min(Math.floor(fi), g.nlat - 2);
    const wi = fi - i0;
    const j0 = Math.floor(fj);
    const wj = fj - j0;
    const j1 = g.wraps ? (j0 + 1) % g.nlon : Math.min(j0 + 1, g.nlon - 1);
    const jj0 = g.wraps ? j0 % g.nlon : j0;
    return {
      index: [i0 * g.nlon + jj0, i0 * g.nlon + j1, (i0 + 1) * g.nlon + jj0, (i0 + 1) * g.nlon + j1],
      weight: [(1 - wi) * (1 - wj), (1 - wi) * wj, wi * (1 - wj), wi * wj],
    };
  }

  /** Wind at a point from u/v components (default u10, v10): speed in m/s and the direction it blows from. */
  wind(lat: number, lon: number, u = "u10", v = "v10"): { u: number; v: number; speed: number; direction: number } {
    const uu = this.sample(u, lat, lon);
    const vv = this.sample(v, lat, lon);
    return { u: uu, v: vv, speed: Math.hypot(uu, vv), direction: windDirection(uu, vv) };
  }

  /** Latitude of a row and longitude of a column. */
  latOf(row: number): number {
    return this.grid.lat0 - row * this.grid.dlat;
  }

  lonOf(col: number): number {
    const lon = this.grid.lon0 + col * this.grid.dlon;
    return ((((lon + 180) % 360) + 360) % 360) - 180;
  }
}

/** Decode a 4SF1 response body (from `client.field()` or a fetch of a fields URL). */
export function decodeField(buffer: ArrayBuffer): Field {
  const bytes = new Uint8Array(buffer);
  if (bytes.length < 8 || String.fromCharCode(bytes[0]!, bytes[1]!, bytes[2]!, bytes[3]!) !== MAGIC) {
    throw new Error("Not a 4SF1 field");
  }
  const view = new DataView(buffer);
  const headerLength = view.getUint32(4, true);
  if (8 + headerLength > buffer.byteLength) throw new Error("4SF1 field is truncated");
  const header = JSON.parse(new TextDecoder().decode(bytes.subarray(8, 8 + headerLength))) as FieldHeader;
  const size = header.grid.nlat * header.grid.nlon;
  const raw = new Map<string, Int16Array>();
  let offset = 8 + headerLength;
  for (const v of header.variables) {
    if (offset + size * 2 > buffer.byteLength) throw new Error("4SF1 field is truncated");
    let arr: Int16Array;
    if (LITTLE_ENDIAN) {
      arr = new Int16Array(buffer, offset, size);
    } else {
      arr = new Int16Array(size);
      for (let i = 0; i < size; i++) arr[i] = view.getInt16(offset + i * 2, true);
    }
    raw.set(v.id, arr);
    offset += size * 2;
  }
  return new Field(header, raw);
}

/** Meteorological wind direction: degrees clockwise from north that the wind blows FROM. */
export function windDirection(u: number, v: number): number {
  return (((270 - (Math.atan2(v, u) * 180) / Math.PI) % 360) + 360) % 360;
}

const COMPASS = "N NNE NE ENE E ESE SE SSE S SSW SW WSW W WNW NW NNW".split(" ");

/** 16-point compass name for a direction in degrees. */
export function compass(degrees: number): string {
  return COMPASS[Math.floor((((degrees % 360) + 360) % 360) / 22.5 + 0.5) % 16]!;
}
