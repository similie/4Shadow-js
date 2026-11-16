import type { FieldGrid } from "../src/types.js";

/** Build a 4SF1 body the way the API does (forecast/fields.py), for decoder tests. */
export function makeField(grid: FieldGrid, vars: Record<string, number[]>, scale = 0.01, offset = 0): ArrayBuffer {
  const header = {
    format: "4SF1",
    model: "gfs",
    run: "2026111300",
    init_time: "2026-11-13T00:00Z",
    valid_time: "2026-11-13T06:00Z",
    forecast_hour: 6,
    interval_hours: 1,
    grid,
    dtype: "int16",
    byte_order: "little",
    missing: -32768,
    variables: Object.keys(vars).map((id) => ({ id, name: id, units: "u", semantics: "instant", scale, offset })),
  };
  let text = new TextEncoder().encode(JSON.stringify(header));
  const pad = (8 - ((8 + text.length) % 8)) % 8;
  text = new Uint8Array([...text, ...new Array(pad).fill(0x20)]);
  const size = grid.nlat * grid.nlon;
  const buf = new ArrayBuffer(8 + text.length + size * 2 * Object.keys(vars).length);
  const bytes = new Uint8Array(buf);
  bytes.set([0x34, 0x53, 0x46, 0x31], 0); // "4SF1"
  new DataView(buf).setUint32(4, text.length, true);
  bytes.set(text, 8);
  let off = 8 + text.length;
  const view = new DataView(buf);
  for (const values of Object.values(vars)) {
    values.forEach((v, i) => view.setInt16(off + i * 2, Number.isNaN(v) ? -32768 : Math.round((v - offset) / scale), true));
    off += size * 2;
  }
  return buf;
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}
