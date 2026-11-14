import type { Field } from "@similie/4shadow";
import { isobars, pressureCentres } from "./isobars";
import type { IsobarJob, IsobarResult } from "./isobars.worker";
import IsobarWorker from "./isobars.worker.ts?worker";

/** One step's isobars and H/L centres, ready for the map's GeoJSON sources. */
export interface PressureMap {
  lines: IsobarResult["lines"];
  centres: IsobarResult["centres"];
}

/**
 * Isobars and H/L centres per pressure field, computed in a worker and kept with the field.
 * Ask for the steps ahead as soon as their fields arrive, and they're ready before they're shown.
 * If the worker fails, they're computed here instead, so the map never waits forever.
 */
export class IsobarJobs {
  private worker: Worker | null = null;
  private failed = false;
  private readonly done = new WeakMap<Field, PressureMap>();
  private readonly queued = new WeakSet<Field>();
  private readonly pending = new Map<number, Field>();
  private nextId = 1;
  private readonly onReady: () => void;

  /** `onReady` is called whenever a result arrives. */
  constructor(onReady: () => void) {
    this.onReady = onReady;
  }

  /** The field's isobars if computed; otherwise starts computing them and returns undefined. */
  get(field: Field): PressureMap | undefined {
    const hit = this.done.get(field);
    if (!hit) this.request(field);
    return hit;
  }

  /** Start computing a field's isobars (once). */
  request(field: Field): void {
    if (this.done.has(field) || this.queued.has(field)) return;
    this.queued.add(field);
    if (this.failed) {
      this.done.set(field, { lines: isobars(field), centres: pressureCentres(field) });
      return;
    }
    const id = this.nextId++;
    this.pending.set(id, field);
    const values = field.values("mslp").slice(); // the field keeps its own copy
    const job: IsobarJob = { id, grid: field.grid, values };
    (this.worker ??= this.start()).postMessage(job, [values.buffer]);
  }

  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
    this.pending.clear();
  }

  private start(): Worker {
    const worker = new IsobarWorker();
    worker.onmessage = (e: MessageEvent<IsobarResult>) => {
      const field = this.pending.get(e.data.id);
      if (!field) return;
      this.pending.delete(e.data.id);
      this.done.set(field, { lines: e.data.lines, centres: e.data.centres });
      this.onReady();
    };
    worker.onerror = (e) => {
      console.error("Isobar worker failed; computing isobars on the main thread", e.message);
      this.failed = true;
      worker.terminate();
      this.worker = null;
      for (const field of this.pending.values()) this.done.set(field, { lines: isobars(field), centres: pressureCentres(field) });
      this.pending.clear();
      this.onReady();
    };
    return worker;
  }
}
