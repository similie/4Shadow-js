import type { Legend } from "./types.js";

export type RGBA = [number, number, number, number];

function parseColor(hex: string): RGBA {
  const h = hex.replace(/^#/, "");
  const full = h.length === 6 ? h + "ff" : h;
  return [0, 2, 4, 6].map((i) => parseInt(full.slice(i, i + 2), 16)) as RGBA;
}

/**
 * The API's colour scale for a variable (from `client.variables()`), as a function of value.
 * The same value always gets the same colour: it matches the server's PNG tiles exactly.
 */
export class Palette {
  readonly legend: Legend;
  readonly min: number;
  readonly max: number;
  private readonly values: number[];
  private readonly colors: RGBA[];

  constructor(legend: Legend) {
    if (legend.stops.length < 2) throw new Error("A palette needs at least two stops");
    this.legend = legend;
    this.values = legend.stops.map((s) => s.value);
    this.colors = legend.stops.map((s) => parseColor(s.color));
    this.min = this.values[0]!;
    this.max = this.values[this.values.length - 1]!;
  }

  /** RGBA (0-255) for a value; alpha 0 for NaN and outside transparent_below/above. */
  color(value: number): RGBA {
    const { transparent_below: below, transparent_above: above } = this.legend;
    if (Number.isNaN(value) || (below != null && value < below) || (above != null && value > above)) {
      return [0, 0, 0, 0];
    }
    const vs = this.values;
    if (value <= vs[0]!) return [...this.colors[0]!] as RGBA;
    if (value >= vs[vs.length - 1]!) return [...this.colors[vs.length - 1]!] as RGBA;
    let k = 1;
    while (vs[k]! < value) k++;
    const t = (value - vs[k - 1]!) / (vs[k]! - vs[k - 1]!);
    const a = this.colors[k - 1]!;
    const b = this.colors[k]!;
    return [0, 1, 2, 3].map((c) => Math.round(a[c]! + (b[c]! - a[c]!) * t)) as RGBA;
  }

  /** CSS colour string for a value. */
  css(value: number): string {
    const [r, g, b, a] = this.color(value);
    return `rgba(${r}, ${g}, ${b}, ${(a / 255).toFixed(3)})`;
  }

  /**
   * An RGBA lookup ramp of `size` texels from `min` to `max`, for a WebGL colour layer: sample it at
   * (value - min) / (max - min). Transparency limits are baked in.
   */
  ramp(size = 256): Uint8Array {
    const out = new Uint8Array(size * 4);
    for (let i = 0; i < size; i++) {
      out.set(this.color(this.min + ((this.max - this.min) * i) / (size - 1)), i * 4);
    }
    return out;
  }

  /** A CSS linear-gradient for a legend bar. */
  gradient(direction = "to right", samples = 24): string {
    const parts: string[] = [];
    for (let i = 0; i < samples; i++) {
      const t = i / (samples - 1);
      parts.push(`${this.css(this.min + (this.max - this.min) * t)} ${(t * 100).toFixed(1)}%`);
    }
    return `linear-gradient(${direction}, ${parts.join(", ")})`;
  }
}
