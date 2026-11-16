import type { Field, ForeshadowClient } from "@similie/4shadow";

export interface FieldRequest {
  model: string;
  run: string;
  hour: number;
  vars: string[];
  stride: number;
  /** Only this area (west, south, east, north), for detail when zoomed in; default the globe. */
  bbox?: [number, number, number, number];
}

/**
 * Fields (one forecast step's grid of a few variables) by model, run, hour, variables and stride:
 * fetched once, shared between layers, dropped oldest-first past a size limit.
 */
export class FieldCache {
  private readonly client: ForeshadowClient;
  private readonly done = new Map<string, Field>();
  private readonly pending = new Map<string, Promise<Field>>();
  private readonly maxBytes: number;
  private bytes = 0;
  /** Called when any load finishes (to redraw), with the error if it failed. */
  onLoad: ((error?: unknown) => void) | null = null;

  constructor(client: ForeshadowClient, maxMegabytes = 400) {
    this.client = client;
    this.maxBytes = maxMegabytes * 1e6;
  }

  static key(r: FieldRequest): string {
    return `${r.model}/${r.run}/${r.hour}/${r.vars.join(",")}/${r.stride}${r.bbox ? `/${r.bbox.join(",")}` : ""}`;
  }

  get(r: FieldRequest): Field | undefined {
    const key = FieldCache.key(r);
    const f = this.done.get(key);
    if (f) {
      this.done.delete(key);
      this.done.set(key, f);
    }
    return f;
  }

  isLoading(r: FieldRequest): boolean {
    return this.pending.has(FieldCache.key(r));
  }

  get loading(): number {
    return this.pending.size;
  }

  load(r: FieldRequest): Promise<Field> {
    const key = FieldCache.key(r);
    const hit = this.done.get(key);
    if (hit) return Promise.resolve(hit);
    let p = this.pending.get(key);
    if (p) return p;
    p = this.client
      .field({ model: r.model, run: r.run, time: r.hour, vars: r.vars, stride: r.stride, bbox: r.bbox })
      .then((field) => {
        this.pending.delete(key);
        this.done.set(key, field);
        // int16 storage plus the float32 copies layers make.
        this.bytes += field.grid.nlat * field.grid.nlon * field.variables.length * 6;
        this.evict();
        this.onLoad?.();
        return field;
      })
      .catch((err) => {
        this.pending.delete(key);
        this.onLoad?.(err);
        throw err;
      });
    this.pending.set(key, p);
    return p;
  }

  /** Start loading without waiting; errors are reported through onLoad. */
  prefetch(r: FieldRequest): void {
    if (!this.done.has(FieldCache.key(r))) this.load(r).catch(() => {});
  }

  private evict(): void {
    for (const [key, f] of this.done) {
      if (this.bytes <= this.maxBytes || this.done.size <= 4) break;
      this.done.delete(key);
      this.bytes -= f.grid.nlat * f.grid.nlon * f.variables.length * 6;
    }
  }
}
