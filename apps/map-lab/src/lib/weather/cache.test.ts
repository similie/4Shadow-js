import { describe, expect, it } from "vitest";
import { FieldCache } from "./cache.ts";

describe("field cache", () => {
  it("keeps models apart: a GFS and an AIGFS run have the same id", () => {
    const r = { run: "2026111600", hour: 6, vars: ["t2m"], stride: 2 };
    expect(FieldCache.key({ ...r, model: "gfs" })).not.toBe(FieldCache.key({ ...r, model: "aigfs" }));
  });
});
