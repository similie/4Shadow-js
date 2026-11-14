/**
 * Two copies of something drawn once per forecast step (isobars, raster tiles), crossfaded as
 * time moves between steps, the way the GPU layers blend their values.
 *
 * Between steps A and B, A's copy shows at 1 - t and B's at t. When time passes B, the copy
 * already showing B stays as it is and the other copy, now fully faded out, takes the next step.
 * So a copy only ever gets new data while it is invisible, and nothing on screen jumps.
 */
export class Crossfade<T> {
  private keys: [string, string] = ["", ""];
  private readonly load: (slot: 0 | 1, item: T) => void;

  /** `load` puts an item into a copy (e.g. `setData` on that copy's source). */
  constructor(load: (slot: 0 | 1, item: T) => void) {
    this.load = load;
  }

  /**
   * Show `a` fading into `b` (`t` from 0 to 1); keys identify the steps. Returns each copy's
   * weight, to multiply into its opacity. Pass the same key twice to show one step alone.
   */
  show(keyA: string, a: T, keyB: string, b: T, t: number): [number, number] {
    let sa = this.keys.indexOf(keyA);
    if (keyA === keyB) {
      if (sa < 0) this.put((sa = 0), keyA, a);
      return sa === 0 ? [1, 0] : [0, 1];
    }
    let sb = this.keys.indexOf(keyB);
    if (sa < 0 && sb < 0) {
      this.put((sa = 0), keyA, a);
      this.put((sb = 1), keyB, b);
    } else if (sa < 0) {
      this.put((sa = 1 - sb), keyA, a);
    } else if (sb < 0) {
      this.put((sb = 1 - sa), keyB, b);
    }
    const w: [number, number] = [0, 0];
    w[sa] = 1 - t;
    w[sb] = t;
    return w;
  }

  /** Which copy shows this key, if any. */
  slotOf(key: string): 0 | 1 | -1 {
    return this.keys.indexOf(key) as 0 | 1 | -1;
  }

  /** Forget what the copies hold (their contents are reloaded on the next `show`). */
  reset(): void {
    this.keys = ["", ""];
  }

  private put(slot: number, key: string, item: T): void {
    this.keys[slot] = key;
    this.load(slot as 0 | 1, item);
  }
}
